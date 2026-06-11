// Source A — Claude Code session transcripts (PRIMARY: status + activity).
//
// READ-ONLY: this module uses only fs READ APIs (readdir, stat, readFile). It
// never writes anything. (SAFE-03)
//
// SECURITY (SAFE-02, structural layer): activity is derived as LABELS ONLY. The
// classifier looks at a line's tool `name` and block `type` ONLY — it never
// reads `input`, `text`, or `tool_result.content` VALUES into a label. Raw
// transcript content (which may contain tokens / PII) is discarded, not
// serialized. This is the first line of defense; redact() is the second layer
// applied elsewhere to strings that genuinely must pass through.
//
// RESILIENCE (RESIL-01): every path is wrapped so a missing dir, unreadable
// file, bad JSON, or a mid-write partial LAST line degrades to a safe "no data"
// result. readTranscript never throws.

import { readdir, stat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RecentEvent } from '../types.js';

/**
 * A transcript newer than this many ms (by newest .jsonl mtime) is considered
 * "fresh" (the agent is actively working). Exported + configurable. The final
 * working/online-idle/offline decision is made in the collector using tmux;
 * this source only reports `fresh`.
 */
export const WORKING_THRESHOLD_MS = 25_000;

/** Cap on emitted recent events (newest-first). */
const RECENT_EVENTS_CAP = 10;

/** How many trailing parsed lines to consider for the recentEvents feed. */
const RECENT_SCAN_WINDOW = 30;

/** The normalized, content-free result of reading one agent's transcript dir. */
export interface TranscriptResult {
  /** false when the dir/file was missing or unreadable (caller maps to unknown). */
  ok: boolean;
  /** ISO 8601 of the newest .jsonl mtime, or null. */
  lastActiveTs: string | null;
  /** true when newest mtime is within WORKING_THRESHOLD_MS of now. */
  fresh: boolean;
  /** Friendly label for the newest meaningful line, or null. LABELS ONLY. */
  currentActivity: string | null;
  /** Newest-first, capped at 10, labels only. */
  recentEvents: RecentEvent[];
}

const EMPTY: TranscriptResult = {
  ok: false,
  lastActiveTs: null,
  fresh: false,
  currentActivity: null,
  recentEvents: [],
};

/** Metadata-only line types that never represent meaningful activity. */
const META_TYPES = new Set([
  'mode',
  'permission-mode',
  'last-prompt',
  'ai-title',
  'file-history-snapshot',
  'system',
  'attachment',
]);

/**
 * Map a tool name to a friendly label. Derived from the NAME ONLY — never from
 * the tool's `input`. Order matters: regex-matched MCP names before the generic
 * mcp__ fallback.
 */
function labelForTool(name: string): string {
  switch (name) {
    case 'Bash':
      return 'Running a command';
    case 'Edit':
    case 'Write':
    case 'MultiEdit':
      return 'Editing a file';
    case 'Read':
      return 'Reading a file';
    case 'Grep':
    case 'Glob':
      return 'Searching files';
    case 'WebSearch':
      return 'Searching the web';
    case 'WebFetch':
      return 'Reading a web page';
    case 'Task':
      return 'Delegating to a sub-agent';
  }
  if (/telegram.*reply/i.test(name)) return 'Replying on Telegram';
  if (/mobai/i.test(name)) return 'Driving the simulator';
  if (name.startsWith('mcp__')) return 'Using a tool';
  return 'Working';
}

/**
 * Classify one parsed transcript line to a LABEL, or null if it is not a
 * meaningful activity line. Reads ONLY structural fields: line `type`, the
 * block `type`, and (for tool_use) the tool `name`. NEVER reads input/text/
 * content VALUES — that is the structural secret/PII defense.
 */
