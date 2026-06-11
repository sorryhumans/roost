// Furniture: loads the CC0/CC-BY low-poly GLB set and places it per the layout.
// Every model is normalized to a real-world size (the source packs use wildly
// different native units), so placement is in meters like everything else.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { BOSS, ROOM, WORKSTATIONS } from '../sim/layout';

const FWD = (yaw: number) => ({ x: -Math.sin(yaw), z: -Math.cos(yaw) });
const RIGHT = (yaw: number) => ({ x: Math.cos(yaw), z: -Math.sin(yaw) });

interface Place {
  file: string;
  x: number;
  z: number;
  /** Final absolute rotation around Y. */
  rotY?: number;
  /** Normalize so the scaled height (y) equals this. */
  h?: number;
  /** ...or so the scaled width (x in model space) equals this. */
  w?: number;
  /** Lift (for wall-mounted / on-top-of-surface items). */
  y?: number;
  /** Register the top surface height under this key (desks, counters). */
  topKey?: string;
  /** Place on a previously registered surface. */
  onTop?: string;
}

// Most of these packs model "front" toward +z; rotY is the facing direction the
// item should look at. Tuned visually against the first renders.
const PLACES: Place[] = [
  // --- boss corner office (NW) ---
  { file: 'desk_exec', x: BOSS.desk.x, z: BOSS.desk.z, rotY: BOSS.seat.yaw + Math.PI, h: 0.66, topKey: 'boss_desk' },
  { file: 'chair_exec', x: BOSS.seat.pos.x, z: BOSS.seat.pos.z, rotY: BOSS.seat.yaw + Math.PI, h: 1.15 },
  { file: 'plant_white', x: -2.95, z: -4.05, h: 1.0 },
  // --- kitchenette (NE, one tidy run along the north wall) ---
  { file: 'counter', x: 2.6, z: -4.15, rotY: Math.PI, h: 0.92, topKey: 'kcounter1' },
  { file: 'counter', x: 3.1, z: -4.15, rotY: Math.PI, h: 0.92, topKey: 'kcounter2' },
  { file: 'coffee_machine', x: 0, z: 0, rotY: Math.PI, h: 0.42, onTop: 'kcounter1' },
  { file: 'vending', x: 4.25, z: -3.95, rotY: Math.PI, h: 1.9 },
  { file: 'water_cooler', x: 1.95, z: -4.1, rotY: Math.PI, h: 1.25 },
  // --- print corner / north wall ---
  { file: 'counter', x: 0.55, z: -4.0, rotY: Math.PI, h: 0.92, topKey: 'pcounter' },
  { file: 'printer', x: 0, z: 0, rotY: Math.PI, h: 0.3, onTop: 'pcounter' },
  { file: 'bookcase', x: -1.45, z: -4.26, rotY: Math.PI, h: 2.05 },
  { file: 'file_cabinet', x: 1.35, z: -4.15, rotY: Math.PI, h: 1.25 },
  { file: 'clock', x: 1.5, z: -4.45, rotY: Math.PI, h: 0.42, y: 2.4 },
  // --- lounge: couch faces NORTH into the office, anchored at the south edge ---
  { file: 'rug_round', x: 2.7, z: 3.0, w: 2.6, y: 0.006 },
  { file: 'couch', x: 2.6, z: 3.35, rotY: Math.PI, w: 1.95 },
  { file: 'coffee_table', x: 2.6, z: 2.3, rotY: 0, h: 0.4, topKey: 'ctable' },
  { file: 'plant_palm', x: 4.5, z: 3.7, h: 1.85 },
  { file: 'trash', x: 4.35, z: 2.1, h: 0.4 },
  // --- whiteboard (west wall) ---
  { file: 'whiteboard', x: -5.38, z: 1.3, rotY: Math.PI / 2, w: 1.8, y: 0 },
  // --- island extras + greenery ---
  { file: 'rug_modern', x: 0, z: 0, rotY: Math.PI / 2, w: 3.6, y: 0.004 },
  { file: 'trash', x: 1.9, z: -0.1, h: 0.38 },
  { file: 'plant_monstera', x: 4.95, z: -2.5, h: 0.7 },
  { file: 'plant_monstera', x: -4.6, z: 3.7, h: 1.1 },
];

