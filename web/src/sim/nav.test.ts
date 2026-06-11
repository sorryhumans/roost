import { describe, expect, it } from 'vitest';
import { NAV_EDGES, NAV_NODES, POIS, POI_NODE, WORKSTATIONS, EXIT } from './layout';
import { buildPath, nearestNode, nodePath, pathLength, PathWalker } from './nav';

describe('nav graph data integrity', () => {
  it('every edge endpoint is a defined node', () => {
    for (const [a, b] of NAV_EDGES) {
      expect(NAV_NODES[a], `node ${a}`).toBeDefined();
      expect(NAV_NODES[b], `node ${b}`).toBeDefined();
    }
  });

  it('every POI maps to a defined nav node', () => {
    for (const p of POIS) {
      expect(NAV_NODES[POI_NODE[p.id]], `poi ${p.id}`).toBeDefined();
    }
  });

  it('the whole graph is connected (every node reachable from "s")', () => {
    for (const id of Object.keys(NAV_NODES)) {
      expect(nodePath('s', id).length, `path s -> ${id}`).toBeGreaterThan(0);
    }
  });
});

describe('pathfinding', () => {
  it('routes from a desk approach to the water cooler', () => {
    const ws = WORKSTATIONS[0];
    const path = buildPath(ws.seat.approach, NAV_NODES.k_cool);
    expect(path.length).toBeGreaterThan(2);
    const last = path[path.length - 1];
    expect(last.x).toBeCloseTo(NAV_NODES.k_cool.x, 5);
    expect(last.z).toBeCloseTo(NAV_NODES.k_cool.z, 5);
  });

  it('routes from the boss desk out to the exit (through the door column)', () => {
    const path = buildPath(NAV_NODES.b_desk, EXIT);
    const ids = path.map((p) => nearestNode(p));
    expect(ids).toContain('d_in');
    expect(ids).toContain('d_out');
  });

  it('PathWalker reaches the end and reports done', () => {
    const path = buildPath(WORKSTATIONS[1].seat.approach, NAV_NODES.couch_a);
    const w = new PathWalker(path);
    const total = pathLength(path);
    w.advance(total + 0.1);
    expect(w.done).toBe(true);
    expect(w.pos.x).toBeCloseTo(path[path.length - 1].x, 5);
  });

  it('PathWalker heading points along the first segment', () => {
    const w = new PathWalker([
      { x: 0, z: 0 },
      { x: 0, z: -2 },
    ]);
    w.advance(0.5);
    // moving north (-z) means yaw 0 in our facing convention
    expect(Math.abs(w.headingYaw)).toBeLessThan(1e-6);
  });
});
