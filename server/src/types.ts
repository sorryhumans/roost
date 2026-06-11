// The normalized, redacted per-agent contract the collector emits.
//
// This shape is LOCKED in 01-CONTEXT.md and consumed by Plan 02's source
// readers and collectAllAgents() assembler. Do not widen or rename fields
// without updating the locked context — downstream plans implement against it.

/** Agent ids come from roost.config.json (1-4 agents, one per desk). */
export type AgentId = string;

/**
 * Liveness state for a desk.
 * - working:     newest transcript mtime within the working threshold (~25s)
 * - online-idle: tmux window exists but transcript is stale
 * - offline:     no tmux window AND transcript very stale
 * - unknown:     a source errored/was unreadable for this agent (RESIL-01) — never thrown
 */
export type AgentStatus = 'working' | 'online-idle' | 'offline' | 'unknown';

/**
 * One entry in a desk's recent-activity feed.
 * LABELS ONLY — never raw transcript text, inputs, or outputs (SAFE-02 structural layer).
 */
export interface RecentEvent {
  /** ISO 8601 string for the event time. */
  ts: string;
  /** Sanitized, human-friendly label derived server-side. Never raw content. */
  label: string;
}

/** A desk's single headline business number. */
export interface AgentMetric {
  /** e.g. "Leads today", "Products", "Last active". */
  label: string;
  /** Integer count, or "—" when the source is missing, or a string like "5m ago". */
  value: number | string;
  /** Optional supporting detail, e.g. the freshest Etsy product dir name. */
  detail?: string;
}

/** The normalized, redacted state for a single agent — the unit the collector emits. */
export interface AgentState {
  id: AgentId;
  displayName: string;
  status: AgentStatus;
  /** Friendly "now doing" label, or null when idle/unknown. */
  currentActivity: string | null;
  /** Newest-first, capped at 10, labels only. */
  recentEvents: RecentEvent[];
  metric: AgentMetric;
  /** ISO 8601 of the newest transcript mtime, or null when unavailable. */
  lastActiveTs: string | null;
}

/**
 * A registry entry describing where to READ an agent's signals.
 * Built from roost.config.json (see config.ts).
 */
export interface AgentDefinition {
  id: AgentId;
  displayName: string;
  /** Optional tmux presence source: session + window names. */
  tmuxSession?: string;
  tmuxWindow?: string;
  /** Absolute transcript directory, or null when it could not be located. */
  transcriptDir: string | null;
  /** Headline metric config; defaults to last-active. */
  metric?: { type: 'lastActive'; label?: string } | { type: 'fileCount'; dir: string; label: string };
}