function classifyLine(parsed: unknown): string | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const line = parsed as Record<string, unknown>;
  const type = line.type;
  if (typeof type !== 'string') return null;
  if (META_TYPES.has(type)) return null;

  if (type === 'assistant') {
    const message = line.message as Record<string, unknown> | undefined;
    const content = message?.content;
    if (Array.isArray(content)) {
      // Use the LAST block to reflect the newest action on this line.
      for (let i = content.length - 1; i >= 0; i--) {
        const block = content[i] as Record<string, unknown> | undefined;
        const bType = block?.type;
        if (bType === 'tool_use') {
          const name = block?.name;
          return labelForTool(typeof name === 'string' ? name : '');
        }
        if (bType === 'text') {
          return 'Thinking / replying';
        }
      }
    }
    return null;
  }

  if (type === 'user') {
    // A tool result arrives as a user line with a top-level toolUseResult/toolResult.
    if ('toolUseResult' in line || 'toolResult' in line) {
      return 'Finished a step';
    }
    return null;
  }

  // Any other line type (e.g. unknown future types) is not meaningful activity.
  return null;
}

/** Find the newest-mtime .jsonl in dir, or null. Throws are caught by caller. */
async function newestJsonl(dir: string): Promise<{ path: string; mtimeMs: number } | null> {
  const entries = await readdir(dir);
  let best: { path: string; mtimeMs: number } | null = null;
  for (const name of entries) {
    if (!name.endsWith('.jsonl')) continue;
    const full = join(dir, name);
    try {
      const st = await stat(full);
      if (!st.isFile()) continue;
      if (!best || st.mtimeMs > best.mtimeMs) best = { path: full, mtimeMs: st.mtimeMs };
    } catch {
      // skip an entry we cannot stat
    }
  }
  return best;
}

/**
 * Read an agent's transcript dir and produce a content-free TranscriptResult.
 * Never throws — any error returns the safe EMPTY result (ok:false).
 */
export async function readTranscript(dir: string): Promise<TranscriptResult> {
  try {
    const newest = await newestJsonl(dir);
    if (!newest) return EMPTY;

    const mtimeIso = new Date(newest.mtimeMs).toISOString();
    const fresh = Date.now() - newest.mtimeMs < WORKING_THRESHOLD_MS;

    // Read + parse defensively. A mid-write partial LAST line is invalid JSON
    // and is simply skipped (RESIL-01).
    let raw = '';
    try {
      raw = await readFile(newest.path, 'utf8');
    } catch {
      // file vanished/locked after stat -> we still know mtime/fresh.
      return { ok: true, lastActiveTs: mtimeIso, fresh, currentActivity: null, recentEvents: [] };
    }

    const lines = raw.split('\n');
    const parsed: { value: unknown; ts: string }[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const value = JSON.parse(trimmed) as unknown;
        const ts = extractTs(value) ?? mtimeIso;
        parsed.push({ value, ts });
      } catch {
        // partial / corrupt line -> skip
      }
    }

    // currentActivity: newest meaningful line (scan from the end).
    let currentActivity: string | null = null;
    for (let i = parsed.length - 1; i >= 0; i--) {
      const label = classifyLine(parsed[i].value);
      if (label) {
        currentActivity = label;
        break;
      }
    }

    // recentEvents: last RECENT_SCAN_WINDOW parsed lines -> meaningful -> {ts,label}
    // -> newest-first -> cap.
    const tail = parsed.slice(-RECENT_SCAN_WINDOW);
    const events: RecentEvent[] = [];
    for (const { value, ts } of tail) {
      const label = classifyLine(value);
      if (label) events.push({ ts, label });
    }
    events.reverse(); // newest-first
    const recentEvents = events.slice(0, RECENT_EVENTS_CAP);

    return { ok: true, lastActiveTs: mtimeIso, fresh, currentActivity, recentEvents };
  } catch {
    return EMPTY;
  }
}

/** Pull a line's ISO timestamp if present (structural field only). */
function extractTs(value: unknown): string | null {
  if (value && typeof value === 'object') {
    const ts = (value as Record<string, unknown>).timestamp;
    if (typeof ts === 'string') return ts;
  }
  return null;
}
