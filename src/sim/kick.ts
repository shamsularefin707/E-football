import { AIR_DRAG, GRAVITY, ROLL_DECEL, ROLL_DRAG } from './constants';

const A = ROLL_DECEL;
const K = ROLL_DRAG;

/** Distance a rolling ball covers while slowing from v0 to v1. */
export function rollDistance(v0: number, v1: number): number {
  if (v0 <= v1) return 0;
  const c = A / K;
  return (v0 - v1) / K - (c / K) * Math.log((v0 + c) / (v1 + c));
}

/** Time a rolling ball takes to slow from v0 to v1. */
export function rollTime(v0: number, v1: number): number {
  if (v0 <= v1) return 0;
  const c = A / K;
  return Math.log((v0 + c) / (v1 + c)) / K;
}

/** Initial ground speed so the ball arrives `d` metres away still moving at `vEnd`. */
export function groundSpeedFor(d: number, vEnd: number): number {
  let lo = vEnd;
  let hi = 45;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (rollDistance(mid, vEnd) < d) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Horizontal speed and vertical speed for a lofted ball landing `d` metres away after `t` seconds. */
export function loftFor(d: number, t: number): { vh: number; vz: number } {
  const c = AIR_DRAG;
  const vh = (d * c) / (1 - Math.exp(-c * t));
  return { vh, vz: (GRAVITY * t) / 2 };
}

/** Vertical speed so a ball travelling horizontally at `vh` is at height `z` after `d` metres. */
export function shotVz(d: number, vh: number, z: number): number {
  const t = Math.max(0.05, d / vh);
  return (z + 0.5 * GRAVITY * t * t) / t;
}
