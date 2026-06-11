// Procedural canvas textures — floor, walls, skyline, monitor screens.
// No external image assets; everything is drawn once (or on status change).

import * as THREE from 'three';

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function addNoise(x: CanvasRenderingContext2D, w: number, h: number, amp: number) {
  const img = x.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = (Math.random() * 2 - 1) * amp;
    d[i] += r;
    d[i + 1] += r;
    d[i + 2] += r;
  }
  x.putImageData(img, 0, 0);
}

function tex(c: HTMLCanvasElement, repX = 1, repY = 1): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repX, repY);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Two art-direction palettes. A = light ash + anthracite feature wall, B = full scandi light. */
export type StyleVariant = 'a' | 'b';

export interface Palette {
  floorBase: [number, number, number];
  floorJoint: string;
  wallLight: string;
  wallFeature: string;
  featureIsDark: boolean;
  rug: string;
  rugBorder: string;
  chair: string | null; // null = keep model colors
  logo: string;
}

export const PALETTES: Record<StyleVariant, Palette> = {
  a: {
    floorBase: [216, 203, 178],
    floorJoint: 'rgba(120,105,82,0.45)',
    wallLight: '#f0eee8',
    wallFeature: '#363a41',
    featureIsDark: true,
    rug: '#a9afb8',
    rugBorder: 'rgba(245,247,250,0.35)',
    chair: '#343a43',
    logo: '#f2f3f5',
  },
  b: {
    floorBase: [227, 217, 198],
    floorJoint: 'rgba(150,135,110,0.4)',
    wallLight: '#f5f3ee',
    wallFeature: '#e9e5dc',
    featureIsDark: false,
    rug: '#c2c7cf',
    rugBorder: 'rgba(70,80,95,0.3)',
    chair: '#aeb5bf',
    logo: '#2e333b',
  },
};

/** Light ash plank floor. */
export function floorTexture(p: Palette): THREE.CanvasTexture {
  const S = 512;
  const [c, x] = canvas(S, S);
  const [br, bg, bb] = p.floorBase;
  x.fillStyle = `rgb(${br},${bg},${bb})`;
  x.fillRect(0, 0, S, S);
  const ph = S / 8;
  for (let r = 0; r < 8; r++) {
    const shade = 6 - Math.random() * 12;
    x.fillStyle = `rgb(${br + shade},${bg + shade},${bb + shade})`;
    x.fillRect(0, r * ph, S, ph - 2);
    x.fillStyle = p.floorJoint;
    x.fillRect(0, r * ph + ph - 2, S, 2);
    const off = Math.random() * S;
    x.fillRect((off + S / 2) % S, r * ph, 2, ph);
    x.strokeStyle = 'rgba(110,95,70,0.13)';
    for (let g = 0; g < 4; g++) {
      const gy = r * ph + Math.random() * ph;
      x.beginPath();
      x.moveTo(0, gy);
      x.bezierCurveTo(S * 0.3, gy + 3, S * 0.6, gy - 3, S, gy + 1);
      x.stroke();
    }
  }
  addNoise(x, S, S, 5);
  return tex(c, 4, 4);
}

/** Flat modern plaster wall. */
export function wallTexture(base: string): THREE.CanvasTexture {
  const S = 256;
  const [c, x] = canvas(S, S);
  x.fillStyle = base;
  x.fillRect(0, 0, S, S);
  addNoise(x, S, S, 4);
  return tex(c, 3, 1.5);
}

/** Big area rug under the desk island. */
export function rugTexture(p: Palette): THREE.CanvasTexture {
  const S = 256;
  const [c, x] = canvas(S, S);
  x.fillStyle = p.rug;
  x.fillRect(0, 0, S, S);
  addNoise(x, S, S, 8);
  x.strokeStyle = p.rugBorder;
  x.lineWidth = 6;
  x.strokeRect(12, 12, S - 24, S - 24);
  return tex(c, 1, 1);
}

