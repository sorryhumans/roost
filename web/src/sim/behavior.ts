// Character behavior state machines. Pure logic (no three.js) so it is unit-testable.
// The engine ticks each Brain with the live agent status; the Brain exposes a view
// (position, yaw, animation, opacity) that the engine applies to the 3D character.

import type { AgentStatus } from '../types';
import { BOSS, BOSS_STOPS, EXIT, POIS, type Poi, type Seat, type Vec2, type Workstation } from './layout';
import { buildPath, PathWalker } from './nav';

export type AnimName =
  | 'typing'
  | 'sit_talk'
  | 'walk'
  | 'drink'
  | 'point'
  | 'stand_idle'
  | 'sit_down'
  | 'stand_up'
  | 'sit_idle'
  | 'phone'
  | 'meeting';

export type BrainState =
  | 'away'
  | 'fading_in'
  | 'fading_out'
  | 'walking'
  | 'sitting_down'
  | 'standing_up'
  | 'seated'
  | 'acting';

export interface ActorView {
  pos: Vec2;
  yaw: number;
  anim: AnimName;
  /** Play the current anim once (transitions) instead of looping. */
  once: boolean;
  opacity: number;
  visible: boolean;
  /** True while on a chair/couch (engine applies the seat height offset). */
  seated: boolean;
  /** Seat-height drop while seated (chair vs couch cushions differ). */
  seatDrop: number;
}

export interface BrainOpts {
  id: string;
  kind: 'agent' | 'boss';
  ws?: Workstation;
  /** Shared POI claim registry (poiId -> actorId) so two actors don't overlap. */
  claims: Map<string, string>;
  /** Boss only: which agents are present (visitable). */
  presentAgents?: () => Workstation[];
  rand?: () => number;
  /** Real duration (s) of a one-shot clip — the engine knows the loaded clips. */
  animDuration?: (a: AnimName) => number | undefined;
}

const WALK_SPEED = 1.0; // m/s, tuned to the walking clip stride
const FADE_T = 0.9;
const DESK_SEAT_DROP = -0.42;

interface WalkGoal {
  to: Vec2;
  yawAtEnd?: number;
  next: 'sit' | 'act' | 'fade_out' | 'stand';
  seat?: Seat | { pos: Vec2; yaw: number };
  /** True only when heading to the OWN desk (couch sits are wander goals). */
  toDesk?: boolean;
  poi?: Poi;
  actAnim?: AnimName;
  actT?: number;
}

export class Brain {
  readonly id: string;
  readonly kind: 'agent' | 'boss';
  state: BrainState = 'away';
  view: ActorView;
  private ws?: Workstation;
  private claims: Map<string, string>;
  private rand: () => number;
  private presentAgents: () => Workstation[];
  private animDur: (a: AnimName) => number | undefined;

  private walker?: PathWalker;
  private goal?: WalkGoal;
  private t = 0; // generic state timer
  private actT = 0; // remaining action time
  private talkT = 0; // seated typing<->talk variety timer
  private talking = false;
  private slide?: {
    from: Vec2;
    to: Vec2;
    fromYaw: number;
    toYaw: number;
    t: number;
    dur: number;
    /** Push the XZ translation to the late part of the transition (sitting). */
    lateXZ?: boolean;
  };
  private lastStatus: AgentStatus | null = null;
  private bossPhase: 'work' | 'out' = 'work';

  constructor(opts: BrainOpts) {
    this.id = opts.id;
    this.kind = opts.kind;
    this.ws = opts.ws;
    this.claims = opts.claims;
    this.rand = opts.rand ?? Math.random;
    this.presentAgents = opts.presentAgents ?? (() => []);
    this.animDur = opts.animDuration ?? (() => undefined);
    const seat = this.homeSeat();
    this.view = {
      pos: { ...seat.pos },
      yaw: seat.yaw,
      anim: 'typing',
      once: false,
      opacity: 0,
      visible: false,
      seated: false,
      seatDrop: DESK_SEAT_DROP,
    };
  }

