import { describe, it, expect } from 'vitest';
import { collectAllAgents } from './collector.js';
import type { TranscriptResult } from './sources/transcript.js';
import type { AgentDefinition, AgentMetric } from './types.js';

// A transcript result builder for stubbing.
function tx(partial: Partial<TranscriptResult>): TranscriptResult {
  return {
    ok: true,
    lastActiveTs: '2026-06-08T20:00:00.000Z',
    fresh: false,
    currentActivity: null,
    recentEvents: [],
    ...partial,
  };
}

const okMetric: AgentMetric = { label: 'X', value: 1 };

/** Two tmux-backed agents + one transcript-only agent. */
const DEFS: AgentDefinition[] = [
  { id: 'writer', displayName: 'Writer', transcriptDir: '/t/writer', tmuxSession: 'agents', tmuxWindow: 'writer' },
  { id: 'coder', displayName: 'Coder', transcriptDir: '/t/coder', tmuxSession: 'agents', tmuxWindow: 'coder' },
  { id: 'solo', displayName: 'Solo', transcriptDir: '/t/solo' },
];

const NOW = Date.parse('2026-06-08T21:00:00.000Z');

describe('collectAllAgents', () => {
  it('returns one AgentState per configured agent, in config order', async () => {
    const states = await collectAllAgents({
      agents: DEFS,
      readTranscript: async () => tx({ fresh: true, currentActivity: 'Running a command' }),
      listWindows: async () => ['writer', 'coder'],
      resolveMetric: async () => okMetric,
      now: () => NOW,
    });
    expect(states).toHaveLength(3);
    expect(states.map((s) => s.id)).toEqual(['writer', 'coder', 'solo']);
  });

  it('status tree: !ok->unknown, fresh->working, tmux window->online-idle, gone->offline', async () => {
    const states = await collectAllAgents({
      agents: DEFS,
      readTranscript: async (dir: string) => {
        if (dir === '/t/writer') return tx({ fresh: true, currentActivity: 'Running a command' });
        if (dir === '/t/coder') return tx({ fresh: false });
        return { ...tx({}), ok: false };
      },
      listWindows: async () => ['writer', 'coder'],
      resolveMetric: async () => okMetric,
      now: () => NOW,
    });
    expect(states[0].status).toBe('working');
    expect(states[1].status).toBe('online-idle');
    expect(states[2].status).toBe('unknown');
    expect(states[2].currentActivity).toBeNull();
    expect(states[2].recentEvents).toEqual([]);
  });

  it('tmux-configured agent with stale transcript and NO window is offline', async () => {
    const states = await collectAllAgents({
      agents: [DEFS[0]],
      readTranscript: async () => tx({ fresh: false }),
      listWindows: async () => [],
      resolveMetric: async () => okMetric,
      now: () => NOW,
    });
    expect(states[0].status).toBe('offline');
  });

  it('transcript-only agent: recent mtime -> online-idle, old mtime -> offline', async () => {
    const recent = new Date(NOW - 5 * 60_000).toISOString();
    const old = new Date(NOW - 2 * 60 * 60_000).toISOString();
    const mk = (iso: string) =>
      collectAllAgents({
        agents: [DEFS[2]],
        readTranscript: async () => tx({ fresh: false, lastActiveTs: iso }),
        listWindows: async () => {
          throw new Error('must not be called for tmux-less agents');
        },
        resolveMetric: async () => okMetric,
        now: () => NOW,
      });
    expect((await mk(recent))[0].status).toBe('online-idle');
    expect((await mk(old))[0].status).toBe('offline');
  });

  it('an agent without a resolvable transcript dir is unknown', async () => {
    const states = await collectAllAgents({
      agents: [{ id: 'ghost', displayName: 'Ghost', transcriptDir: null }],
      readTranscript: async () => tx({}),
      listWindows: async () => [],
      resolveMetric: async () => okMetric,
      now: () => NOW,
    });
    expect(states[0].status).toBe('unknown');
  });

  it('a throwing source degrades that agent to unknown without breaking others', async () => {
    const states = await collectAllAgents({
      agents: DEFS,
      readTranscript: async (dir: string) => {
        if (dir === '/t/coder') throw new Error('boom');
        return tx({ fresh: true });
      },
      listWindows: async () => ['writer'],
      resolveMetric: async () => okMetric,
      now: () => NOW,
    });
    expect(states[0].status).toBe('working');
    expect(states[1].status).toBe('unknown');
    expect(states[2].status).toBe('working'); // stub gives solo a fresh transcript
  });

  it('a failing listWindows degrades tmux agents to offline (never throws)', async () => {
    const states = await collectAllAgents({
      agents: [DEFS[0]],
      readTranscript: async () => tx({ fresh: false }),
      listWindows: async () => {
        throw new Error('tmux exploded');
      },
      resolveMetric: async () => okMetric,
      now: () => NOW,
    });
    expect(states[0].status).toBe('offline');
  });
});
