import { useEffect, useState } from 'react';
import type { AgentState, AgentStatus } from '../types';

/**
 * Scripted agent feed for `?demo=1`: cycles through realistic status combinations
 * so the 3D office can be previewed (and screenshotted) without the live server.
 * Display-only data — nothing here touches a real agent.
 */
const NAMES: Record<string, string> = {
  research: 'Research',
  writer: 'Writer',
  coder: 'Coder',
  support: 'Support',
};

const ACTS: Record<AgentStatus, string | null> = {
  working: 'Editing src/server.ts',
  'online-idle': 'Waiting for a task',
  offline: null,
  unknown: null,
};

const SCRIPT: AgentStatus[][] = [
  ['working', 'working', 'working', 'online-idle'],
  ['working', 'online-idle', 'working', 'online-idle'],
  ['online-idle', 'online-idle', 'working', 'offline'],
  ['working', 'working', 'online-idle', 'offline'],
  ['working', 'offline', 'working', 'working'],
];

function mk(step: number): AgentState[] {
  const ids = ['research', 'writer', 'coder', 'support'] as const;
  return ids.map((id, i) => {
    const status = SCRIPT[step % SCRIPT.length][i];
    return {
      id,
      displayName: NAMES[id],
      status,
      currentActivity: ACTS[status] && `${ACTS[status]}`,
      recentEvents: [],
      metric: { label: i % 2 ? 'Products' : 'Leads today', value: 3 + ((step + i * 3) % 9) },
      lastActiveTs: null,
    };
  });
}

export function useDemoAgents(enabled: boolean, stepMs = 14_000): AgentState[] {
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => setStep((s) => s + 1), stepMs);
    return () => clearInterval(t);
  }, [enabled, stepMs]);
  return enabled ? mk(step) : [];
}
