// Waypoint-graph navigation: BFS shortest path (hop count) + polyline walker.
// Pure logic, no three.js — unit tested.

import { NAV_NODES, NAV_EDGES, type Vec2 } from './layout';

const adj: Record<string, string[]> = {};
for (const [a, b] of NAV_EDGES) {
  (adj[a] = adj[a] || []).push(b);
  (adj[b] = adj[b] || []).push(a);
}

export function nearestNode(p: Vec2): string {
  let best = '';
  let bd = Infinity;
  for (const [id, n] of Object.entries(NAV_NODES)) {
    const d = (n.x - p.x) ** 2 + (n.z - p.z) ** 2;
    if (d < bd) {
      bd = d;
      best = id;
    }
  }
  return best;
}

/** BFS node-id path from `from` to `to` (inclusive). Empty array if unreachable. */
export function nodePath(from: string, to: string): string[] {
  if (from === to) return [from];
  const prev: Record<string, string> = {};
  const q = [from];
  const seen = new Set([from]);
  while (q.length) {
    const cur = q.shift()!;
    for (const nb of adj[cur] || []) {
      if (seen.has(nb)) continue;
      seen.add(nb);
      prev[nb] = cur;
      if (nb === to) {
        const path = [to];
        let c = to;
        while (c !== from) {
          c = prev[c];
          path.unshift(c);
        }
        return path;
      }
      q.push(nb);
    }
  }
  return [];
}

/**
 * Build a world-space polyline from a start position to a target position,
 * routed through the nav graph. Skips graph hops when start/target share a node.
 */
export function buildPath(from: Vec2, to: Vec2): Vec2[] {
  const a = nearestNode(from);
  const b = nearestNode(to);
  const ids = nodePath(a, b);
  const pts: Vec2[] = [{ ...from }];
  for (const id of ids) pts.push({ ...NAV_NODES[id] });
  pts.push({ ...to });
  // drop consecutive points closer than 15cm (start/end often equal a node)
  const out: Vec2[] = [pts[0]];
  for (const p of pts.slice(1)) {
    const l = out[out.length - 1];
    if (Math.hypot(p.x - l.x, p.z - l.z) > 0.15) out.push(p);
  }
  return out;
}

/** Total length of a polyline in meters. */
export function pathLength(pts: Vec2[]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
  }
  return len;
}

/** Stateful polyline walker: call advance(dist), read pos/heading/done. */
export class PathWalker {
  private pts: Vec2[];
  private seg = 0;
  private segPos = 0;
  pos: Vec2;
  /** Unit direction of current segment. */
  dir: Vec2 = { x: 0, z: 1 };
  done = false;

  constructor(pts: Vec2[]) {
    this.pts = pts.length > 1 ? pts : [...pts, ...pts];
    this.pos = { ...this.pts[0] };
    this.updateDir();
  }

  private segLen(i: number): number {
    const a = this.pts[i];
    const b = this.pts[i + 1];
    return Math.hypot(b.x - a.x, b.z - a.z);
  }

  private updateDir() {
    const a = this.pts[this.seg];
    const b = this.pts[Math.min(this.seg + 1, this.pts.length - 1)];
    const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    this.dir = { x: (b.x - a.x) / l, z: (b.z - a.z) / l };
  }

  advance(dist: number) {
    if (this.done) return;
    let remaining = dist;
    while (remaining > 0) {
      const sl = this.segLen(this.seg);
      if (this.segPos + remaining < sl) {
        this.segPos += remaining;
        remaining = 0;
      } else {
        remaining -= sl - this.segPos;
        this.seg++;
        this.segPos = 0;
        if (this.seg >= this.pts.length - 1) {
          this.pos = { ...this.pts[this.pts.length - 1] };
          this.done = true;
          return;
        }
        this.updateDir();
      }
    }
    const a = this.pts[this.seg];
    this.pos = { x: a.x + this.dir.x * this.segPos, z: a.z + this.dir.z * this.segPos };
  }

  /** Yaw so the character faces along `dir` (facing = (-sin, -cos) convention). */
  get headingYaw(): number {
    return Math.atan2(-this.dir.x, -this.dir.z);
  }
}
