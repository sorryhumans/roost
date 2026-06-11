// roost.config.json loader — the single place a user describes THEIR agents.
//
// {
//   "agents": [
//     {
//       "id": "writer",
//       "name": "Writer",
//       "project": "/home/you/projects/blog-agent",
//       "tmux": { "session": "agents", "window": "writer" },   // optional
//       "metric": { "type": "fileCount", "dir": "/home/you/projects/blog-agent/posts", "label": "Posts" } // optional
//     }
//   ]
// }
//
// `project` is the working directory the agent's Claude Code session runs in.
// Transcripts for it live under ~/.claude/projects/<encoded>; we locate that
// directory by normalized matching so users never deal with the encoding.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface AgentTmuxConfig {
  session: string;
  window: string;
}

export type AgentMetricConfig =
  | { type: 'lastActive'; label?: string }
  | { type: 'fileCount'; dir: string; label: string };

export interface AgentConfigEntry {
  id: string;
  name: string;
  /** Absolute path of the project directory the agent's Claude Code runs in. */
  project: string;
  tmux?: AgentTmuxConfig;
  metric?: AgentMetricConfig;
}

export interface RoostConfig {
  agents: AgentConfigEntry[];
}

export const MAX_AGENTS = 4;

/** Strip everything but [a-z0-9] for tolerant path comparison. */
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Locate the Claude Code transcript directory for a project path by comparing
 * normalized names against the real ~/.claude/projects entries. Falls back to
 * the literal encoding (/ and _ -> -) when no listing is possible.
 */
export function resolveTranscriptDir(
  project: string,
  projectsRoot: string = join(homedir(), '.claude', 'projects'),
): string | null {
  const target = norm(project);
  try {
    const entries = readdirSync(projectsRoot, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory() && norm(e.name) === target) {
        return join(projectsRoot, e.name);
      }
    }
  } catch {
    // projects root unreadable -> fall through to the literal guess
  }
  const guess = join(projectsRoot, project.replace(/[/_]/g, '-'));
  return existsSync(guess) ? guess : null;
}

/** Validation that throws a single, human-readable error. */
function validate(raw: unknown, path: string): RoostConfig {
  const fail = (msg: string): never => {
    throw new Error(`Invalid ${path}: ${msg}`);
  };
  if (!raw || typeof raw !== 'object') fail('not a JSON object');
  const agents = (raw as { agents?: unknown }).agents;
  if (!Array.isArray(agents) || agents.length === 0) {
    fail('"agents" must be a non-empty array');
  }
  if ((agents as unknown[]).length > MAX_AGENTS) {
    fail(`up to ${MAX_AGENTS} agents are supported (the office has 4 desks)`);
  }
  const seen = new Set<string>();
  for (const a of agents as Record<string, unknown>[]) {
    if (!a || typeof a !== 'object') fail('every agent must be an object');
    if (typeof a.id !== 'string' || !/^[a-z0-9_-]{1,24}$/i.test(a.id)) {
      fail('every agent needs an "id" (letters/digits/dashes, max 24 chars)');
    }
    if (seen.has(a.id as string)) fail(`duplicate agent id "${a.id}"`);
    seen.add(a.id as string);
    if (typeof a.name !== 'string' || !(a.name as string).trim()) {
      fail(`agent "${a.id}": "name" is required`);
    }
    if (typeof a.project !== 'string' || !(a.project as string).startsWith('/')) {
      fail(`agent "${a.id}": "project" must be an absolute path`);
    }
    const tmux = a.tmux as Record<string, unknown> | undefined;
    if (tmux !== undefined) {
      if (typeof tmux !== 'object' || typeof tmux.session !== 'string' || typeof tmux.window !== 'string') {
        fail(`agent "${a.id}": "tmux" needs { session, window }`);
      }
    }
    const metric = a.metric as Record<string, unknown> | undefined;
    if (metric !== undefined) {
      if (metric.type === 'fileCount') {
        if (typeof metric.dir !== 'string' || typeof metric.label !== 'string') {
          fail(`agent "${a.id}": fileCount metric needs { dir, label }`);
        }
      } else if (metric.type !== 'lastActive') {
        fail(`agent "${a.id}": metric.type must be "lastActive" or "fileCount"`);
      }
    }
  }
  return { agents: agents as unknown as AgentConfigEntry[] };
}

/** Candidate config locations, nearest first. */
function candidatePaths(): string[] {
  const here = dirname(fileURLToPath(import.meta.url));
  return [
    process.env.ROOST_CONFIG ?? '',
    resolve(process.cwd(), 'roost.config.json'),
    resolve(here, '..', '..', 'roost.config.json'), // repo root when run from server/
  ].filter(Boolean);
}

/**
 * Load and validate the config. Throws with a setup hint when missing —
 * the CLI/server entrypoints surface that message verbatim.
 */
export function loadConfig(explicitPath?: string): RoostConfig {
  const paths = explicitPath ? [explicitPath] : candidatePaths();
  for (const p of paths) {
    if (!existsSync(p)) continue;
    const raw: unknown = JSON.parse(readFileSync(p, 'utf8'));
    return validate(raw, p);
  }
  throw new Error(
    'roost.config.json not found. Copy roost.config.example.json to roost.config.json ' +
      'in the repo root and describe your agents (see README).',
  );
}
