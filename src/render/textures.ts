import * as THREE from 'three';
import {
  CENTRE_CIRCLE_RADIUS,
  GOAL_AREA_DEPTH,
  GOAL_AREA_HALF_WIDTH,
  PENALTY_AREA_DEPTH,
  PENALTY_AREA_HALF_WIDTH,
  PENALTY_SPOT_DIST,
  PITCH_HALF_LENGTH,
  PITCH_HALF_WIDTH,
} from '../sim/constants';

export const PITCH_MARGIN_X = 6;
export const PITCH_MARGIN_Y = 5;

/** Striped grass with all the markings, drawn once into a canvas. */
export function makePitchTexture(size: number, night: boolean): THREE.CanvasTexture {
  const W = PITCH_HALF_LENGTH * 2 + PITCH_MARGIN_X * 2;
  const H = PITCH_HALF_WIDTH * 2 + PITCH_MARGIN_Y * 2;
  const s = size / W;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = Math.round(H * s);
  const g = c.getContext('2d')!;
  const X = (x: number) => (x + PITCH_HALF_LENGTH + PITCH_MARGIN_X) * s;
  const Y = (y: number) => (PITCH_HALF_WIDTH + PITCH_MARGIN_Y - y) * s;

  const base = night ? ['#2f7a35', '#2a6f30'] : ['#3d8f3f', '#36823a'];
  g.fillStyle = night ? '#2c7232' : '#3a883c';
  g.fillRect(0, 0, c.width, c.height);
  // Mowing stripes across the pitch.
  const stripes = 18;
  const sw = (PITCH_HALF_LENGTH * 2) / stripes;
  for (let i = 0; i < stripes; i++) {
    g.fillStyle = base[i % 2];
    g.fillRect(X(-PITCH_HALF_LENGTH + i * sw), Y(PITCH_HALF_WIDTH + 2), sw * s + 1, (PITCH_HALF_WIDTH * 2 + 4) * s);
  }
  // Subtle grass noise.
  const noise = g.getImageData(0, 0, c.width, c.height);
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < noise.data.length; i += 4) {
    const n = (rnd() - 0.5) * 14;
    noise.data[i] += n;
    noise.data[i + 1] += n;
    noise.data[i + 2] += n * 0.5;
  }
  g.putImageData(noise, 0, 0);

  g.strokeStyle = 'rgba(255,255,255,0.92)';
  g.fillStyle = 'rgba(255,255,255,0.92)';
  g.lineWidth = Math.max(2, 0.12 * s);
  const rect = (x0: number, y0: number, x1: number, y1: number) => g.strokeRect(X(x0), Y(y1), (x1 - x0) * s, (y1 - y0) * s);
  rect(-PITCH_HALF_LENGTH, -PITCH_HALF_WIDTH, PITCH_HALF_LENGTH, PITCH_HALF_WIDTH);
  g.beginPath();
  g.moveTo(X(0), Y(PITCH_HALF_WIDTH));
  g.lineTo(X(0), Y(-PITCH_HALF_WIDTH));
  g.stroke();
  g.beginPath();
  g.arc(X(0), Y(0), CENTRE_CIRCLE_RADIUS * s, 0, Math.PI * 2);
  g.stroke();
  const spot = (x: number, y: number) => {
    g.beginPath();
    g.arc(X(x), Y(y), 0.22 * s, 0, Math.PI * 2);
    g.fill();
  };
  spot(0, 0);
  for (const sgn of [-1, 1]) {
    const gx = sgn * PITCH_HALF_LENGTH;
    const pa = gx - sgn * PENALTY_AREA_DEPTH;
    const ga = gx - sgn * GOAL_AREA_DEPTH;
    rect(Math.min(gx, pa), -PENALTY_AREA_HALF_WIDTH, Math.max(gx, pa), PENALTY_AREA_HALF_WIDTH);
    rect(Math.min(gx, ga), -GOAL_AREA_HALF_WIDTH, Math.max(gx, ga), GOAL_AREA_HALF_WIDTH);
    const ps = gx - sgn * PENALTY_SPOT_DIST;
    spot(ps, 0);
    // The "D": the part of the 9.15m circle outside the area.
    const a = Math.acos((PENALTY_AREA_DEPTH - PENALTY_SPOT_DIST) / CENTRE_CIRCLE_RADIUS);
    g.beginPath();
    if (sgn > 0) g.arc(X(ps), Y(0), CENTRE_CIRCLE_RADIUS * s, Math.PI - a, Math.PI + a);
    else g.arc(X(ps), Y(0), CENTRE_CIRCLE_RADIUS * s, -a, a);
    g.stroke();
    for (const ys of [-1, 1]) {
      g.beginPath();
      const start = sgn > 0 ? (ys > 0 ? Math.PI / 2 : Math.PI) : ys > 0 ? 0 : -Math.PI / 2;
      g.arc(X(gx), Y(ys * PITCH_HALF_WIDTH), 1 * s, start, start + Math.PI / 2);
      g.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export function makeCrowdTexture(dense: boolean): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#20232b';
  g.fillRect(0, 0, c.width, c.height);
  const cols = ['#d6d6d6', '#c23b3b', '#3b5fc2', '#e0c040', '#2f2f2f', '#8a8a8a', '#f0f0f0', '#5a3a2a', '#d98a5a'];
  let seed = 777;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const step = dense ? 6 : 9;
  for (let y = 4; y < c.height; y += step) {
    for (let x = 2; x < c.width; x += step * 0.8) {
      if (rnd() < 0.12) continue;
      g.fillStyle = cols[Math.floor(rnd() * cols.length)];
      g.fillRect(x + rnd() * 2, y + rnd() * 2, step * 0.55, step * 0.7);
      g.fillStyle = '#e1b48c';
      g.fillRect(x + 0.5 + rnd(), y - 2, step * 0.4, step * 0.35);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export function makeBoardTexture(lines: string[], colors: string[]): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 2048;
  c.height = 64;
  const g = c.getContext('2d')!;
  const seg = c.width / lines.length;
  lines.forEach((t, i) => {
    g.fillStyle = colors[i % colors.length];
    g.fillRect(i * seg, 0, seg, c.height);
    g.fillStyle = '#ffffff';
    g.font = 'bold 38px Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(t, i * seg + seg / 2, c.height / 2 + 2);
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

export function makeBallTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f7f7f7';
  g.fillRect(0, 0, 256, 128);
  g.fillStyle = '#1b1b1b';
  for (let i = 0; i < 8; i++) {
    const x = (i % 4) * 64 + (i < 4 ? 16 : 48);
    const y = i < 4 ? 36 : 92;
    g.beginPath();
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 - Math.PI / 2;
      g.lineTo(x + Math.cos(a) * 13, y + Math.sin(a) * 13);
    }
    g.closePath();
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function makeBlobTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  grd.addColorStop(0, 'rgba(0,0,0,0.55)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
