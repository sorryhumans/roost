// OfficeEngine — vanilla three.js heart of the Roost 3D office.
// Read-only visualization: it renders live agent state and never sends anything.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { AgentState, AgentStatus } from '../types';
import { STATUS_UI } from '../types';
import { BOSS, POIS, ROOM, WORKSTATIONS, type Workstation } from '../sim/layout';
import { Brain } from '../sim/behavior';
import { loadFurniture } from './furniture';
import { Actor, loadAnims, loadCharacter, type ActorSpec } from './characters';
import {
  drawScreen,
  floorTexture,
  keysTexture,
  logoTexture,
  PALETTES,
  posterTexture,
  rugTexture,
  skylineTexture,
  wallTexture,
  type Palette,
  type StyleVariant,
} from './materials';

const CHARS: ActorSpec[] = [
  { id: 'ws1', file: 'ch22' },
  { id: 'ws2', file: 'ch37' },
  { id: 'ws3', file: 'ch22', tint: 0xd8e2f0 },
  { id: 'ws4', file: 'ch37', tint: 0xf0ddd0 },
  { id: 'boss', file: 'ch33' },
];

interface LabelEl {
  root: HTMLDivElement;
  name: HTMLSpanElement;
  dot: HTMLSpanElement;
  act: HTMLDivElement;
}

export interface EngineOpts {
  canvas: HTMLCanvasElement;
  labelLayer: HTMLDivElement;
  reducedMotion?: boolean;
  /** Art-direction variant (palette). */
  style?: StyleVariant;
  /** Keep the draw buffer so snapshot() works (dev/QA captures only). */
  preserveDrawingBuffer?: boolean;
  onProgress?: (msg: string) => void;
  onReady?: () => void;
  onFocus?: (id: string | null) => void;
}

export class OfficeEngine {
  private opts: EngineOpts;
  private renderer!: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera!: THREE.PerspectiveCamera;
  private controls!: OrbitControls;
  private clock = new THREE.Clock();
  private raf = 0;
  private disposed = false;

  private brains = new Map<string, Brain>();
  private actors = new Map<string, Actor>();
  private claims = new Map<string, string>();
  private statuses = new Map<string, AgentStatus>();
  private agentData = new Map<string, AgentState>();

  private labels = new Map<string, LabelEl>();
  private screens = new Map<string, { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture }>();

  private sun!: THREE.DirectionalLight;
  private hemi!: THREE.HemisphereLight;
  private pendants: THREE.PointLight[] = [];
  private skyline!: THREE.MeshBasicMaterial;
  private nightNow = -1;
  private moodTimer = 0;

  private pal: Palette = PALETTES.a;
  private focusId: string | null = null;
  private camGoal?: { pos: THREE.Vector3; target: THREE.Vector3 };
  private raycaster = new THREE.Raycaster();
  private fpsAvg = 60;
  private degraded = 0;

  constructor(opts: EngineOpts) {
    this.opts = opts;
  }

  // ------------------------------------------------------------------ setup --

  async init() {
    const { canvas } = this.opts;
    this.pal = PALETTES[this.opts.style ?? 'a'];
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      preserveDrawingBuffer: !!this.opts.preserveDrawingBuffer,
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.resize();

    this.scene.background = new THREE.Color('#0c1018');
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.06).texture;

    const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
    this.camera = new THREE.PerspectiveCamera(27, aspect, 0.1, 80);
    const dist = aspect < 0.9 ? 1.5 : 1.0;
    this.camera.position.set(10.4 * dist, 8.2 * dist, 10.4 * dist);

