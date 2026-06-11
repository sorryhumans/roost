// Office floor plan — single source of truth for the 3D scene AND the nav graph.
// Units are meters. Origin = room center. +x east, +z south (toward the camera).
// Character yaw convention: facing direction = (-sin(yaw), 0, -cos(yaw)), i.e.
// yaw 0 faces north (-z), yaw π faces south (+z, toward the camera).

import type { AgentId } from '../types';

/** The four desk SLOTS. Live agents are assigned to slots in config order. */
export const SLOT_IDS = ['ws1', 'ws2', 'ws3', 'ws4'] as const;

export interface Vec2 {
  x: number;
  z: number;
}

/** Room shell. North (-z) and west (-x) walls are visible at the iso camera angle. */
export const ROOM = { w: 11, d: 9, h: 3.05 } as const;

/** A seat someone can occupy: world chair position + the yaw the sitter faces. */
export interface Seat {
  pos: Vec2;
  yaw: number;
  /** Where to walk to before sitting down (just behind the chair). */
  approach: Vec2;
  /** Seat-height drop (defaults to the desk-chair drop). */
  drop?: number;
}

/** One agent workstation: keyed by agent id, ordered for deterministic placement. */
export interface Workstation {
  agent: AgentId;
  seat: Seat;
  /** Desk group center + yaw (same yaw as sitter). */
  desk: Vec2;
  /** Where the boss stands when he visits this desk (beside it, facing the sitter). */
  visit: { pos: Vec2; yaw: number };
}

const WS = (agent: AgentId, cx: number, chairZ: number, yaw: number): Workstation => {
  const fz = -Math.cos(yaw); // forward z for this yaw (x component is 0 for our rows)
  const side = cx < 0 ? -1 : 1; // boss visits from the OUTER aisle, never inside the island
  return {
    agent,
    seat: {
      pos: { x: cx, z: chairZ },
      yaw,
      approach: { x: cx, z: chairZ - fz * 0.85 },
    },
    desk: { x: cx, z: chairZ + fz * 0.55 },
    visit: {
      pos: { x: cx + side * 1.2, z: chairZ },
      yaw: side < 0 ? -Math.PI / 2 : Math.PI / 2,
    },
  };
};

/**
 * Desk island 2×2: north row faces south (faces visible to the camera),
 * south row faces north (their monitors face the camera). Labels disambiguate.
 */
export const WORKSTATIONS: Workstation[] = [
  WS('ws1', -0.95, -0.95, Math.PI), // north row, faces camera
  WS('ws2', 0.95, -0.95, Math.PI), // north row, faces camera
  WS('ws3', -0.95, 0.95, 0), // south row, screen to camera
  WS('ws4', 0.95, 0.95, 0), // south row, screen to camera
];

/** Boss corner office (NW, glass-walled). Faces SE into the room. */
export const BOSS = {
  seat: {
    pos: { x: -4.05, z: -3.05 },
    yaw: (-3 * Math.PI) / 4,
    approach: { x: -4.55, z: -3.55 },
  } as Seat,
  desk: { x: -3.66, z: -2.66 },
  /** Glass partition lines. */
  glassX: -2.5, // east glass wall, z from -4.5 to -1.5
  glassZ: -1.5, // south glass wall, x from -5.5 to -2.5
  door: { x: -3.05, halfW: 0.42 }, // opening in the south glass
} as const;

/** Points of interest idle characters wander to. `act` maps to an animation. */
export interface Poi {
  id: string;
  /** Where to stand. */
  pos: Vec2;
  /** Direction to face while acting. */
  yaw: number;
  act: 'drink' | 'point' | 'idle' | 'sit_talk';
  /** Couch POIs carry the actual seat (slide from pos to seat when sitting). */
  seat?: Vec2;
  /** Seat-height drop for this seat (couch cushions are lower than desk chairs). */
  seatDrop?: number;
}

// Agent-reachable idle spots. The whiteboard is deliberately NOT here — an agent
// pointing at a board alone reads wrong; presenting is a boss-only move.
export const POIS: Poi[] = [
  { id: 'cooler', pos: { x: 1.95, z: -3.35 }, yaw: 0, act: 'drink' },
  { id: 'coffee', pos: { x: 2.6, z: -3.35 }, yaw: 0, act: 'drink' },
  { id: 'window', pos: { x: 0.6, z: -3.7 }, yaw: 0, act: 'idle' },
  // Couch faces NORTH (into the office). Seat points sit on the two measured
  // cushion centers (probe-couch height map: cushions at ±0.42 of the width,
  // tops at 0.55m -> drop -0.34); stand points hug the cushion front edge.
  { id: 'couch_a', pos: { x: 2.18, z: 2.72 }, yaw: 0, act: 'sit_talk', seat: { x: 2.18, z: 3.2 }, seatDrop: -0.34 },
  { id: 'couch_b', pos: { x: 3.02, z: 2.72 }, yaw: 0, act: 'sit_talk', seat: { x: 3.02, z: 3.2 }, seatDrop: -0.34 },
];

