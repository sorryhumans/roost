// Agent registry — built from roost.config.json on first use.
//
// READ-ONLY: this module only resolves paths; it never writes anything.

import { loadConfig, resolveTranscriptDir, type RoostConfig } from './config.js';
import type { AgentDefinition } from './types.js';

/** Pure: turn a validated config into the runtime registry. */
export function buildAgents(
  config: RoostConfig,
  resolveDir: (project: string) => string | null = resolveTranscriptDir,
): AgentDefinition[] {
  return config.agents.map((a) => ({
    id: a.id,
    displayName: a.name,
    tmuxSession: a.tmux?.session,
    tmuxWindow: a.tmux?.window,
    transcriptDir: resolveDir(a.project),
    metric: a.metric,
  }));
}

let cached: AgentDefinition[] | null = null;

/**
 * The configured agents (memoized). Throws a setup-hint error when
 * roost.config.json is missing — entrypoints surface it verbatim.
 */
export function getAgents(): AgentDefinition[] {
  if (!cached) {
    cached = buildAgents(loadConfig());
    for (const a of cached) {
      if (!a.transcriptDir) {
        console.warn(
          `[roost] agent "${a.id}": no Claude Code transcripts found for project — ` +
            'it will show as "unknown" until that project has a session.',
        );
      }
    }
  }
  return cached;
}