  private homeSeat(): Seat {
    return this.kind === 'boss' ? BOSS.seat : this.ws!.seat;
  }

  /** Spawn already settled in a state matching the first observed status. */
  private spawnFor(status: AgentStatus) {
    const seat = this.homeSeat();
    if (status === 'working' || this.kind === 'boss') {
      this.state = 'seated';
      this.view = { ...this.view, pos: { ...seat.pos }, yaw: seat.yaw, anim: 'typing', once: false, opacity: 1, visible: true, seated: true };
      this.talkT = 6 + this.rand() * 10;
    } else if (status === 'online-idle') {
      this.state = 'acting';
      this.actT = 1 + this.rand() * 3;
      this.view = { ...this.view, pos: { ...seat.approach }, yaw: seat.yaw, anim: 'stand_idle', once: false, opacity: 1, visible: true, seated: false };
    } else {
      this.state = 'away';
      this.view.visible = false;
      this.view.opacity = 0;
    }
  }

  private releaseClaims() {
    for (const [k, v] of this.claims) if (v === this.id) this.claims.delete(k);
  }

  private startWalk(to: Vec2, next: WalkGoal['next'], extra?: Partial<WalkGoal>) {
    this.walker = new PathWalker(buildPath(this.view.pos, to));
    this.goal = { to, next, ...extra };
    this.state = 'walking';
    this.view.anim = 'walk';
    this.view.once = false;
    this.view.seated = false;
  }

  // Real Mixamo transitions: "Stand To Sit" / "Sit To Stand" play once while the
  // root slides between the approach point and the seat; the engine eases the
  // seat-height drop in parallel (Hips.position is stripped from all clips).
  private startSitDown(seat: Seat | { pos: Vec2; yaw: number; drop?: number }) {
    const dur = Math.min(this.animDur('sit_down') ?? 1.2, 2.8);
    this.state = 'sitting_down';
    this.view.anim = 'sit_down';
    this.view.once = true;
    this.view.seated = true;
    this.view.seatDrop = seat.drop ?? DESK_SEAT_DROP;
    this.t = dur;
    this.slide = {
      from: { ...this.view.pos },
      to: { ...seat.pos },
      fromYaw: this.view.yaw,
      toYaw: seat.yaw,
      t: 0,
      dur,
      lateXZ: true, // fold in place first, translate onto the seat late in the clip
    };
  }

  private startStandUp(to: Vec2) {
    const dur = Math.min(this.animDur('stand_up') ?? 1.0, 2.2);
    this.state = 'standing_up';
    this.view.anim = 'stand_up';
    this.view.once = true;
    this.view.seated = false;
    this.t = dur;
    this.slide = {
      from: { ...this.view.pos },
      to: { ...to },
      fromYaw: this.view.yaw,
      toYaw: this.view.yaw,
      t: 0,
      dur,
      lateXZ: true, // rise in place first, step away from the seat late in the clip
    };
  }

  /** While seated on the couch: calm when alone, chatting when a colleague joins. */
  private couchAnim(): AnimName {
    let mine: string | undefined;
    for (const [poi, owner] of this.claims) {
      if (owner === this.id && poi.startsWith('couch_')) mine = poi;
    }
    if (!mine) return 'sit_idle';
    const sibling = mine === 'couch_a' ? 'couch_b' : 'couch_a';
    const other = this.claims.get(sibling);
    if (other && other !== this.id) {
      return this.id.charCodeAt(0) % 2 ? 'sit_talk' : 'meeting';
    }
    return 'sit_idle';
  }

