import { iconFor, STATUS_UI, type AgentState } from '../types';

/**
 * Presentational desk (UI-SPEC DeskCard anatomy). Renders, top→bottom:
 *   role icon + nameplate (display name + role label) · status dot + status label ·
 *   "now doing" line (or "—" when idle; special copy when unknown) · metric chip.
 *
 * READ-ONLY (SAFE-01): this is a non-interactive article element. ZERO command
 * affordances — no interactive button / text-entry / form markup, and no click handler or
 * link that messages/stops/edits/configures an agent. The card only displays the
 * contracted AgentState fields. (Enforced by the structural assertion in DeskCard.test.tsx.)
 */
export function DeskCard({ agent }: { agent: AgentState }) {
  const { color, label } = STATUS_UI[agent.status];
  const Icon = iconFor(agent.id);
  const isUnknown = agent.status === 'unknown';

  return (
    <article className="flex flex-col gap-xs rounded-lg border border-border bg-surface px-sm py-xs">
      {/* Compact row: role icon + name + status dot/label (all on one line) */}
      <header className="flex items-center gap-xs">
        <Icon className="h-4 w-4 shrink-0 text-text-muted" aria-hidden="true" />
        <span className="truncate text-body font-semibold leading-tight text-text-primary">
          {agent.displayName}
        </span>
        <span
          data-testid="status-dot"
          className="ml-auto inline-block h-2 w-2 shrink-0 rounded-full transition-colors"
          style={{ backgroundColor: color }}
          aria-hidden="true"
        />
        <span className="text-label tracking-wide" style={{ color }}>
          {label}
        </span>
      </header>

      {/* Now-doing line (one compact line). Unknown gets the dedicated copy; idle/null gets the em-dash. */}
      {isUnknown ? (
        <p className="text-label normal-case leading-tight text-text-faint">
          Can&rsquo;t read this agent right now.
        </p>
      ) : (
        <p className="truncate text-label normal-case leading-tight text-text-muted">
          {agent.currentActivity ?? '—'}
        </p>
      )}

      {/* Metric inline: label + value (+ optional faint detail) on one compact line. */}
      <div className="flex items-baseline gap-xs">
        <span className="text-label tracking-wide text-text-muted">{agent.metric.label}</span>
        <span className="text-body font-semibold text-text-primary">{agent.metric.value}</span>
        {agent.metric.detail ? (
          <span className="truncate text-label normal-case text-text-faint">
            {agent.metric.detail}
          </span>
        ) : null}
      </div>
    </article>
  );
}
