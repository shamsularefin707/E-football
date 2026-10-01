import {
  AIR_DRAG,
  BALL_RADIUS,
  BOUNCE_MIN_VZ,
  BOUNCE_RESTITUTION,
  CURL_FORCE,
  GOAL_DEPTH,
  GOAL_HALF_WIDTH,
  GOAL_HEIGHT,
  GRAVITY,
  PITCH_HALF_LENGTH,
  POST_RADIUS,
  ROLL_DECEL,
  ROLL_DRAG,
  SPIN_DECAY,
} from './constants';
import type { BallState } from './types';

const WOOD_RESTITUTION = 0.6;

/**
 * Advance a free ball (not owned) by dt. Returns true if it hit the woodwork.
 * Sub-steps internally so fast shots can't tunnel through a post.
 */
export function stepBall(b: BallState, dt: number): boolean {
  const speed = Math.hypot(b.vel.x, b.vel.y, b.vel.z);
  const steps = Math.max(1, Math.ceil((speed * dt) / 0.08));
  const h = dt / steps;
  let hit = false;
  for (let i = 0; i < steps; i++) {
    integrate(b, h);
    if (collideWoodwork(b)) hit = true;
  }
  return hit;
}

function integrate(b: BallState, dt: number): void {
  const p = b.pos;
  const v = b.vel;
  const airborne = p.z > 0.001 || v.z > 0.001;
  const hs = Math.hypot(v.x, v.y);
  if (airborne) {
    v.z -= GRAVITY * dt;
    const drag = 1 - AIR_DRAG * dt;
    v.x *= drag;
    v.y *= drag;
    if (hs > 1 && b.spin !== 0) {
      // Magnus-style curl: accelerate perpendicular to the horizontal velocity.
      const a = b.spin * CURL_FORCE * dt;
      const px = -v.y / hs;
      const py = v.x / hs;
      v.x += px * a;
      v.y += py * a;
    }
  } else {
    v.z = 0;
    if (hs > 0) {
      const nh = Math.max(0, hs - (ROLL_DECEL + ROLL_DRAG * hs) * dt);
      const f = nh / hs;
      v.x *= f;
      v.y *= f;
      if (nh > 1 && b.spin !== 0) {
        const a = b.spin * CURL_FORCE * 0.25 * dt;
        const px = -v.y / nh;
        const py = v.x / nh;
        v.x += px * a;
        v.y += py * a;
      }
    }
  }
  b.spin *= Math.max(0, 1 - SPIN_DECAY * dt);
  p.x += v.x * dt;
  p.y += v.y * dt;
  p.z += v.z * dt;
  if (p.z < 0) {
    p.z = 0;
    if (v.z < -BOUNCE_MIN_VZ) {
      v.z = -v.z * BOUNCE_RESTITUTION;
      v.x *= 0.88;
      v.y *= 0.88;
    } else {
      v.z = 0;
    }
  }
}

function reflect2(vx: number, vy: number, nx: number, ny: number): [number, number] | null {
  const vn = vx * nx + vy * ny;
  if (vn >= 0) return null;
  const j = (1 + WOOD_RESTITUTION) * vn;
  return [vx - j * nx, vy - j * ny];
}

function collideWoodwork(b: BallState): boolean {
  const p = b.pos;
  const v = b.vel;
  const r = POST_RADIUS + BALL_RADIUS;
  let hit = false;
  for (const s of [1, -1]) {
    const gx = s * PITCH_HALF_LENGTH;
    if (Math.abs(p.x - gx) > 1.5) continue;
    // Posts: vertical cylinders.
    if (p.z < GOAL_HEIGHT + BALL_RADIUS) {
      for (const py of [GOAL_HALF_WIDTH, -GOAL_HALF_WIDTH]) {
        const dx = p.x - gx;
        const dy = p.y - py;
        const d = Math.hypot(dx, dy);
        if (d < r && d > 1e-6) {
          const nx = dx / d;
          const ny = dy / d;
          const rv = reflect2(v.x, v.y, nx, ny);
          if (rv) {
            v.x = rv[0];
            v.y = rv[1];
            hit = true;
          }
          p.x = gx + nx * r;
          p.y = py + ny * r;
        }
      }
    }
    // Crossbar: horizontal cylinder along y at height GOAL_HEIGHT.
    if (Math.abs(p.y) < GOAL_HALF_WIDTH) {
      const dx = p.x - gx;
      const dz = p.z - GOAL_HEIGHT;
      const d = Math.hypot(dx, dz);
      if (d < r && d > 1e-6) {
        const nx = dx / d;
        const nz = dz / d;
        const rv = reflect2(v.x, v.z, nx, nz);
        if (rv) {
          v.x = rv[0];
          v.z = rv[1];
          hit = true;
        }
        p.x = gx + nx * r;
        p.z = GOAL_HEIGHT + nz * r;
      }
    }
  }
  return hit;
}

/** Keep a ball that has gone in inside the net (back, sides, roof), soaking up its energy. */
export function containInNet(b: BallState): void {
  const p = b.pos;
  const v = b.vel;
  const s = Math.sign(p.x) || 1;
  const back = PITCH_HALF_LENGTH + GOAL_DEPTH - BALL_RADIUS;
  if (Math.abs(p.x) > back) {
    p.x = s * back;
    if (v.x * s > 0) v.x = -v.x * 0.15;
    v.y *= 0.5;
    v.z *= 0.5;
  }
  const side = GOAL_HALF_WIDTH - BALL_RADIUS;
  if (Math.abs(p.y) > side) {
    p.y = Math.sign(p.y) * side;
    v.y = -v.y * 0.15;
  }
  const roof = GOAL_HEIGHT - BALL_RADIUS;
  if (p.z > roof) {
    p.z = roof;
    if (v.z > 0) v.z = -v.z * 0.15;
  }
}