/** "ROOST" wordmark for the feature wall. */
export function logoTexture(color: string): THREE.CanvasTexture {
  const W = 1024;
  const H = 256;
  const [c, x] = canvas(W, H);
  x.clearRect(0, 0, W, H);
  x.fillStyle = color;
  x.font = '700 150px Inter, system-ui, sans-serif';
  x.textBaseline = 'middle';
  // manual letter-spacing
  let lx = 30;
  for (const ch of 'ROOST') {
    x.fillText(ch, lx, H / 2 + 8);
    lx += x.measureText(ch).width + 42;
  }
  x.font = '500 34px Inter, system-ui, sans-serif';
  x.globalAlpha = 0.6;
  x.fillText('agents office', 34, H - 28);
  x.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * City skyline backdrop seen through the north windows.
 * `night` blends the sky + lights. Drawn deterministic-ish per call.
 */
export function skylineTexture(night: number): THREE.CanvasTexture {
  const W = 2048;
  const H = 512;
  const [c, x] = canvas(W, H);
  // sky gradient: day powder blue -> night deep navy
  const day = ['#b8d4ea', '#e6f0f8'];
  const nite = ['#0a1326', '#1d2a45'];
  const mix = (a: string, b: string, t: number) => {
    const pa = parseInt(a.slice(1), 16);
    const pb = parseInt(b.slice(1), 16);
    const ch = (sh: number) => Math.round(((pa >> sh) & 255) * (1 - t) + ((pb >> sh) & 255) * t);
    return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
  };
  const g = x.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, mix(day[0], nite[0], night));
  g.addColorStop(1, mix(day[1], nite[1], night));
  x.fillStyle = g;
  x.fillRect(0, 0, W, H);
  // sun / moon glow
  x.fillStyle = night > 0.5 ? 'rgba(240,240,255,0.8)' : 'rgba(255,236,190,0.9)';
  x.beginPath();
  x.arc(W * 0.78, H * (0.28 + night * 0.1), 26, 0, Math.PI * 2);
  x.fill();
  // building layers (seeded by index so it's stable between mood redraws)
  const layer = (count: number, baseY: number, hMax: number, col: string, litP: number) => {
    let bx = 0;
    let i = 0;
    while (bx < W) {
      const seed = Math.sin(i * 127.1 + count * 311.7) * 0.5 + 0.5;
      const bw = 60 + seed * 130;
      const bh = 60 + ((Math.sin(i * 269.5 + count * 97.3) * 0.5 + 0.5) * hMax) | 0;
      x.fillStyle = col;
      x.fillRect(bx, baseY - bh, bw - 8, bh);
      // windows
      for (let wy = baseY - bh + 10; wy < baseY - 12; wy += 18) {
        for (let wx = bx + 6; wx < bx + bw - 18; wx += 16) {
          const lit = Math.sin(wx * 12.9 + wy * 78.2) * 0.5 + 0.5 < litP;
          if (lit && night > 0.25) {
            x.fillStyle = 'rgba(255,196,110,0.85)';
            x.fillRect(wx, wy, 7, 9);
          } else {
            x.fillStyle = night > 0.5 ? 'rgba(40,55,80,0.5)' : 'rgba(255,255,255,0.25)';
            x.fillRect(wx, wy, 7, 9);
          }
        }
      }
      bx += bw;
      i++;
    }
  };
  const farCol = mix('#8aa6c0', '#101b30', night);
  const nearCol = mix('#5f7d99', '#1a2840', night);
  layer(1, H, 230, farCol, 0.25);
  layer(2, H, 330, nearCol, 0.4);
  const t = tex(c);
  t.wrapS = THREE.ClampToEdgeWrapping;
  return t;
}

