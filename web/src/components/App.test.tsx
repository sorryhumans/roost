import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from './App';
import { Hud } from './Hud';
import type { AgentId, AgentState } from '../types';

// A 4-element mock stream in registry order (General / Etsy / Upwork / Appdev).
const NAMES: Record<AgentId, string> = {
  general: 'General',
  etsy: 'Etsy',
  upwork: 'Upwork',
  appdev: 'Appdev',
};

function mock4(): AgentState[] {
  return (Object.keys(NAMES) as AgentId[]).map((id, i) => ({
    id,
    displayName: NAMES[id],
    status: i % 2 === 0 ? 'working' : 'online-idle',
    currentActivity: i % 2 === 0 ? 'Doing a thing' : null,
    recentEvents: [],
    metric: { label: 'Last active', value: `${i + 1}m ago` },
    lastActiveTs: '2026-06-09T05:00:00.000Z',
  }));
}

describe('App (jsdom has no WebGL -> legacy fallback path + HUD)', () => {
  it('renders the ROOST wordmark + "agents office" subtitle', () => {
    render(<App />);

    expect(screen.getByText('ROOST')).toBeInTheDocument();
    expect(screen.getByText('agents office')).toBeInTheDocument();
  });

  // SAFE-01 (structural) on the full App shell: zero command affordances.
  it('SAFE-01: App renders ZERO command affordances', () => {
    const { container } = render(<App />);

    expect(
      container.querySelector(
        'button,input,form,textarea,select,[role="button"],[role="textbox"]',
      ),
    ).toBeNull();
  });
});

describe('Hud', () => {
  it('renders a card per agent (desktop rail + mobile strip render the set)', () => {
    render(<Hud agents={mock4()} connected={true} />);

    for (const nm of Object.values(NAMES)) {
      expect(screen.getAllByText(nm).length).toBeGreaterThanOrEqual(1);
    }
  });

  it('shows the reconnecting hint when the stream drops', () => {
    render(<Hud agents={mock4()} connected={false} />);
    expect(screen.getByText(/Reconnecting/)).toBeInTheDocument();
  });

  // SAFE-01: the HUD (the only interactive-looking layer) has zero command affordances.
  it('SAFE-01: a populated Hud renders ZERO command affordances', () => {
    const { container } = render(<Hud agents={mock4()} connected={true} />);

    expect(
      container.querySelector(
        'button,input,form,textarea,select,[role="button"],[role="textbox"]',
      ),
    ).toBeNull();
  });
});

