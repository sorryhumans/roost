// Character system: loads the realistic Mixamo-rig people, retargets the shared
// animation FBX clips onto each one (bind-aware, per-bone), and applies the
// Brain's ActorView every frame (position, yaw, seat height, crossfaded clips).
//
// The retarget formula (proven in the protos): for every .quaternion keyframe,
// q_target = restTarget · inv(restSource) · q_anim, mapped by base bone name.
// Hips.position tracks are dropped (in-place playback; the sim moves the root).

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { ActorView, AnimName } from '../sim/behavior';

const ANIM_FILES: Record<string, string> = {
  typing: 'typing',
  sit_talk: 'sitting_talking',
  walk: 'walking',
  drink: 'drinking',
  point: 'Pointing',
  sit_down: 'stand_to_sit',
  stand_up: 'sit_to_stand',
  sit_idle: 'sitting_idle',
  stand_idle: 'standing_idle',
  phone: 'phone',
  meeting: 'meeting',
};

const CHAR_HEIGHT = 1.68;
const FADE = 0.28; // clip crossfade seconds

const baseName = (n: string) => n.replace(/^mixamorig[\d:_]*/i, '');

type ByBase = Record<string, { name: string; rest: THREE.Quaternion }[]>;

let UID = 0;

/** Collect every deforming bone (from each SkinnedMesh's skeleton), uniquely rename. */
function buildByBase(ch: THREE.Object3D): ByBase {
  const byBase: ByBase = {};
  const seen = new Set<THREE.Object3D>();
  ch.traverse((o) => {
    const sm = o as THREE.SkinnedMesh;
    if (sm.isSkinnedMesh && sm.skeleton) {
      for (const b of sm.skeleton.bones) {
        if (seen.has(b)) continue;
        seen.add(b);
        const base = baseName(b.name);
        const uniq = base + '__u' + ++UID;
        (byBase[base] = byBase[base] || []).push({ name: uniq, rest: b.quaternion.clone() });
        b.name = uniq;
      }
    }
  });
  return byBase;
}

function retarget(animRoot: THREE.Object3D, clip: THREE.AnimationClip, byBase: ByBase): THREE.AnimationClip | null {
  const rest: Record<string, THREE.Quaternion> = {};
  animRoot.traverse((o) => {
    if (o.name && ((o as THREE.Bone).isBone || rest[baseName(o.name)] === undefined)) {
      rest[baseName(o.name)] = o.quaternion.clone();
    }
  });
  const tmp = new THREE.Quaternion();
  const tracks: THREE.KeyframeTrack[] = [];
  for (const t of clip.tracks) {
    const d = t.name.lastIndexOf('.');
    const prop = t.name.slice(d);
    if (prop !== '.quaternion') continue;
    const base = baseName(t.name.slice(0, d));
    const targets = byBase[base];
    const r = rest[base];
    if (!targets || !r) continue;
    const ri = r.clone().invert();
    for (const tg of targets) {
      const nt = t.clone();
      nt.name = tg.name + prop;
      const v = nt.values;
      for (let i = 0; i < v.length; i += 4) {
        tmp.set(v[i], v[i + 1], v[i + 2], v[i + 3]);
        tmp.premultiply(ri).premultiply(tg.rest);
        v[i] = tmp.x;
        v[i + 1] = tmp.y;
        v[i + 2] = tmp.z;
        v[i + 3] = tmp.w;
      }
      tracks.push(nt);
    }
  }
  if (!tracks.length) return null;
  const out = clip.clone();
  out.tracks = tracks;
  out.resetDuration();
  return out;
}

export interface ActorSpec {
  id: string;
  file: 'ch22' | 'ch33' | 'ch37';
  /** Subtle material tint so reused meshes read as different people. */
  tint?: number;
}

export class Actor {
  readonly id: string;
  group = new THREE.Group();
  private mixer!: THREE.AnimationMixer;
  private actions: Partial<Record<AnimName, THREE.AnimationAction>> = {};
  private current?: AnimName;
  private mats: THREE.Material[] = [];
  private targetY = 0;
  private handBone?: THREE.Bone;
  private cup?: THREE.Mesh;
  private propKind: string | null = null;
  headHeight = 1.78;
  ready = false;

  constructor(id: string) {
    this.id = id;
  }