    // QA helper: ?cam=px,py,pz,tx,ty,tz overrides the start camera
    const camParam = new URLSearchParams(window.location.search).get('cam');
    if (camParam) {
      const [px, py, pz] = camParam.split(',').map(Number);
      if (!Number.isNaN(px)) this.camera.position.set(px, py, pz);
    }
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(-0.2, 0.4, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.enablePan = false;
    this.controls.minDistance = 6;
    this.controls.maxDistance = 24;
    this.controls.minPolarAngle = 0.5;
    this.controls.maxPolarAngle = 1.25;
    this.controls.minAzimuthAngle = Math.PI * 0.05;
    this.controls.maxAzimuthAngle = Math.PI * 0.46;
    if (camParam) {
      const t = camParam.split(',').map(Number);
      if (t.length === 6 && !t.some(Number.isNaN)) this.controls.target.set(t[3], t[4], t[5]);
      this.controls.minAzimuthAngle = -Infinity;
      this.controls.maxAzimuthAngle = Infinity;
      this.controls.minPolarAngle = 0;
      this.controls.maxPolarAngle = Math.PI;
      this.controls.minDistance = 0.5;
    }
    this.controls.update();

    this.lights();
    this.room();
    this.opts.onProgress?.('Building the office…');
    const furniture = await loadFurniture({
      desk: 'ash',
      ...(this.pal.chair ? { chair_blue: this.pal.chair } : {}),
    });
    this.scene.add(furniture.group);
    this.buildScreens(furniture.tops);
    this.buildDeskProps(furniture.tops);

    this.opts.onProgress?.('Inviting the people…');
    await this.spawnActors();
    // statuses may have arrived while we were still building: paint them now
    if (this.agentData.size) this.setAgents([...this.agentData.values()]);

    canvas.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('resize', this.onResize);
    this.opts.onReady?.();
    this.loop();
  }