  /**
   * Weighted idle-destination choice so downtime reads as a sensible routine:
   * the couch (waiting for a task) is the favourite — even more so when a
   * colleague is already sitting there (people gravitate to company).
   */
  private pickPoi(): Poi | undefined {
    const free = POIS.filter((p) => !this.claims.has(p.id) || this.claims.get(p.id) === this.id);
    if (!free.length) return undefined;
    // QA hook (?poi=<prefix> in the app): bias idle agents to one POI for screenshots
    const bias = (globalThis as { __ROOST_POI_BIAS?: string }).__ROOST_POI_BIAS;
    if (bias) {
      const biased = free.find((p) => p.id.startsWith(bias));
      if (biased) return biased;
    }
    const pool: Poi[] = [];
    for (const p of free) {
      let w = 1;
      if (p.id.startsWith('couch_')) {
        const sibling = p.id === 'couch_a' ? 'couch_b' : 'couch_a';
        const siblingOwner = this.claims.get(sibling);
        w = siblingOwner && siblingOwner !== this.id ? 4 : 2;
      }
      for (let i = 0; i < w; i++) pool.push(p);
    }
    return pool[Math.floor(this.rand() * pool.length)];
  }

  /** Main tick. Agents pass their live status; the boss ignores it. */
  update(dt: number, status: AgentStatus) {
    if (this.lastStatus === null) {
      this.lastStatus = status;
      this.spawnFor(this.kind === 'boss' ? 'working' : status);
      return;
    }

    const goalKind = this.kind === 'boss' ? 'boss' : statusGoal(status);

    switch (this.state) {
      case 'away': {
        if (goalKind !== 'away') {
          this.state = 'fading_in';
          this.view.pos = { ...EXIT };
          this.view.visible = true;
          this.view.opacity = 0;
          this.view.anim = 'stand_idle';
          this.view.seated = false;
          this.t = FADE_T;
        }
        break;
      }
      case 'fading_in': {
        this.t -= dt;
        this.view.opacity = Math.min(1, 1 - this.t / FADE_T);
        if (this.t <= 0) {
          this.view.opacity = 1;
          this.routeForGoal(goalKind);
        }
        break;
      }
      case 'fading_out': {
        this.t -= dt;
        this.view.opacity = Math.max(0, this.t / FADE_T);
        if (this.t <= 0) {
          this.view.visible = false;
          this.state = 'away';
          this.releaseClaims();
        }
        break;
      }
      case 'walking': {
        // Status flips mid-walk: reroute (unless already heading out and still leaving).
        if (this.interruptIfNeeded(goalKind)) break;
        this.walker!.advance(WALK_SPEED * dt);
        this.view.pos = { ...this.walker!.pos };
        this.view.yaw = dampYaw(this.view.yaw, this.walker!.headingYaw, dt * 9);
        if (this.walker!.done) this.arrive();
        break;
      }
      case 'sitting_down': {
        this.advanceSlide(dt);
        this.t -= dt;
        if (this.t <= 0) {
          this.state = 'seated';
          this.view.once = false;
          this.view.anim = this.atHomeSeat() ? 'typing' : this.couchAnim();
          this.talkT = 8 + this.rand() * 12;
          if (this.goal?.actAnim === 'sit_talk') this.actT = this.goal.actT ?? 9;
        }
        break;
      }
      case 'standing_up': {
        this.advanceSlide(dt);
        this.t -= dt;
        if (this.t <= 0) {
          this.view.seated = false;
          this.routeForGoal(goalKind);
        }
        break;
      }
      case 'seated': {
        const onCouch = !this.atHomeSeat();
        if (this.kind === 'boss') {
          this.bossSeated(dt);
          break;
        }
        if (goalKind === 'desk' && onCouch) {
          this.startStandUp(this.couchExitPos());
          break;
        }
        if (goalKind === 'away' || (goalKind === 'wander' && !onCouch)) {
          this.startStandUp(this.ws ? { ...this.ws.seat.approach } : { ...this.view.pos });
          break;
        }
        if (onCouch) {
          // seated at a couch POI while idle: calm alone, chatting in company
          const want = this.couchAnim();
          if (this.view.anim !== want) {
            this.view.anim = want;
            this.view.once = false;
          }
          this.actT -= dt;
          if (this.actT <= 0) this.startStandUp(this.couchExitPos());
          break;
        }
        // typing at own desk: occasional chat variation
        this.talkT -= dt;
        if (this.talkT <= 0) {
          this.talking = !this.talking && this.rand() < 0.4;
          this.view.anim = this.talking ? 'sit_talk' : 'typing';
          this.talkT = this.talking ? 4 + this.rand() * 4 : 9 + this.rand() * 14;
        }
        break;
      }
      case 'acting': {
        if (this.interruptIfNeeded(goalKind)) break;
        this.actT -= dt;
        if (this.actT <= 0) {
          this.releaseClaims();
          if (this.kind === 'boss') this.bossNext();
          else if (goalKind === 'wander') this.wanderNext();
          else this.routeForGoal(goalKind);
        }
        break;
      }
    }
    this.lastStatus = status;
  }