// Per-workstation furniture is derived from the layout so desks/chairs always
// match where the characters sit.
function workstationPlaces(): Place[] {
  const out: Place[] = [];
  for (const ws of WORKSTATIONS) {
    const yaw = ws.seat.yaw;
    // Desk normalized by HEIGHT: top lands at 0.65m so the measured typing-hand
    // arc (0.69..0.75 at drop -0.42, probe-hands) hovers ON the keyboard, never
    // under the desktop.
    out.push({
      file: 'desk',
      x: ws.desk.x,
      z: ws.desk.z,
      rotY: yaw + Math.PI,
      h: 0.65,
      topKey: 'desk_' + ws.agent,
    });
    out.push({ file: 'chair_blue', x: ws.seat.pos.x, z: ws.seat.pos.z, rotY: yaw + Math.PI, h: 1.0 });
    const f = FWD(yaw);
    const r = RIGHT(yaw);
    out.push({
      file: 'desk_lamp',
      x: ws.seat.pos.x + f.x * 0.68 + r.x * 0.34,
      z: ws.seat.pos.z + f.z * 0.68 + r.z * 0.34,
      rotY: yaw + Math.PI * 0.9, // head leans inward, over the desk
      h: 0.34,
      onTop: 'desk_' + ws.agent + ':xz',
    });
  }
  return out;
}

export interface FurnitureResult {
  group: THREE.Group;
  /** topKey -> world Y of that surface top. */
  tops: Record<string, number>;
}

/** Per-file restyle for the modern palettes. Values: hex = repaint, 'ash' = desaturate+lighten. */
export type RecolorMap = Record<string, string | 'ash'>;

const restyled = new WeakSet<THREE.Material>();

function applyRecolor(obj: THREE.Object3D, mode: string | 'ash') {
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      const sm = m as THREE.MeshStandardMaterial;
      if (!sm.color || restyled.has(sm)) continue;
      restyled.add(sm);
      if (mode === 'ash') {
        sm.color.offsetHSL(-0.02, -0.28, 0.1);
      } else {
        // repaint but keep some of the original light/dark contrast
        const lum = sm.color.getHSL({ h: 0, s: 0, l: 0 }).l;
        sm.color.set(mode).offsetHSL(0, 0, (lum - 0.5) * 0.25);
      }
    }
  });
}

/**
 * Placement sanity audit (console-only): flags furniture that pokes through the
 * room walls or overlaps another piece. Items deliberately stacked (onTop) and
 * flat rugs are excluded. Runs on every load so layout regressions surface in
 * any headless QA run as "[roost-audit]" lines.
 */