  private lights() {
    this.hemi = new THREE.HemisphereLight(0xbdd3ea, 0x5a4028, 0.5);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff0dc, 2.6);
    this.sun.position.set(-6, 10, 4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.radius = 4;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.025;
    Object.assign(this.sun.shadow.camera, { near: 2, far: 30, left: -8, right: 8, top: 9, bottom: -8 });
    this.scene.add(this.sun);
    const fill = new THREE.DirectionalLight(0xcfe0ff, 0.45);
    fill.position.set(8, 5, 8);
    this.scene.add(fill);
    // warm pendants hanging from slim lighting beams (the dollhouse has no ceiling,
    // so the cords need visible structure to attach to)
    const beamMat = new THREE.MeshStandardMaterial({ color: 0x1b1e24, roughness: 0.55, metalness: 0.3 });
    for (const bz of [0, -3.5, 2.9]) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(ROOM.w, 0.07, 0.09), beamMat);
      beam.position.set(0, ROOM.h - 0.035, bz);
      this.scene.add(beam);
    }
    for (const [x, z] of [
      [0, 0],
      [3.1, -3.5],
      [3.4, 2.9],
    ] as const) {
      const lamp = new THREE.PointLight(0xffbd78, 2.2, 6.5, 1.9);
      lamp.position.set(x, 2.0, z);
      this.scene.add(lamp);
      this.pendants.push(lamp);
      const cord = new THREE.Mesh(
        new THREE.CylinderGeometry(0.012, 0.012, ROOM.h - 2.18, 6),
        new THREE.MeshStandardMaterial({ color: 0x23272e }),
      );
      cord.position.set(x, ROOM.h - (ROOM.h - 2.18) / 2, z);
      this.scene.add(cord);
      const shade = new THREE.Mesh(
        new THREE.ConeGeometry(0.19, 0.2, 24, 1, true),
        new THREE.MeshStandardMaterial({
          color: 0x16181d,
          emissive: 0xffb066,
          emissiveIntensity: 0.5,
          side: THREE.DoubleSide,
          roughness: 0.45,
          metalness: 0.4,
        }),
      );
      shade.position.set(x, 2.2, z);
      this.scene.add(shade);
    }
  }

  private room() {
    const W = ROOM.w;
    const D = ROOM.d;
    const H = ROOM.h;
    const matFloor = new THREE.MeshStandardMaterial({ map: floorTexture(this.pal), roughness: 0.8 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), matFloor);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
    // plinth under the floor so the dollhouse slab has thickness from the side
    const plinth = new THREE.Mesh(
      new THREE.BoxGeometry(W + 0.3, 0.22, D + 0.3),
      new THREE.MeshStandardMaterial({ color: 0x14181f, roughness: 0.9 }),
    );
    plinth.position.y = -0.12;
    this.scene.add(plinth);

    const matWall = new THREE.MeshStandardMaterial({ map: wallTexture(this.pal.wallLight), roughness: 0.95 });
    const matFeature = new THREE.MeshStandardMaterial({
      map: wallTexture(this.pal.wallFeature),
      roughness: 0.92,
    });
    const wall = (w: number, h: number, x: number, y: number, z: number, rotY = 0, mat = matWall) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
      m.position.set(x, y, z);
      m.rotation.y = rotY;
      m.receiveShadow = true;
      this.scene.add(m);
      return m;
    };
    // NORTH wall with a window band (sill 0.95..head 2.5) from x=-5.1..5.2
    const NZ = -D / 2;
    wall(W, 0.95, 0, 0.475, NZ); // below sill
    wall(W, H - 2.5, 0, (H + 2.5) / 2, NZ); // above head
    wall(0.4, 1.55, -W / 2 + 0.2, 1.725, NZ); // left pier
    wall(0.3, 1.55, W / 2 - 0.15, 1.725, NZ); // right pier
    // mullions + glass
    const mullMat = new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.5 });
    for (let mx = -5.1; mx <= 5.25; mx += 1.72) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.55, 0.08), mullMat);
      post.position.set(mx, 1.725, NZ);
      post.castShadow = true;
      this.scene.add(post);
    }
    for (const my of [0.95, 2.5]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(10.4, 0.07, 0.08), mullMat);
      rail.position.set(0.05, my, NZ);
      this.scene.add(rail);
    }
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0xbfd9ee,
      transparent: true,
      opacity: 0.09,
      roughness: 0.08,
      metalness: 0,
      envMapIntensity: 1.6,
      side: THREE.DoubleSide,
    });
    const glassN = new THREE.Mesh(new THREE.PlaneGeometry(10.4, 1.55), glassMat);
    glassN.position.set(0.05, 1.725, NZ + 0.01);
    this.scene.add(glassN);

    // WEST wall = the feature wall (anthracite in style A) with the wordmark
    wall(D, H, -W / 2, H / 2, 0, Math.PI / 2, matFeature);
    const logo = new THREE.Mesh(
      new THREE.PlaneGeometry(2.3, 0.575),
      new THREE.MeshBasicMaterial({ map: logoTexture(this.pal.logo), transparent: true, toneMapped: false }),
    );
    logo.position.set(-W / 2 + 0.02, 2.25, 2.0);
    logo.rotation.y = Math.PI / 2;
    this.scene.add(logo);
    // baseboards
    const bbMat = new THREE.MeshStandardMaterial({ color: 0x3a3026, roughness: 0.8 });
    const bbN = new THREE.Mesh(new THREE.BoxGeometry(W, 0.09, 0.04), bbMat);
    bbN.position.set(0, 0.045, NZ + 0.02);
    this.scene.add(bbN);
    const bbW = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.09, D), bbMat);
    bbW.position.set(-W / 2 + 0.02, 0.045, 0);
    this.scene.add(bbW);

    // skyline backdrop behind the windows
    this.skyline = new THREE.MeshBasicMaterial({ map: skylineTexture(0) });
    const sky = new THREE.Mesh(new THREE.PlaneGeometry(30, 7.5), this.skyline);
    sky.position.set(0, 2.4, NZ - 3.2);
    this.scene.add(sky);

    // boss office glass partitions (east + south with a door gap)
    const gMat = glassMat.clone();
    gMat.opacity = 0.17;
    const frame = new THREE.MeshStandardMaterial({ color: 0x23272e, roughness: 0.5 });
    const part = (w: number, x: number, z: number, rotY: number) => {
      const g = new THREE.Mesh(new THREE.PlaneGeometry(w, H - 0.6), gMat);
      g.position.set(x, (H - 0.6) / 2, z);
      g.rotation.y = rotY;
      this.scene.add(g);
      const top = new THREE.Mesh(new THREE.BoxGeometry(rotY ? 0.07 : w, 0.07, rotY ? w : 0.07), frame);
      top.position.set(x, H - 0.6, z);
      this.scene.add(top);
    };
    // east glass: z from -4.5 to -1.5 at x = glassX
    part(D / 2 - 1.5 + 1.5, BOSS.glassX, (-D / 2 + BOSS.glassZ) / 2, Math.PI / 2);
    // south glass: two segments around the door
    const doorL = BOSS.door.x - BOSS.door.halfW;
    const doorR = BOSS.door.x + BOSS.door.halfW;
    const leftW = doorL - -W / 2;
    const rightW = BOSS.glassX - doorR;
    part(leftW, -W / 2 + leftW / 2, BOSS.glassZ, 0);
    part(rightW, doorR + rightW / 2, BOSS.glassZ, 0);
    // glass partition posts
    for (const [px, pz] of [
      [BOSS.glassX, BOSS.glassZ],
      [doorL, BOSS.glassZ],
      [doorR, BOSS.glassZ],
      [BOSS.glassX, -D / 2],
    ] as const) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.07, H - 0.6, 0.07), frame);
      post.position.set(px, (H - 0.6) / 2, pz);
      post.castShadow = true;
      this.scene.add(post);
    }

    // big rug under the island (canvas-textured for softness)
    const rug = new THREE.Mesh(
      new THREE.PlaneGeometry(5.2, 3.9),
      new THREE.MeshStandardMaterial({ map: rugTexture(this.pal), roughness: 1 }),
    );
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(0, 0.003, 0);
    rug.receiveShadow = true;
    this.scene.add(rug);

    // minimal posters on the feature wall
    for (const [pz, seed] of [
      [-0.4, 1],
      [0.55, 2],
    ] as const) {
      const poster = new THREE.Mesh(
        new THREE.PlaneGeometry(0.72, 0.96),
        new THREE.MeshStandardMaterial({
          map: posterTexture(seed, this.pal.featureIsDark),
          roughness: 0.9,
        }),
      );
      poster.position.set(-W / 2 + 0.03, 1.8, pz);
      poster.rotation.y = Math.PI / 2;
      this.scene.add(poster);
    }
  }

  private buildScreens(tops: Record<string, number>) {
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x23262c, roughness: 0.45 });
    const stations: { id: string; seat: { pos: { x: number; z: number }; yaw: number }; top: number }[] = [
      ...WORKSTATIONS.map((ws) => ({ id: ws.agent, seat: ws.seat, top: tops['desk_' + ws.agent] ?? 0.65 })),
      { id: 'boss', seat: BOSS.seat, top: tops['boss_desk'] ?? 0.66 },
    ];
    for (const ws of stations) {
      const yaw = ws.seat.yaw;
      const f = { x: -Math.sin(yaw), z: -Math.cos(yaw) };
      const topY = ws.top;
      const px = ws.seat.pos.x + f.x * 0.72;
      const pz = ws.seat.pos.z + f.z * 0.72;
      const g = new THREE.Group();
      // stand + slim panel
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.02, 16), bodyMat);
      foot.position.y = 0.01;
      g.add(foot);
      const neck = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.17, 0.03), bodyMat);
      neck.position.y = 0.1;
      g.add(neck);
      const panel = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.37, 0.022), bodyMat);
      panel.position.y = 0.34;
      panel.castShadow = true;
      g.add(panel);
      const c = document.createElement('canvas');
      c.width = 320;
      c.height = 200;
      drawScreen(c, {
        on: ws.id === 'boss',
        working: ws.id === 'boss',
        title: ws.id === 'boss' ? 'ROOST · dashboard' : ws.id,
        activity: ws.id === 'boss' ? 'watching the office' : '',
        seed: ws.seat.pos.x * 7,
      });
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      const scr = new THREE.Mesh(
        new THREE.PlaneGeometry(0.58, 0.34),
        new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }),
      );
      scr.position.set(0, 0.34, 0.013);
      g.add(scr);
      // screen plane faces +z after group yaw: rotate so it faces the sitter
      g.position.set(px, topY, pz);
      g.rotation.y = yaw;
      this.scene.add(g);
      if (ws.id !== 'boss') this.screens.set(ws.id, { canvas: c, tex });
    }
  }

  /** Small life-giving props: keyboards, mice, mugs, papers, books. */
  private buildDeskProps(tops: Record<string, number>) {
    const dark = new THREE.MeshStandardMaterial({ color: 0x23262c, roughness: 0.5 });
    const keysMat = new THREE.MeshStandardMaterial({ map: keysTexture(), roughness: 0.65 });
    const paperMat = new THREE.MeshStandardMaterial({ color: 0xf4f3ee, roughness: 0.9 });
    const MUG_COLORS = [0xc96f4a, 0x7a9d8c, 0xd9a648, 0x6f87a8, 0x9a86b8];
    const mug = (x: number, y: number, z: number, color: number) => {
      const g = new THREE.Group();
      const cup = new THREE.Mesh(
        new THREE.CylinderGeometry(0.038, 0.033, 0.085, 14),
        new THREE.MeshStandardMaterial({ color, roughness: 0.55 }),
      );
      cup.position.y = 0.043;
      cup.castShadow = true;
      g.add(cup);
      const handle = new THREE.Mesh(
        new THREE.TorusGeometry(0.022, 0.007, 8, 14),
        cup.material,
      );
      handle.position.set(0.042, 0.045, 0);
      g.add(handle);
      g.position.set(x, y, z);
      this.scene.add(g);
    };
    const seats = [
      ...WORKSTATIONS.map((ws) => ({ seat: ws.seat, top: tops['desk_' + ws.agent] ?? 0.74, i: ws.agent.length })),
      { seat: BOSS.seat, top: tops['boss_desk'] ?? 0.73, i: 0 },
    ];
    for (const { seat, top, i } of seats) {
      const yaw = seat.yaw;
      const f = { x: -Math.sin(yaw), z: -Math.cos(yaw) };
      const r = { x: Math.cos(yaw), z: -Math.sin(yaw) };
      const at = (df: number, dr: number) => ({
        x: seat.pos.x + f.x * df + r.x * dr,
        z: seat.pos.z + f.z * df + r.z * dr,
      });
      // keyboard right under the measured typing-hand arc (reach 0.49 fwd)
      const kb = at(0.44, 0);
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.016, 0.13), dark);
      base.position.set(kb.x, top + 0.008, kb.z);
      base.rotation.y = yaw;
      base.castShadow = true;
      this.scene.add(base);
      const keys = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.11), keysMat);
      keys.rotation.x = -Math.PI / 2;
      keys.rotation.z = yaw;
      keys.position.set(kb.x, top + 0.017, kb.z);
      this.scene.add(keys);
      // mouse
      const m = at(0.46, 0.25);
      const mouse = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 10), dark);
      mouse.scale.set(1, 0.45, 1.5);
      mouse.position.set(m.x, top + 0.014, m.z);
      mouse.rotation.y = yaw;
      this.scene.add(mouse);
      // mug + a casually angled paper stack
      const mp = at(0.68, -0.42);
      mug(mp.x, top, mp.z, MUG_COLORS[i % MUG_COLORS.length]);
      const pp = at(0.66, -0.22);
      const paper = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.006, 0.29), paperMat);
      paper.position.set(pp.x, top + 0.004, pp.z);
      paper.rotation.y = yaw + 0.18 + (i % 3) * 0.1;
      this.scene.add(paper);
    }
    // kitchen mugs by the coffee machine
    const kTop = tops['kcounter2'] ?? 0.92;
    mug(3.06, kTop, -4.12, MUG_COLORS[0]);
    mug(3.26, kTop, -4.18, MUG_COLORS[3]);
    // books on the coffee table
    const tTop = tops['ctable'] ?? 0.4;
    const BOOKS = [0x6f87a8, 0xc96f4a, 0x3a4250];
    BOOKS.forEach((col, bi) => {
      const b = new THREE.Mesh(
        new THREE.BoxGeometry(0.24 - bi * 0.03, 0.022, 0.17 - bi * 0.02),
        new THREE.MeshStandardMaterial({ color: col, roughness: 0.7 }),
      );
      b.position.set(2.62, tTop + 0.011 + bi * 0.022, 2.3);
      b.rotation.y = bi * 0.35 - 0.2;
      b.castShadow = true;
      this.scene.add(b);
    });
  }

  private async spawnActors() {
    const anims = await loadAnims();
    const durations: Record<string, number> = {};
    for (const [k, v] of Object.entries(anims)) durations[k] = v.clip.duration;
    await Promise.all(
      CHARS.map(async (spec) => {
        const brain = new Brain({
          id: spec.id,
          kind: spec.id === 'boss' ? 'boss' : 'agent',
          ws: WORKSTATIONS.find((w) => w.agent === spec.id),
          claims: this.claims,
          presentAgents: () => this.presentWorkstations(),
          animDuration: (a) => durations[a],
        });
        this.brains.set(spec.id, brain);
        const actor = new Actor(spec.id);
        try {
          const model = await loadCharacter(spec.file);
          actor.init(model, anims, spec.tint);
        } catch (e) {
          // character failed to load -> brain still runs, label still updates
          console.warn('[roost] character failed:', spec.id, spec.file, e);
        }
        this.actors.set(spec.id, actor);
        this.scene.add(actor.group);
        this.makeLabel(spec.id);
      }),
    );
  }

  private presentWorkstations(): Workstation[] {
    // the boss only checks on agents who are actually at their desk working
    return WORKSTATIONS.filter((w) => this.statuses.get(w.agent) === 'working');
  }

  // ------------------------------------------------------------------ labels --

  private makeLabel(id: string) {
    const root = document.createElement('div');
    root.className = 'roost-lbl';
    const head = document.createElement('div');
    head.className = 'roost-lbl-head';
    const dot = document.createElement('span');
    dot.className = 'roost-lbl-dot';
    const name = document.createElement('span');
    name.textContent = id === 'boss' ? 'Boss' : '';
    if (id !== 'boss') root.style.display = 'none'; // hidden until live data names this desk
    head.append(dot, name);
    const act = document.createElement('div');
    act.className = 'roost-lbl-act';
    root.append(head, act);
    this.opts.labelLayer.appendChild(root);
    this.labels.set(id, { root, name, dot, act });
    if (id === 'boss') {
      dot.style.background = '#b48cff';
      dot.style.boxShadow = '0 0 8px #b48cff';
      act.textContent = 'running the office';
    }
  }

  // ------------------------------------------------------------------ data ----

  setAgents(states: AgentState[]) {
    // agents are assigned to desk slots in arrival (config) order
    for (const [i, st] of states.entries()) {
      const slot = WORKSTATIONS[i]?.agent;
      if (!slot) break; // more agents than desks: extras are not rendered
      this.statuses.set(slot, st.status);
      this.agentData.set(slot, st);
      const lbl = this.labels.get(slot);
      if (lbl) {
        lbl.name.textContent = st.displayName || st.id;
        const ui = STATUS_UI[st.status];
        lbl.dot.style.background = ui.color;
        lbl.dot.style.boxShadow = `0 0 8px ${ui.color}`;
        lbl.act.textContent = st.currentActivity ?? ui.label;
      }
      const scr = this.screens.get(slot);
      if (scr) {
        drawScreen(scr.canvas, {
          on: st.status === 'working' || st.status === 'online-idle',
          working: st.status === 'working',
          title: st.displayName || st.id,
          activity: st.currentActivity ?? STATUS_UI[st.status].label,
          seed: st.id.length * 13.7,
        });
        scr.tex.needsUpdate = true;
      }
    }
  }

  setReducedMotion(on: boolean) {
    this.opts.reducedMotion = on;
  }

  /** Focus the camera on an agent's character (or reset with null). */
  focusOn(id: string | null) {
    this.focusId = id;
    this.opts.onFocus?.(id);
    if (!id) {
      this.camGoal = {
        pos: new THREE.Vector3(10.4, 8.2, 10.4),
        target: new THREE.Vector3(-0.2, 0.4, 0),
      };
      return;
    }
    const actor = this.actors.get(id);
    if (!actor) return;
    const p = actor.group.position;
    const dir = new THREE.Vector3().subVectors(this.camera.position, this.controls.target).normalize();
    this.camGoal = {
      pos: new THREE.Vector3(p.x, 0, p.z).addScaledVector(dir, 5.2).setY(3.4),
      target: new THREE.Vector3(p.x, 1.0, p.z),
    };
  }

  // ------------------------------------------------------------------ input ---

  private onPointerDown = (e: PointerEvent) => {
    const rect = this.opts.canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(new THREE.Vector2(x, y), this.camera);
    const hits: { id: string; d: number }[] = [];
    for (const [id, actor] of this.actors) {
      const hit = this.raycaster.intersectObject(actor.group, true)[0];
      if (hit) hits.push({ id, d: hit.distance });
    }
    hits.sort((a, b) => a.d - b.d);
    if (hits[0]) this.focusOn(hits[0].id === this.focusId ? null : hits[0].id);
    else if (this.focusId) this.focusOn(null);
  };

  private onResize = () => this.resize();

  private resize() {
    const c = this.opts.canvas;
    const w = c.clientWidth || c.parentElement?.clientWidth || innerWidth;
    const h = c.clientHeight || c.parentElement?.clientHeight || innerHeight;
    this.renderer.setSize(w, h, false);
    if (this.camera) {
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
  }

  // ------------------------------------------------------------------ mood ----

  private applyMood() {
    const hourParam = new URLSearchParams(window.location.search).get('hour');
    const h =
      hourParam !== null && !Number.isNaN(Number(hourParam))
        ? Number(hourParam)
        : new Date().getHours() + new Date().getMinutes() / 60;
    let night = 0;
    if (h >= 21 || h < 5.5) night = 1;
    else if (h >= 17.5) night = (h - 17.5) / 3.5;
    else if (h < 7.5) night = 1 - (h - 5.5) / 2;
    night = Math.min(1, Math.max(0, night));
    if (Math.abs(night - this.nightNow) < 0.05) return;
    this.nightNow = night;
    this.sun.intensity = 2.6 - night * 1.9;
    this.sun.color.set(night > 0.6 ? 0x9db4dd : 0xfff0dc);
    this.hemi.intensity = 0.5 - night * 0.25;
    for (const p of this.pendants) p.intensity = 2.2 + night * 4.2;
    const old = this.skyline.map;
    this.skyline.map = skylineTexture(night);
    old?.dispose();
  }

  // ------------------------------------------------------------------ loop ----

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, this.clock.getDelta());
    const frozen = !!this.opts.reducedMotion;

    // perf watchdog: degrade gracefully on weak GPUs (phones)
    this.fpsAvg = this.fpsAvg * 0.95 + (1 / Math.max(dt, 1e-3)) * 0.05;
    this.moodTimer -= dt;
    if (this.moodTimer <= 0) {
      this.moodTimer = 120;
      this.applyMood();
      if (this.fpsAvg < 26 && this.degraded === 0) {
        this.degraded = 1;
        this.renderer.setPixelRatio(1);
      } else if (this.fpsAvg < 22 && this.degraded === 1) {
        this.degraded = 2;
        this.renderer.shadowMap.enabled = false;
        this.sun.castShadow = false;
      }
    }

    if (!frozen) {
      for (const [id, brain] of this.brains) {
        const status = id === 'boss' ? 'working' : this.statuses.get(id) ?? 'offline';
        brain.update(dt, status);
      }
    }
    for (const [id, actor] of this.actors) {
      const brain = this.brains.get(id)!;
      actor.apply(brain.view, dt, frozen);
      const lbl = this.labels.get(id);
      if (lbl) this.projectLabel(lbl, brain, actor);
    }

    // camera focus tween
    if (this.camGoal) {
      const k = Math.min(1, dt * 3.2);
      this.camera.position.lerp(this.camGoal.pos, k);
      this.controls.target.lerp(this.camGoal.target, k);
      if (this.camera.position.distanceTo(this.camGoal.pos) < 0.05) this.camGoal = undefined;
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  private pv = new THREE.Vector3();

  private projectLabel(lbl: LabelEl, brain: Brain, actor: Actor) {
    const v = brain.view;
    if (!v.visible || v.opacity < 0.4) {
      lbl.root.style.display = 'none';
      return;
    }
    const headY = v.seated ? 1.45 : 1.92;
    this.pv.set(v.pos.x, actor.group.position.y + headY, v.pos.z).project(this.camera);
    if (this.pv.z > 1) {
      lbl.root.style.display = 'none';
      return;
    }
    const c = this.opts.canvas;
    lbl.root.style.display = 'block';
    lbl.root.style.left = ((this.pv.x * 0.5 + 0.5) * c.clientWidth).toFixed(1) + 'px';
    lbl.root.style.top = ((-this.pv.y * 0.5 + 0.5) * c.clientHeight).toFixed(1) + 'px';
  }

  /** PNG data-URL of the current frame (requires preserveDrawingBuffer). */
  snapshot(): string {
    return this.renderer.domElement.toDataURL('image/png');
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.opts.canvas.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('resize', this.onResize);
    this.controls?.dispose();
    this.renderer?.dispose();
    this.opts.labelLayer.innerHTML = '';
  }
}

export { POIS };
