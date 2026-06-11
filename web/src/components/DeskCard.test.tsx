import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DeskCard } from './DeskCard';
import { STATUS_UI, type AgentState } from '../types';

/** Build a mock AgentState, overriding selected fields. */
function mockAgent(overrides: Partial<AgentState> = {}): AgentState {
  return {
    id: 'general',
    displayName: 'General',
    status: 'working',
    currentActivity: 'Running a command',
    recentEvents: [],
    metric: { label: 'Leads today', value: 7 },
    lastActiveTs: '2026-06-09T05:00:00.000Z',
    ...overrides,
  };
}

describe('DeskCard', () => {
  it('renders name, "Working" status label, activity text, and the metric label + value', () => {
    render(<DeskCard agent={mockAgent()} />);

    expect(screen.getByText('General')).toBeInTheDocument();
    expect(screen.getByText('Working')).toBeInTheDocument();
    expect(screen.getByText(/Running a command/)).toBeInTheDocument();
    expect(screen.getByText('Leads today')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
  });

  it('paints the status dot with the working accent color (#34D399)', () => {
    render(<DeskCard agent={mockAgent({ status: 'working' })} />);

    const dot = screen.getByTestId('status-dot');
    // STATUS_UI.working.color is '#34D399'; jsdom normalizes inline color to rgb().
    expect(dot).toHaveStyle({ backgroundColor: STATUS_UI.working.color });
  });

  it('renders the "—" em-dash placeholder when currentActivity is null (idle)', () => {
    render(
      <DeskCard
        agent={mockAgent({ status: 'online-idle', currentActivity: null })}
      />,
    );

    expect(screen.getByText('Idle')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('renders "Status unknown" + the faint unreadable copy for an unknown agent', () => {
    render(
      <DeskCard
        agent={mockAgent({ status: 'unknown', currentActivity: null })}
      />,
    );

    expect(screen.getByText('Status unknown')).toBeInTheDocument();
    expect(
      screen.getByText(/Can.?t read this agent right now\./),
    ).toBeInTheDocument();
    // The em-dash is NOT used for unknown — the dedicated copy replaces the now-doing line.
    expect(screen.queryByText('—')).toBeNull();
  });

  it('renders the optional metric detail when present', () => {
    render(
      <DeskCard
        agent={mockAgent({
          metric: { label: 'Products', value: 12, detail: 'meditation-set-3' },
        })}
      />,
    );

    expect(screen.getByText('meditation-set-3')).toBeInTheDocument();
  });

  // SAFE-01 (structural): the read-only mandate — a DeskCard must contain ZERO command
  // affordances. No matter the status, there is no button/input/form/role=button/role=textbox.
  it('SAFE-01: renders ZERO command affordances (no button/input/form/role controls)', () => {
    const { container } = render(<DeskCard agent={mockAgent()} />);

    expect(
      container.querySelector(
        'button,input,form,[role="button"],[role="textbox"]',
      ),
    ).toBeNull();
  });
});