  // --- helpers ---------------------------------------------------------------

  private atHomeSeat(): boolean {
    const s = this.homeSeat();
    return Math.hypot(this.view.pos.x - s.pos.x, this.view.pos.z - s.pos.z) < 0.25;
  }

  private couchExitPos(): Vec2 {
    // stand back up at the POI stand position (west of the couch seat)
    const poi = POIS.find((p) => p.seat && Math.hypot(p.seat.x - this.view.pos.x, p.seat.z - this.view.pos.z) < 0.3);
    return poi ? { ...poi.pos } : { ...this.view.pos };
  }

  private advanceSlide(dt: number) {
    if (!this.slide) return;
    this.slide.t = Math.min(this.slide.dur, this.slide.t + dt);
    const p = this.slide.t / this.slide.dur;
    // body turns early; the root moves onto the seat only as the clip folds down
    const k = this.slide.lateXZ ? p * p * p : easeInOut(p);
    this.view.pos = {
      x: this.slide.from.x + (this.slide.to.x - this.slide.from.x) * k,
      z: this.slide.from.z + (this.slide.to.z - this.slide.from.z) * k,
    };
    this.view.yaw = lerpAngle(this.slide.fromYaw, this.slide.toYaw, Math.min(1, p * 2.2));
  }

  private interruptIfNeeded(goalKind: GoalKind): boolean {
    const heading = this.goal?.next;
    const headedOut = heading === 'fade_out';
    if (goalKind === 'away' && !headedOut) {
      this.releaseClaims();
      this.startWalk(EXIT, 'fade_out');
      return true;
    }
    if (goalKind === 'desk' && !this.goal?.toDesk && this.kind === 'agent') {
      this.releaseClaims();
      this.startWalk(this.ws!.seat.approach, 'sit', { seat: this.ws!.seat, toDesk: true });
      return true;
    }
    if (goalKind === 'wander' && (this.goal?.toDesk || headedOut) && this.kind === 'agent') {
      this.releaseClaims();
      this.wanderNext();
      return true;
    }
    return false;
  }

  private routeForGoal(goalKind: GoalKind) {
    if (this.kind === 'boss') {
      this.startWalk(BOSS.seat.approach, 'sit', { seat: BOSS.seat });
      return;
    }
    if (goalKind === 'desk') {
      this.startWalk(this.ws!.seat.approach, 'sit', { seat: this.ws!.seat, toDesk: true });
    } else if (goalKind === 'wander') {
      this.wanderNext();
    } else {
      this.startWalk(EXIT, 'fade_out');
    }
  }