function auditPlacement(group: THREE.Group, _places: Place[]) {
  const flats = new Set(['rug_round', 'rug_modern', 'whiteboard', 'clock']);
  // chairs are tucked under their desks on purpose
  const allowedPairs = new Set(['desk|chair_blue', 'desk_exec|chair_exec']);
  const boxes: { name: string; box: THREE.Box3; onTop?: string }[] = [];
  group.children.forEach((obj, i) => {
    const p = obj.userData.place as Place | undefined;
    const box = new THREE.Box3().setFromObject(obj);
    boxes.push({ name: p?.file ?? `item${i}`, box, onTop: p?.onTop });
  });
  let issues = 0;
  for (const b of boxes) {
    if (b.box.min.x < -ROOM.w / 2 - 0.02 || b.box.max.x > ROOM.w / 2 + 0.02 ||
        b.box.min.z < -ROOM.d / 2 - 0.02 || b.box.max.z > ROOM.d / 2 + 0.02) {
      console.warn(
        `[roost-audit] ${b.name} pokes out: x ${b.box.min.x.toFixed(2)}..${b.box.max.x.toFixed(2)} ` +
          `z ${b.box.min.z.toFixed(2)}..${b.box.max.z.toFixed(2)}`,
      );
      issues++;
    }
  }
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      if (a.onTop || b.onTop || flats.has(a.name) || flats.has(b.name)) continue;
      if (allowedPairs.has(`${a.name}|${b.name}`) || allowedPairs.has(`${b.name}|${a.name}`)) continue;
      const ix = Math.min(a.box.max.x, b.box.max.x) - Math.max(a.box.min.x, b.box.min.x);
      const iz = Math.min(a.box.max.z, b.box.max.z) - Math.max(a.box.min.z, b.box.min.z);
      const iy = Math.min(a.box.max.y, b.box.max.y) - Math.max(a.box.min.y, b.box.min.y);
      if (ix > 0.06 && iz > 0.06 && iy > 0.06) {
        console.warn(`[roost-audit] ${a.name} overlaps ${b.name} by ${ix.toFixed(2)}x${iz.toFixed(2)}m`);
        issues++;
      }
    }
  }
  console.log(`[roost-audit] done: ${issues} issue(s)`);
}

const cache = new Map<string, Promise<THREE.Group>>();

function loadGlb(loader: GLTFLoader, file: string): Promise<THREE.Group> {
  if (!cache.has(file)) {
    cache.set(
      file,
      new Promise((res, rej) =>
        loader.load(`/models/office/${file}.glb`, (g) => res(g.scene), undefined, rej),
      ),
    );
  }
  return cache.get(file)!.then((g) => g.clone(true));
}

export async function loadFurniture(recolor: RecolorMap = {}): Promise<FurnitureResult> {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const group = new THREE.Group();
  const tops: Record<string, number> = {};
  const places = [...workstationPlaces(), ...PLACES];

  // two passes: surfaces first (topKey), then items standing on them (onTop)
  const base = places.filter((p) => !p.onTop);
  const surface = places.filter((p) => p.onTop);
  const surfaceXZ: Record<string, { x: number; z: number }> = {};

  const placeOne = async (p: Place) => {
    let obj: THREE.Group;
    try {
      obj = await loadGlb(loader, p.file);
    } catch (e) {
      console.warn('[roost] furniture failed:', p.file, e);
      return; // a missing prop must never kill the office
    }
    const box = new THREE.Box3().setFromObject(obj);
    const size = box.getSize(new THREE.Vector3());
    const scale = p.h ? p.h / (size.y || 1) : (p.w ?? 1) / (size.x || 1);
    obj.scale.setScalar(scale);
    obj.rotation.y = p.rotY ?? 0;
    const b2 = new THREE.Box3().setFromObject(obj);
    let { x, z } = p;
    let yBase = p.y ?? 0;
    if (p.onTop) {
      const [key, mode] = p.onTop.split(':');
      if (mode !== 'xz') {
        // ride the surface fully (its own x/z came from the base item)
        x = surfaceXZ[key]?.x ?? x;
        z = surfaceXZ[key]?.z ?? z;
      }
      yBase = tops[key] ?? 0.9;
    }
    // center on (x,z), feet/base at yBase
    obj.position.set(
      x - (b2.min.x + b2.max.x) / 2,
      yBase - b2.min.y,
      z - (b2.min.z + b2.max.z) / 2,
    );
    obj.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });
    if (recolor[p.file]) applyRecolor(obj, recolor[p.file]);
    obj.userData.place = p;
    if (p.topKey) {
      const b3 = new THREE.Box3().setFromObject(obj);
      tops[p.topKey] = b3.max.y;
      surfaceXZ[p.topKey] = { x, z };
    }
    group.add(obj);
  };

  await Promise.all(base.map(placeOne));
  await Promise.all(surface.map(placeOne));
  console.log('[roost] furniture placed:', group.children.length, '/', places.length);
  auditPlacement(group, places);
  return { group, tops };
}
