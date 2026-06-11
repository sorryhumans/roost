// Source C — per-agent headline metric resolvers.
//
// READ-ONLY (SAFE-03): only fs READ APIs (readdir, stat). No writes.
//
// Two metric types, chosen in roost.config.json per agent:
//  - lastActive (default): friendly "Xm ago" from the newest transcript mtime.
//  - fileCount: count of entries in a directory (e.g. produced artifacts),
//    hidden/underscore-prefixed names excluded; detail = freshest entry name,
//    redact()'d before it leaves the server.
//
// RESILIENCE: every branch catches and degrades to { label, value: '--' }.

import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentDefinition, AgentMetric } from '../types.js';
import { redact } from '../redact.js';

/**
 * Pure: turn a transcript mtime ISO into a friendly "last active" label.
 * null -> "--"; < 60s -> "just now"; else floored "Xm ago". Never throws.
 */
export function minutesAgoLabel(iso: string | null): string {
  if (!iso) return '--';
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '--';
  const deltaMs = Date.now() - then;
  if (deltaMs < 60_000) return 'just now';
  const minutes = Math.floor(deltaMs / 60_000);
  return `${minutes}m ago`;
}

/** Count visible entries in a directory; detail = freshest entry name. */
async function fileCountMetric(dir: string, label: string): Promise<AgentMetric> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const visible = entries
      .map((e) => e.name)
      .filter((n) => !n.startsWith('.') && !n.startsWith('_'));
    if (visible.length === 0) return { label, value: 0 };

    let freshest: { name: string; mtimeMs: number } | null = null;
    for (const name of visible) {
      try {
        const st = await stat(join(dir, name));
        if (!freshest || st.mtimeMs > freshest.mtimeMs) freshest = { name, mtimeMs: st.mtimeMs };
      } catch {
        // unreadable entry still counts toward the total
      }
    }
    const metric: AgentMetric = { label, value: visible.length };
    if (freshest) metric.detail = redact(freshest.name);
    return metric;
  } catch {
    return { label, value: '--' };
  }
}

/**
 * Resolve an agent's headline metric per its config. Never throws — any
 * failure degrades to { label, value: '--' }.
 */
export async function resolveMetric(
  agent: AgentDefinition,
  transcript: { lastActiveTs: string | null },
): Promise<AgentMetric> {
  try {
    if (agent.metric?.type === 'fileCount') {
      return await fileCountMetric(agent.metric.dir, agent.metric.label);
    }
    const label = agent.metric?.label ?? 'Last active';
    return { label, value: minutesAgoLabel(transcript.lastActiveTs) };
  } catch {
    return { label: 'Last active', value: '--' };
  }
}
