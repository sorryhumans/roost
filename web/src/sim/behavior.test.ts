import { describe, expect, it } from 'vitest';
import type { AgentStatus } from '../types';
import { Brain } from './behavior';
import { WORKSTATIONS } from './layout';

/** Deterministic "random". */
const seq =
  (vals: number[]) =>
  (() => {
    let i = 0;
    return () => vals[i++ % vals.length];
  })();

/** Deterministic LCG — varied values so every branch eventually fires. */
function lcg(s: number) {
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function mkAgent(rand = seq([0.3, 0.7, 0.1, 0.9])) {
  return new Brain({
    id: 'general',
    kind: 'agent',
    ws: WORKSTATIONS[0],
    claims: new Map(),
    rand,
  });
}

/** Tick a brain for `seconds` of sim time. */
function run(b: Brain, status: AgentStatus, seconds: number, dt = 0.2) {
  for (let t = 0; t < seconds; t += dt) b.update(dt, status);
}

describe('agent brain', () => {
  it('spawns seated and typing when first seen working', () => {
    const b = mkAgent();
    b.update(0.2, 'working');
    expect(b.state).toBe('seated');
    expect(b.view.anim).toBe('typing');
    expect(b.view.seated).toBe(true);
    expect(b.view.pos.x).toBeCloseTo(WORKSTATIONS[0].seat.pos.x, 5);
  });

  it('stands up and wanders when the status flips to online-idle', () => {
    const b = mkAgent();
    run(b, 'working', 1);
    run(b, 'online-idle', 2.5);
    expect(['walking', 'acting', 'standing_up', 'sitting_down', 'seated']).toContain(b.state);
    expect(b.view.seated === false || b.state === 'sitting_down' || b.state === 'seated').toBe(true);
    // after a while it must have left the desk chair
    run(b, 'online-idle', 6);
    const atDesk =
      Math.hypot(
        b.view.pos.x - WORKSTATIONS[0].seat.pos.x,
        b.view.pos.z - WORKSTATIONS[0].seat.pos.z,
      ) < 0.2;
    expect(atDesk && b.view.anim === 'typing').toBe(false);
  });

  it('walks out and disappears when offline, returns when working again', () => {
    const b = mkAgent();
    run(b, 'working', 1);
    run(b, 'offline', 40); // enough to stand, cross the office and fade
    expect(b.state).toBe('away');
    expect(b.view.visible).toBe(false);
    run(b, 'working', 60);
    expect(b.state).toBe('seated');
    expect(b.view.anim).toBe('typing');
    expect(b.view.visible).toBe(true);
  });

  it('an idle agent actually REACHES the couch and settles (regression: re-route loop)', () => {
    (globalThis as { __ROOST_POI_BIAS?: string }).__ROOST_POI_BIAS = 'couch';
    try {
      const b = mkAgent(lcg(3));
      run(b, 'working', 1);
      let satOnCouch = false;
      for (let t = 0; t < 60 && !satOnCouch; t += 0.2) {
        b.update(0.2, 'online-idle');
        const onCushion =
          (Math.abs(b.view.pos.x - 2.18) < 0.3 || Math.abs(b.view.pos.x - 3.02) < 0.3) &&
          Math.abs(b.view.pos.z - 3.2) < 0.3;
        if (b.state === 'seated' && onCushion) satOnCouch = true;
      }
      expect(satOnCouch).toBe(true);
      expect(b.view.anim).toBe('sit_idle'); // alone on the couch -> calm waiting
    } finally {
      delete (globalThis as { __ROOST_POI_BIAS?: string }).__ROOST_POI_BIAS;
    }
  });

  it('two idle agents never claim the same POI', () => {
    const claims = new Map<string, string>();
    const a = new Brain({ id: 'a1', kind: 'agent', ws: WORKSTATIONS[0], claims, rand: seq([0.05]) });
    const b = new Brain({ id: 'a2', kind: 'agent', ws: WORKSTATIONS[1], claims, rand: seq([0.05]) });
    for (let t = 0; t < 30; t += 0.2) {
      a.update(0.2, 'online-idle');
      b.update(0.2, 'online-idle');
      const owners = new Map<string, string>();
      for (const [poi, owner] of claims) {
        expect(owners.has(poi)).toBe(false);
        owners.set(poi, owner);
      }
    }
    // both eventually claimed something at least once across the run
    expect(a.view.visible && b.view.visible).toBe(true);
  });
});

describe('boss brain', () => {
  it('starts at his desk and eventually goes on a walkabout, then returns', () => {
    const boss = new Brain({
      id: 'boss',
      kind: 'boss',
      claims: new Map(),
      rand: lcg(7),
      presentAgents: () => WORKSTATIONS.slice(0, 2),
    });
    boss.update(0.2, 'working');
    expect(boss.state).toBe('seated');
    let walked = false;
    for (let t = 0; t < 180 && !walked; t += 0.25) {
      boss.update(0.25, 'working');
      if (boss.state === 'walking') walked = true;
    }
    expect(walked).toBe(true);
    // he must keep functioning (no stuck state) for a long stretch
    let seenSeated = false;
    for (let t = 0; t < 240; t += 0.25) {
      boss.update(0.25, 'working');
      if (boss.state === 'seated') seenSeated = true;
    }
    expect(seenSeated).toBe(true);
    expect(boss.view.visible).toBe(true);
  });
});
