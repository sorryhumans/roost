import { useEffect, useState } from 'react';
import { STATUS_UI, type AgentState } from '../types';
import { DeskCard } from './DeskCard';

/**
 * Glass HUD over the 3D office: brand bar (top), live agent cards (right rail on
 * desktop, bottom strip on phones) and a one-line camera hint.
 *
 * READ-ONLY (SAFE-01): pure display — no buttons, inputs, forms or links.
 */
export function Hud({ agents, connected }: { agents: AgentState[]; connected: boolean }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 20_000);
    return () => clearInterval(t);
  }, []);
  const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const liveColor = connected ? STATUS_UI.working.color : STATUS_UI.unknown.color;

  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col">
      {/* top bar */}
      <header className="flex items-center gap-md px-md py-sm sm:px-lg">
        <div className="rounded-xl border border-border/70 bg-bg/55 px-md py-xs backdrop-blur-md">
          <div className="flex items-baseline gap-sm">
            <span className="text-heading font-bold tracking-[0.3em] text-text-primary">ROOST</span>
            <span className="hidden text-label normal-case text-text-muted sm:inline">
              agents office
            </span>
            <span
              data-testid="live-dot"
              className="inline-block h-2 w-2 rounded-full transition-colors"
              style={{ backgroundColor: liveColor, boxShadow: `0 0 8px ${liveColor}` }}
              aria-hidden="true"
            />
          </div>
        </div>
        {!connected ? (
          <span className="rounded-lg bg-bg/55 px-sm py-xs text-label normal-case text-text-faint backdrop-blur-md">
            Reconnecting…
          </span>
        ) : null}
        <div className="ml-auto rounded-xl border border-border/70 bg-bg/55 px-md py-xs text-body font-semibold tabular-nums text-text-primary backdrop-blur-md">
          {time}
        </div>
      </header>

      {/* right rail (desktop) */}
      <aside className="pointer-events-auto ml-auto mr-md hidden w-60 flex-col gap-sm overflow-y-auto pb-md lg:flex">
        {agents.map((a) => (
          <DeskCard key={a.id} agent={a} />
        ))}
      </aside>

      {/* bottom strip (mobile) + hint */}
      <footer className="mt-auto flex flex-col gap-sm pb-sm">
        <div className="pointer-events-auto flex gap-sm overflow-x-auto px-md lg:hidden">
          {agents.map((a) => (
            <div key={a.id} className="w-56 shrink-0">
              <DeskCard agent={a} />
            </div>
          ))}
        </div>
        <p className="px-md text-center text-label normal-case text-text-faint">
          drag to orbit · pinch to zoom · tap a person to focus
        </p>
      </footer>
    </div>
  );
}
