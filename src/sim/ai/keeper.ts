import { GOAL_HALF_WIDTH, GOAL_HEIGHT, GRAVITY, PENALTY_AREA_DEPTH, PENALTY_AREA_HALF_WIDTH } from '../constants';
import type { Match } from '../match';
import type { SimPlayer } from '../types';
import { clamp, dist, norm, sub, v2 } from '../vec';

const attempted = new WeakMap<Match, number[]>();

function lastAttempt(m: Match): number[] {
  let a = attempted.get(m);
  if (!a) {
    a = [-1, -1];
    attempted.set(m, a);
  }
  return a;
}

/** Decide where the keeper should be (and whether to dive) this tick. */
export function keeperUpdate(m: Match, gk: SimPlayer, isBestInterceptor: boolean, intercept: { x: number; y: number }): void {
  const b = m.ball;
  const gx = m.ownGoalX(gk.team);
  const s = Math.sign(gx);
  gk.wantsSprint = false;
  if (gk.action === 'dive') return;
  if (b.owner === gk.idx) {
    gk.target = { ...gk.pos };
    return;
  }
  if (b.owner < 0 && b.vel.x * s > 3) {
    const tLine = (gx - b.pos.x) / b.vel.x;
    if (tLine > 0 && tLine < 1.6) {
      const predY = b.pos.y + b.vel.y * tLine;
      const predZ = b.pos.z + b.vel.z * tLine - 0.5 * GRAVITY * tLine * tLine;
      if (Math.abs(predY) < GOAL_HALF_WIDTH + 1 && predZ < GOAL_HEIGHT + 0.6) {
        const ty = clamp(predY, -GOAL_HALF_WIDTH + 0.2, GOAL_HALF_WIDTH - 0.2);
        // Meet the shot on the line between ball and the predicted crossing point.
        const tx = gx - s * Math.min(1.2, Math.abs(gk.pos.x - gx));
        gk.target = v2(tx, ty);
        gk.wantsSprint = true;
        const lateral = ty - gk.pos.y;
        if (Math.abs(lateral) > 1.0 && tLine < 0.75 && gk.action === 'none') {
          gk.action = 'dive';
          gk.actionTime = 0.8;
          gk.actionResolved = false;
          gk.diveDir = v2(0, Math.sign(lateral));
          const maxSp = 4 + gk.info.attrs.gkDiving / 20;
          gk.vel = v2(0, Math.sign(lateral) * Math.min(maxSp, Math.abs(lateral) / Math.max(0.15, tLine) + 1));
        }
        return;
      }
    }
  }
  const inBox = Math.abs(b.pos.x - gx) < PENALTY_AREA_DEPTH && Math.abs(b.pos.y) < PENALTY_AREA_HALF_WIDTH;
  if (b.owner < 0 && inBox && isBestInterceptor && b.pos.z < 2.2) {
    gk.target = { x: intercept.x, y: intercept.y };
    gk.wantsSprint = true;
    return;
  }
  // Narrow the angle: stand on the line from the goal centre to the ball.
  const g = v2(gx, 0);
  const bp = v2(b.pos.x, b.pos.y);
  const d = dist(g, bp);
  const standoff = clamp(d * 0.1, 0.6, 4.5);
  const n = norm(sub(bp, g));
  gk.target = v2(gx + n.x * standoff, n.y * standoff * 0.9);
  // If an opponent is through on goal, come out to meet them.
  const o = m.ballOwner();
  if (o && o.team !== gk.team && d < 16 && Math.abs(b.pos.y) < 12) {
    const t = clamp(1 - d / 16, 0, 1) * 0.6;
    gk.target = v2(gk.target.x + (bp.x - gk.target.x) * t, gk.target.y + (bp.y - gk.target.y) * t);
    gk.wantsSprint = true;
  }
}

/** Give the keeper a chance to stop a ball flying at goal. Returns true if a save was made. */
export function keeperSaveCheck(m: Match, gk: SimPlayer): boolean {
  if (gk.sentOff) return false;
  const b = m.ball;
  if (b.owner >= 0) return false;
  const gx = m.ownGoalX(gk.team);
  const s = Math.sign(gx);
  if (Math.abs(gk.pos.x - gx) > PENALTY_AREA_DEPTH + 1) return false;
  const speed = Math.hypot(b.vel.x, b.vel.y, b.vel.z);
  if (speed < 7 || b.vel.x * s <= 0) return false;
  const att = lastAttempt(m);
  if (att[gk.team] === m.kickId) return false;
  // Only shots and other strikes from the opposition.
  if (m.lastKick && m.lastKick.team === gk.team) return false;
  const diving = gk.action === 'dive';
  const bodyZ = diving ? 0.6 : 1.0;
  const dh = dist(gk.pos, b.pos);
  const dz = Math.max(0, Math.abs(b.pos.z - bodyZ) - (diving ? 0.5 : 1.3));
  const reach = diving ? 1.3 + gk.info.attrs.gkDiving / 400 : 0.9 + gk.info.attrs.gkPositioning / 500;
  if (Math.hypot(dh, dz) > reach) return false;
  att[gk.team] = m.kickId;
  const a = gk.info.attrs;
  const pSave = clamp(1.05 - (speed - 12) * 0.03 + (a.gkReflexes - 75) / 120 - (diving ? 0.06 : 0), 0.08, 0.97);
  if (!m.rng.chance(pSave)) return false;
  const caught = speed < 19 && m.rng.chance(a.gkHandling / 105);
  gk.kickCooldown = 0;
  if (caught) {
    b.vel = { x: 0, y: 0, z: 0 };
    m.registerSave(gk, true);
  } else {
    if (m.rng.chance(0.4)) {
      // Tipped round the post: out behind for a corner, well wide of the frame.
      const toLine = Math.max(0.3, Math.abs(gx - b.pos.x));
      const vx = 3;
      const t = toLine / vx;
      const side = Math.sign(b.pos.y) || (m.rng.chance(0.5) ? 1 : -1);
      const vy = side * Math.max(6, (GOAL_HALF_WIDTH + 1.5 - Math.abs(b.pos.y)) / t + 2);
      b.vel = { x: s * vx, y: vy, z: 1 + m.rng.next() * 2 };
    } else {
      // Parry back into play.
      b.vel = {
        x: -s * (Math.abs(b.vel.x) * 0.3 + 2),
        y: b.vel.y * 0.3 + m.rng.gauss(5),
        z: 1.5 + m.rng.next() * 3,
      };
    }
    m.registerSave(gk, false);
  }
  return true;
}
