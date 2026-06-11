import { DeskCard } from './DeskCard';
import type { AgentState } from '../types';

/**
 * The 4-desk grid: 2 columns on wide screens, single-column stack on narrow.
 * Basic responsiveness only — refined breakpoints + touch sizing are Phase 3.
 * Read-only: renders DeskCards (no controls).
 */
export function DeskGrid({ agents }: { agents: AgentState[] }) {
  return (
    <div className="grid grid-cols-1 gap-lg md:grid-cols-2">
      {agents.map((agent) => (
        <DeskCard key={agent.id} agent={agent} />
      ))}
    </div>
  );
}