/** Boss-only walkabout stops (besides visiting working agents' desks). */
export const BOSS_STOPS: { pos: Vec2; yaw: number; act: 'drink' | 'point' | 'idle' | 'phone' }[] = [
  { pos: { x: 1.95, z: -3.35 }, yaw: 0, act: 'drink' },
  { pos: { x: 0.6, z: -3.7 }, yaw: 0, act: 'idle' },
  { pos: { x: -4.55, z: 1.3 }, yaw: Math.PI / 2, act: 'point' }, // presents at the whiteboard
  { pos: { x: -4.85, z: -3.9 }, yaw: 0, act: 'phone' }, // at his office window, clear NW corner
];

/** Where offline characters walk to before fading out (south edge of the floor). */
export const EXIT: Vec2 = { x: -1.3, z: 4.1 };

/** Hand-authored walkable graph: nodes + undirected edges, all in clear aisles. */
export const NAV_NODES: Record<string, Vec2> = {
  // south aisle
  sw: { x: -2.4, z: 2.3 },
  s: { x: 0, z: 2.3 },
  se: { x: 2.3, z: 2.3 },
  // side aisles
  w: { x: -2.4, z: 0.15 },
  e: { x: 2.3, z: 0.15 },
  // north aisle
  nw: { x: -2.4, z: -2.2 },
  n: { x: 0.3, z: -2.2 },
  ne: { x: 2.3, z: -2.2 },
  // kitchen / window
  k_cool: { x: 1.95, z: -3.35 },
  k_cof: { x: 2.6, z: -3.35 },
  win: { x: 0.6, z: -3.7 },
  // whiteboard spur
  wsw: { x: -3.7, z: 1.5 },
  wb: { x: -4.55, z: 1.3 },
  // boss office door column + inside
  d_out: { x: -3.05, z: -1.0 },
  d_in: { x: -3.05, z: -2.1 },
  b_desk: { x: -4.55, z: -3.55 },
  // lounge
  l_in: { x: 1.9, z: 2.1 },
  couch_a: { x: 2.18, z: 2.72 },
  couch_b: { x: 3.02, z: 2.72 },
  // exit (door to the unseen south corridor)
  exit: { x: -1.3, z: 4.1 },
  // desk seat approaches (behind each chair)
  ap_ws1: { x: -0.95, z: -1.8 },
  ap_ws2: { x: 0.95, z: -1.8 },
  ap_ws3: { x: -0.95, z: 1.8 },
  ap_ws4: { x: 0.95, z: 1.8 },
  // boss visit spots beside each desk (in the side aisles)
  v_ws1: { x: -2.15, z: -0.95 },
  v_ws2: { x: 2.15, z: -0.95 },
  v_ws3: { x: -2.15, z: 0.95 },
  v_ws4: { x: 2.15, z: 0.95 },
};

export const NAV_EDGES: [string, string][] = [
  ['sw', 's'],
  ['s', 'se'],
  ['sw', 'w'],
  ['w', 'nw'],
  ['se', 'e'],
  ['e', 'ne'],
  ['nw', 'n'],
  ['n', 'ne'],
  // kitchen / window spurs
  ['ne', 'k_cool'],
  ['ne', 'k_cof'],
  ['n', 'k_cool'],
  ['n', 'win'],
  // whiteboard
  ['sw', 'wsw'],
  ['wsw', 'wb'],
  // boss office
  ['nw', 'd_out'],
  ['d_out', 'd_in'],
  ['d_in', 'b_desk'],
  // lounge
  ['se', 'l_in'],
  ['l_in', 'couch_a'],
  ['l_in', 'couch_b'],
  // exit
  ['sw', 'exit'],
  ['s', 'exit'],
  // desk approaches
  ['ap_ws1', 'nw'],
  ['ap_ws1', 'n'],
  ['ap_ws2', 'n'],
  ['ap_ws2', 'ne'],
  ['ap_ws3', 'sw'],
  ['ap_ws3', 's'],
  ['ap_ws4', 's'],
  ['ap_ws4', 'se'],
  // boss visit spots (along the side aisles)
  ['v_ws1', 'w'],
  ['v_ws1', 'nw'],
  ['v_ws3', 'w'],
  ['v_ws3', 'sw'],
  ['v_ws2', 'e'],
  ['v_ws2', 'ne'],
  ['v_ws4', 'e'],
  ['v_ws4', 'se'],
];

/** POI id → nav node id (where walking ends before the action starts). */
export const POI_NODE: Record<string, string> = {
  cooler: 'k_cool',
  coffee: 'k_cof',
  window: 'win',
  couch_a: 'couch_a',
  couch_b: 'couch_b',
};
