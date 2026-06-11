import { useEffect, useRef, useState } from 'react';
import type { AgentState } from '../types';
import { OfficeEngine } from './engine';

/**
 * React shell around the vanilla three.js OfficeEngine. Owns the canvas + the
 * floating name-label layer; feeds live AgentState[] into the engine.
 *
 * READ-ONLY (SAFE-01): the canvas only renders state and orbits the camera.
 * No pointer interaction can message, stop or configure an agent.
 */
export function OfficeScene({ agents, onFail }: { agents: AgentState[]; onFail: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<OfficeEngine | null>(null);
  const [progress, setProgress] = useState<string | null>('Loading the office…');

  useEffect(() => {
    if (!canvasRef.current || !labelsRef.current || engineRef.current) return;
    // dev/QA self-capture: ?snap=name.png posts the framebuffer to a local saver
    const params = new URLSearchParams(window.location.search);
    const snap = params.get('snap');
    const style = params.get('style') === 'b' ? 'b' : 'a';
    const poiBias = params.get('poi');
    if (poiBias) (globalThis as { __ROOST_POI_BIAS?: string }).__ROOST_POI_BIAS = poiBias;
    const engine = new OfficeEngine({
      canvas: canvasRef.current,
      labelLayer: labelsRef.current,
      reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      style,
      preserveDrawingBuffer: !!snap,
      onProgress: (m) => setProgress(m),
      onReady: () => {
        setProgress(null);
        if (snap) {
          const after = Number(params.get('snapAfter') ?? 4000);
          setTimeout(() => {
            try {
              const x = new XMLHttpRequest();
              x.open('POST', `/save?name=${encodeURIComponent(snap)}`, false);
              x.send(engine.snapshot());
            } catch {
              /* saver not running — ignore */
            }
          }, after);
        }
      },
    });
    engineRef.current = engine;
    engine.init().catch(() => {
      engine.dispose();
      onFail();
    });
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onMq = () => engine.setReducedMotion(mq.matches);
    mq.addEventListener?.('change', onMq);
    return () => {
      mq.removeEventListener?.('change', onMq);
      engine.dispose();
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (agents.length) engineRef.current?.setAgents(agents);
  }, [agents]);

  return (
    <div className="absolute inset-0">
      <canvas ref={canvasRef} className="block h-full w-full touch-none" />
      <div ref={labelsRef} className="pointer-events-none absolute inset-0 overflow-hidden" />
      {progress ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-md bg-bg">
          <div className="text-display font-bold tracking-[0.35em] text-text-primary">ROOST</div>
          <div className="h-1 w-40 overflow-hidden rounded-full bg-border">
            <div className="roost-loadbar h-full w-1/3 rounded-full bg-status-working" />
          </div>
          <p className="text-label normal-case text-text-muted">{progress}</p>
        </div>
      ) : null}
    </div>
  );
}

export default OfficeScene;