  init(model: THREE.Object3D, anims: Record<string, { root: THREE.Object3D; clip: THREE.AnimationClip }>, tint?: number) {
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    model.scale.setScalar(CHAR_HEIGHT / (size.y || 1));
    model.position.set(0, 0, 0);
    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh || (m as unknown as THREE.SkinnedMesh).isSkinnedMesh) {
        m.castShadow = true;
        m.frustumCulled = false;
        const mat = m.material as THREE.MeshStandardMaterial;
        if (mat) {
          if (tint && mat.color) mat.color.multiply(new THREE.Color(tint));
          this.mats.push(mat);
        }
      }
    });
    const byBase = buildByBase(model);
    this.mixer = new THREE.AnimationMixer(model);
    for (const [name, src] of Object.entries(anims)) {
      const clip = retarget(src.root, src.clip, byBase);
      if (clip) this.actions[name as AnimName] = this.mixer.clipAction(clip);
    }
    // transitions play once and hold their last frame
    for (const once of ['sit_down', 'stand_up'] as const) {
      const a = this.actions[once];
      if (a) {
        a.setLoop(THREE.LoopOnce, 1);
        a.clampWhenFinished = true;
      }
    }
    // right hand bone -> props (paper cup while drinking, phone while calling)
    model.traverse((o) => {
      const b = o as THREE.Bone;
      if (b.isBone && b.name.replace(/__u\d+$/, '') === 'RightHand') this.handBone = b;
    });
    // fallback if the standing-idle FBX is ever missing: neutral beats of "point"
    if (!this.actions.stand_idle && this.actions.point) {
      const idleClip = THREE.AnimationUtils.subclip(this.actions.point.getClip(), 'stand_idle', 0, 16, 30);
      const a = this.mixer.clipAction(idleClip);
      a.setLoop(THREE.LoopPingPong, Infinity);
      a.timeScale = 0.45;
      this.actions.stand_idle = a;
    }
    this.group.add(model);
    this.ready = true;
  }

  /** Drive the 3D presence from the sim view. */
  apply(view: ActorView, dt: number, frozen: boolean) {
    if (!this.ready) return;
    this.group.visible = view.visible;
    if (!view.visible) return;
    this.targetY = view.seated ? view.seatDrop : 0;
    // sink toward the seat gently (matching the sit-down clip), rise faster
    const ease = this.targetY < this.group.position.y ? 2.2 : 5;
    const y = this.group.position.y + (this.targetY - this.group.position.y) * Math.min(1, dt * ease);
    this.group.position.set(view.pos.x, y, view.pos.z);
    this.group.rotation.y = view.yaw + Math.PI; // model bind faces +z; sim yaw faces -z
    // opacity fade in/out
    const op = view.opacity;
    for (const m of this.mats) {
      const mm = m as THREE.MeshStandardMaterial;
      const wantTransparent = op < 0.99;
      if (wantTransparent !== mm.transparent) {
        mm.transparent = wantTransparent;
        mm.needsUpdate = true;
      }
      mm.opacity = op;
    }
    // hand props: paper cup while drinking, phone while on a call
    const wantProp = view.anim === 'drink' ? 'cup' : view.anim === 'phone' ? 'phone' : null;
    if (this.handBone && wantProp !== this.propKind) {
      if (this.cup) {
        this.cup.removeFromParent();
        this.cup.geometry.dispose();
        this.cup = undefined;
      }
      if (wantProp) {
        const ws = new THREE.Vector3();
        this.handBone.getWorldScale(ws);
        const k = 1 / (ws.x || 1);
        const prop =
          wantProp === 'cup'
            ? new THREE.Mesh(
                new THREE.CylinderGeometry(0.026, 0.021, 0.085, 12),
                new THREE.MeshStandardMaterial({ color: 0xf2f1ec, roughness: 0.6 }),
              )
            : new THREE.Mesh(
                new THREE.BoxGeometry(0.022, 0.135, 0.066),
                new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.35, metalness: 0.3 }),
              );
        prop.scale.setScalar(k);
        prop.position.set(0.02 * k, 0.085 * k, 0.025 * k);
        this.handBone.add(prop);
        this.cup = prop;
      }
      this.propKind = wantProp;
    }
    // animation switch with crossfade
    if (view.anim !== this.current && this.actions[view.anim]) {
      const next = this.actions[view.anim]!;
      const prev = this.current ? this.actions[this.current] : undefined;
      next.reset();
      next.setEffectiveWeight(1);
      next.play();
      if (prev && prev !== next) prev.crossFadeTo(next, FADE, false);
      this.current = view.anim;
    }
    if (!frozen) this.mixer.update(dt);
  }
}

export interface LoadedAnims {
  [k: string]: { root: THREE.Object3D; clip: THREE.AnimationClip };
}

/** Load every animation FBX once. */
export async function loadAnims(): Promise<LoadedAnims> {
  const fbx = new FBXLoader();
  const out: LoadedAnims = {};
  await Promise.all(
    Object.entries(ANIM_FILES).map(
      ([key, file]) =>
        new Promise<void>((res) => {
          fbx.load(
            `/models/anims/${file}.fbx`,
            (root) => {
              if (root.animations[0]) out[key] = { root, clip: root.animations[0] };
              res();
            },
            undefined,
            () => res(), // a missing clip degrades gracefully
          );
        }),
    ),
  );
  return out;
}

/** Load a character GLB (fresh parse per actor so materials/skeletons are unique). */
export function loadCharacter(file: string): Promise<THREE.Object3D> {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  return new Promise((res, rej) =>
    loader.load(`/models/${file}.glb`, (g) => res(g.scene), undefined, rej),
  );
}
