// The assembler: collectAllAgents() turns the read-only sources into the
// normalized AgentState[] the dashboard consumes.
//
// RESILIENCE: this function NEVER throws and ALWAYS returns one entry per
// configured agent, in config order. Defense is layered:
//  1. each session's listWindows() runs inside its own try/catch (-> []).
//  2. each agent is assembled inside a try/catch -> any throw becomes a safe
//     `unknown` AgentState for that agent.
//  3. the whole Promise.all body is wrapped so the OUTER function can never
//     reject — a catastrophic failure returns all-unknown states.
//
// SECURITY (SAFE-02): the collector introduces NO raw content. It copies the
// upstream (already labels-only) currentActivity/recentEvents verbatim and
// emits only the resolved metric. There is no fs/network write here.

import { getAgents } from './agents.js';
import type { AgentDefinition, AgentState } from './types.js';
import { readTranscript as realReadTranscript } from './sources/transcript.js';
import type { TranscriptResult } from './sources/transcript.js';
import { listWindows as realListWindows } from './sources/tmux.js';
import { resolveMetric as realResolveMetric } from './sources/metrics.js';
import type { AgentMetric } from './types.js';

/** Without tmux, "recently active but not right now" still reads as online. */
const ONLINE_IDLE_WINDOW_MS = 30 * 60_000;

/** Injectable source functions (default to the real imports); used by tests. */
export interface CollectorOpts {
  agents?: AgentDefinition[];
  readTranscript?: (dir: string) => Promise<TranscriptResult>;
  listWindows?: (session: string) => Promise<string[]>;
  resolveMetric?: (
    agent: AgentDefinition,
    transcript: { lastActiveTs: string | null },
  ) => Promise<AgentMetric>;
  /** Injectable clock for the no-tmux idle window (tests). */
  now?: () => number;
}

/** The safe fallback state for an agent whose sources errored. */
function unknownState(agent: AgentDefinition): AgentState {
  return {
    id: agent.id,
    displayName: agent.displayName,
    status: 'unknown',
    currentActivity: null,
    recentEvents: [],
    metric: { label: 'Status', value: '--' },
    lastActiveTs: null,
  };
}

/**
 * Assemble one agent's AgentState from its transcript result and the hoisted
 * per-session window lists. Throws are caught by the caller -> unknownState.
 */
async function assembleAgent(
  agent: AgentDefinition,
  windowsBySession: Map<string, string[]>,
  readTranscript: NonNullable<CollectorOpts['readTranscript']>,
  resolveMetric: NonNullable<CollectorOpts['resolveMetric']>,
  now: () => number,
): Promise<AgentState> {
  if (!agent.transcriptDir) return unknownState(agent);
  const t = await readTranscript(agent.transcriptDir);

  // Status decision tree.
  let status: AgentState['status'];
  if (!t.ok) {
    status = 'unknown';
  } else if (t.fresh) {
    status = 'working';
  } else if (agent.tmuxSession && agent.tmuxWindow) {
    const windows = windowsBySession.get(agent.tmuxSession) ?? [];
    status = windows.includes(agent.tmuxWindow) ? 'online-idle' : 'offline';
  } else {
    // No tmux source configured: infer presence from transcript recency.
    const last = t.lastActiveTs ? Date.parse(t.lastActiveTs) : NaN;
    status =
      !Number.isNaN(last) && now() - last < ONLINE_IDLE_WINDOW_MS ? 'online-idle' : 'offline';
  }

  const metric = await resolveMetric(agent, { lastActiveTs: t.lastActiveTs });

  return {
    id: agent.id,
    displayName: agent.displayName,
    status,
    // unknown -> no activity even if a (degenerate) stub returned one.
    currentActivity: status === 'unknown' ? null : t.currentActivity,
    recentEvents: status === 'unknown' ? [] : t.recentEvents,
    metric,
    lastActiveTs: t.lastActiveTs,
  };
}

/**
 * Collect all configured agents' normalized states. Never throws; always
 * returns one entry per agent in config order.
 */
export async function collectAllAgents(opts: CollectorOpts = {}): Promise<AgentState[]> {
  const agents = opts.agents ?? getAgents();
  const readTranscript = opts.readTranscript ?? realReadTranscript;
  const listWindows = opts.listWindows ?? realListWindows;
  const resolveMetric = opts.resolveMetric ?? realResolveMetric;
  const now = opts.now ?? Date.now;

  try {
    // Hoist one tmux call per distinct session; each failure degrades to [].
    const sessions = [...new Set(agents.map((a) => a.tmuxSession).filter((s): s is string => !!s))];
    const windowsBySession = new Map<string, string[]>();
    await Promise.all(
      sessions.map(async (s) => {
        try {
          windowsBySession.set(s, await listWindows(s));
        } catch {
          windowsBySession.set(s, []);
        }
      }),
    );

    return await Promise.all(
      agents.map(async (agent) => {
        try {
          return await assembleAgent(agent, windowsBySession, readTranscript, resolveMetric, now);
        } catch {
          return unknownState(agent);
        }
      }),
    );
  } catch {
    // Catastrophic fallback: all unknown, in config order.
    return agents.map((agent) => unknownState(agent));
  }
}