  private wanderNext() {
    const poi = this.pickPoi();
    if (!poi) {
      this.state = 'acting';
      this.actT = 4 + this.rand() * 4;
      this.view.anim = 'stand_idle';
      this.view.once = false;
      return;
    }
    this.claims.set(poi.id, this.id);
    if (poi.act === 'sit_talk' && poi.seat) {
      // settle in on the couch for a proper while — "waiting for the next task"
      this.startWalk(poi.pos, 'sit', {
        seat: { pos: poi.seat, yaw: poi.yaw, drop: poi.seatDrop },
        actAnim: 'sit_talk',
        actT: 25 + this.rand() * 25,
        poi,
      });
    } else {
      const dwell = poi.act === 'drink' ? 10 + this.rand() * 6 : 10 + this.rand() * 8;
      this.startWalk(poi.pos, 'act', { yawAtEnd: poi.yaw, actAnim: actAnim(poi), actT: dwell, poi });
    }
  }

  private arrive() {
    const g = this.goal!;
    if (g.next === 'sit' && g.seat) {
      this.startSitDown(g.seat);
    } else if (g.next === 'act') {
      this.state = 'acting';
      this.actT = g.actT ?? 7;
      this.view.anim = g.actAnim ?? 'stand_idle';
      this.view.once = false;
      if (g.yawAtEnd !== undefined) this.view.yaw = g.yawAtEnd;
    } else if (g.next === 'fade_out') {
      this.state = 'fading_out';
      this.t = FADE_T;
      this.view.anim = 'stand_idle';
      this.view.once = false;
    } else {
      this.state = 'acting';
      this.actT = 2 + this.rand() * 3;
      this.view.anim = 'stand_idle';
      this.view.once = false;
      if (g.yawAtEnd !== undefined) this.view.yaw = g.yawAtEnd;
    }
  }

  // --- boss script -------------------------------------------------------------

  private bossSeated(dt: number) {
    this.talkT -= dt;
    if (this.talkT > 0) return;
    if (this.bossPhase === 'work' && this.rand() < 0.45) {
      // alternate typing / a seated discussion at the desk
      this.view.anim = this.view.anim === 'typing' ? 'meeting' : 'typing';
      this.talkT = 8 + this.rand() * 14;
      return;
    }
    // go on a walkabout
    this.bossPhase = 'out';
    this.startStandUp({ ...BOSS.seat.approach });
  }

  private bossNext() {
    // visit only agents who are actually WORKING (pointing at an empty chair is silly)
    const stops: { pos: Vec2; yaw: number; anim: AnimName; t: number }[] = [];
    for (const ws of this.presentAgents()) {
      stops.push({ pos: ws.visit.pos, yaw: ws.visit.yaw, anim: 'point', t: 6 + this.rand() * 4 });
    }
    const STOP_ANIM: Record<string, AnimName> = {
      drink: 'drink',
      point: 'point',
      phone: 'phone',
      idle: 'stand_idle',
    };
    for (const s of BOSS_STOPS) {
      stops.push({
        pos: s.pos,
        yaw: s.yaw,
        anim: STOP_ANIM[s.act] ?? 'stand_idle',
        t: s.act === 'phone' ? 12 + this.rand() * 8 : 7 + this.rand() * 5,
      });
    }
    const headHome = this.rand() < 0.45;
    if (headHome || !stops.length) {
      this.bossPhase = 'work';
      this.talkT = 18 + this.rand() * 25;
      this.startWalk(BOSS.seat.approach, 'sit', { seat: BOSS.seat });
      return;
    }
    const s = stops[Math.floor(this.rand() * stops.length)];
    this.startWalk(s.pos, 'act', { yawAtEnd: s.yaw, actAnim: s.anim, actT: s.t });
  }
}

type GoalKind = 'desk' | 'wander' | 'away' | 'boss';

export function statusGoal(status: AgentStatus): GoalKind {
  if (status === 'working') return 'desk';
  if (status === 'online-idle') return 'wander';
  return 'away';
}

function actAnim(poi: Poi): AnimName {
  if (poi.act === 'drink') return 'drink';
  if (poi.act === 'point') return 'point';
  if (poi.act === 'sit_talk') return 'sit_talk';
  return 'stand_idle';
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return a + d * t;
}

export function dampYaw(cur: number, target: number, k: number): number {
  return lerpAngle(cur, target, Math.min(1, k));
}