/** Minimal line-art wall poster (modern gallery style). */
export function posterTexture(seed: number, onDark: boolean): THREE.CanvasTexture {
  const W = 256;
  const H = 340;
  const [c, x] = canvas(W, H);
  x.fillStyle = onDark ? '#f4f2ed' : '#fbfaf7';
  x.fillRect(0, 0, W, H);
  const ink = '#2c3038';
  const accent = seed % 2 ? '#d98c5f' : '#7a9d8c';
  x.strokeStyle = ink;
  x.lineWidth = 5;
  x.beginPath();
  if (seed % 2) {
    // single big arc + horizon line
    x.arc(W * 0.5, H * 0.62, W * 0.3, Math.PI, Math.PI * 2);
    x.moveTo(30, H * 0.62);
    x.lineTo(W - 30, H * 0.62);
  } else {
    // two leaning lines + circle
    x.moveTo(W * 0.25, H * 0.78);
    x.lineTo(W * 0.55, H * 0.22);
    x.moveTo(W * 0.45, H * 0.78);
    x.lineTo(W * 0.75, H * 0.22);
  }
  x.stroke();
  x.fillStyle = accent;
  x.beginPath();
  x.arc(W * (seed % 2 ? 0.5 : 0.66), H * (seed % 2 ? 0.34 : 0.62), 22, 0, Math.PI * 2);
  x.fill();
  x.strokeStyle = '#1d2026';
  x.lineWidth = 8;
  x.strokeRect(4, 4, W - 8, H - 8);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Keycap grid for the procedural keyboards. */
export function keysTexture(): THREE.CanvasTexture {
  const W = 256;
  const H = 96;
  const [c, x] = canvas(W, H);
  x.fillStyle = '#23262c';
  x.fillRect(0, 0, W, H);
  x.fillStyle = '#3a3f47';
  const kw = 14;
  const kh = 14;
  for (let r = 0; r < 5; r++) {
    const y = 6 + r * (kh + 4);
    const off = (r % 3) * 5;
    for (let kx = 6 + off; kx < W - 20; kx += kw + 4) {
      const wd = r === 4 && kx > W * 0.3 && kx < W * 0.62 ? kw * 4 : kw; // spacebar
      x.beginPath();
      x.roundRect(kx, y, wd, kh, 3);
      x.fill();
      if (wd > kw) kx += wd - kw;
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const SCREEN_COLS = ['#76b7e8', '#8fd99c', '#e8c06f', '#d98f9c', '#a8b4c4'];

/**
 * Monitor screen content: editor-ish colored lines + a live status line with the
 * agent's actual current activity. Redrawn on every status push.
 */
export function drawScreen(
  c: HTMLCanvasElement,
  opts: { on: boolean; working: boolean; title: string; activity: string; seed: number },
) {
  const x = c.getContext('2d')!;
  const W = c.width;
  const H = c.height;
  if (!opts.on) {
    x.fillStyle = '#161b22';
    x.fillRect(0, 0, W, H);
    return;
  }
  x.fillStyle = opts.working ? '#16304a' : '#11202f';
  x.fillRect(0, 0, W, H);
  // title bar
  x.fillStyle = 'rgba(255,255,255,0.08)';
  x.fillRect(0, 0, W, 22);
  x.fillStyle = '#9fb4c8';
  x.font = 'bold 12px monospace';
  x.fillText(opts.title, 8, 15);
  ['#ff5f57', '#febc2e', '#28c840'].forEach((col, i) => {
    x.fillStyle = col;
    x.beginPath();
    x.arc(W - 14 - i * 16, 11, 4.5, 0, Math.PI * 2);
    x.fill();
  });
  // code lines (stable per seed)
  const rnd = (i: number) => Math.abs(Math.sin(opts.seed * 91.7 + i * 47.9)) % 1;
  let y = 40;
  let r = 0;
  while (y < H - 36) {
    let lx = 10 + (r % 3) * 14;
    const segs = 1 + ((rnd(r) * 3) | 0);
    for (let s = 0; s < segs; s++) {
      const wseg = 20 + rnd(r * 7 + s) * 80;
      x.fillStyle = SCREEN_COLS[(rnd(r * 13 + s) * SCREEN_COLS.length) | 0];
      x.globalAlpha = opts.working ? 1 : 0.5;
      x.fillRect(lx, y, wseg, 8);
      lx += wseg + 10;
      if (lx > W - 30) break;
    }
    y += 16;
    r++;
  }
  x.globalAlpha = 1;
  // live status line
  x.fillStyle = 'rgba(0,0,0,0.45)';
  x.fillRect(0, H - 26, W, 26);
  x.fillStyle = opts.working ? '#8fd99c' : '#8a97a6';
  x.font = '12px monospace';
  x.fillText('> ' + opts.activity.slice(0, 34), 8, H - 9);
}
