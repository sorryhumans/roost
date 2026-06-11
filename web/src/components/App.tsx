import { lazy, Suspense, useMemo, useState } from 'react';
import { useAgentStream } from '../hooks/useAgentStream';
import { useDemoAgents } from '../hooks/useDemoAgents';
import { Hud } from './Hud';
import { DeskGrid } from './DeskGrid';

// The 3D scene (three.js) is lazy-loaded so non-WebGL environments (and tests)
// never touch it. If WebGL is missing or the engine fails, we fall back to a
// plain desk-card grid — the dashboard always renders something.
const OfficeScene = lazy(() => import('../three/OfficeScene'));

function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

/**
 * Roost — live 3D "game office" view of the four agents + the boss.
 *
 * READ-ONLY (SAFE-01): zero command affordances anywhere — no buttons, inputs,
 * forms, or controls that could reach an agent. The page only renders the
 * receive-only /events stream (or the scripted ?demo=1 feed for previews).
 */
export function App() {
  const demo = useMemo(() => new URLSearchParams(window.location.search).has('demo'), []);
  const stream = useAgentStream(demo ? null : '/events');
  const demoAgents = useDemoAgents(demo);
  const agents = demo ? demoAgents : stream.agents;
  const connected = demo ? true : stream.connected;
  const [webgl, setWebgl] = useState(hasWebGL);

  return (
    <main className="fixed inset-0 overflow-hidden bg-bg">
      {webgl ? (
        <Suspense
          fallback={
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-display font-bold tracking-[0.35em] text-text-primary">
                ROOST
              </span>
            </div>
          }
        >
          <OfficeScene agents={agents} onFail={() => setWebgl(false)} />
        </Suspense>
      ) : (
        <div className="absolute inset-0 overflow-y-auto p-md pt-16">
          {agents.length ? <DeskGrid agents={agents} /> : null}
        </div>
      )}
      <Hud agents={agents} connected={connected} />
    </main>
  );
}
