export interface V2 {
  x: number;
  y: number;
}

export const v2 = (x = 0, y = 0): V2 => ({ x, y });
export const add = (a: V2, b: V2): V2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: V2, b: V2): V2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: V2, s: number): V2 => ({ x: a.x * s, y: a.y * s });
export const dot = (a: V2, b: V2): number => a.x * b.x + a.y * b.y;
export const len = (a: V2): number => Math.hypot(a.x, a.y);
export const dist = (a: V2, b: V2): number => Math.hypot(a.x - b.x, a.y - b.y);
export const norm = (a: V2): V2 => {
  const l = Math.hypot(a.x, a.y);
  return l > 1e-9 ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 };
};
export const clampLen = (a: V2, max: number): V2 => {
  const l = Math.hypot(a.x, a.y);
  return l > max ? { x: (a.x / l) * max, y: (a.y / l) * max } : a;
};
export const angleBetween = (a: V2, b: V2): number => {
  const la = len(a);
  const lb = len(b);
  if (la < 1e-9 || lb < 1e-9) return 0;
  return Math.acos(Math.max(-1, Math.min(1, dot(a, b) / (la * lb))));
};
export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Distance from point p to segment ab, and the projection parameter t in [0,1]. */
export function pointSegment(p: V2, a: V2, b: V2): { d: number; t: number } {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  const t = l2 < 1e-9 ? 0 : clamp(dot(sub(p, a), ab) / l2, 0, 1);
  return { d: dist(p, { x: a.x + ab.x * t, y: a.y + ab.y * t }), t };
}
