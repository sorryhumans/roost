// Mirror of server/src/types.ts — the web package is separate and cannot import from
// server/. Keep field names byte-identical so JSON.parse(e.data) from the /events SSE
// stream is correctly typed. If the server contract changes, update this file to match.

import type { LucideIcon } from 'lucide-react';
import { Bot, Cpu, Rocket, Sparkles } from 'lucide-react';

/** Agent ids come from the server's roost.config.json (1-4 agents). */
export type AgentId = string;

/**
 * Liveness state for a desk.
 * - working:     newest transcript mtime within the working threshold (~25s)
 * - online-idle: tmux window exists but transcript is stale
 * - offline:     no tmux window AND transcript very stale
 * - unknown:     a source errored/was unreadable for this agent (RESIL-01)
 */
export type AgentStatus = 'working' | 'online-idle' | 'offline' | 'unknown';

/**
 * One entry in a desk's recent-activity feed.
 * LABELS ONLY — never raw transcript text, inputs, or outputs (SAFE-02 structural layer).
 * NOT displayed this phase — the styled recent-activity feed is Phase 3.
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

// ---------------------------------------------------------------------------
// Web-only presentation maps (from 02-UI-SPEC.md). Implemented once, reused.
// ---------------------------------------------------------------------------

/** Status → { dot/accent color, text label } — the UI-SPEC status language table. */
export const STATUS_UI: Record<AgentStatus, { color: string; label: string }> = {
  working: { color: '#34D399', label: 'Working' },
  'online-idle': { color: '#FBBF24', label: 'Idle' },
  offline: { color: '#6B7280', label: 'Offline' },
  unknown: { color: '#4B5563', label: 'Status unknown' },
};

/** Stable per-agent icon: same id always gets the same icon. */
const ICONS: LucideIcon[] = [Bot, Rocket, Cpu, Sparkles];
export function iconFor(id: AgentId): LucideIcon {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return ICONS[h % ICONS.length];
}
