import { useEffect, useState } from 'react';
import type { AgentState } from '../types';

/**
 * Subscribe to the live `/events` SSE stream and surface the latest AgentState[].
 *
 * READ-ONLY by design: EventSource is receive-only — the browser sends nothing
 * upstream. This hook never POSTs, never writes, never messages an agent. It only
 * listens and exposes a connection flag (SAFE-01 / read-only mandate).
 *
 * Wire format (Plan 01 server): each push is `data: <JSON AgentState[]>`. Heartbeat
 * lines are SSE comments (`: ping`) and are NOT delivered as messages — ignored.
 * EventSource auto-reconnects on drop; `onerror` flips `connected` false so the UI
 * can show "Reconnecting…" while the browser retries on its own.
 */
export function useAgentStream(url: string | null = '/events'): {
  agents: AgentState[];
  connected: boolean;
} {
  const [agents, setAgents] = useState<AgentState[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (url === null) return; // demo mode: stay inert
    const es = new EventSource(url);

    es.onopen = () => setConnected(true);

    es.onmessage = (e: MessageEvent<string>) => {
      try {
        const next = JSON.parse(e.data) as AgentState[];
        setAgents(next);
        setConnected(true);
      } catch {
        // Ignore malformed frames; keep the last good snapshot on screen.
      }
    };

    es.onerror = () => {
      // EventSource retries automatically; we only surface the lost-connection flag.
      setConnected(false);
    };

    return () => es.close();
  }, [url]);

  return { agents, connected };
}
