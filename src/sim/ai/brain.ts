import { DT, GOAL_HALF_WIDTH, PITCH_HALF_LENGTH, PITCH_HALF_WIDTH, TICK_RATE } from '../constants';
import type { Match } from '../match';
import type { Difficulty, KickKind, RestartKind, SimPlayer, TeamId } from '../types';
import { angleBetween, clamp, dist, len, norm, pointSegment, sub, v2, type V2 } from '../vec';
import { keeperUpdate } from './keeper';

interface DiffParams {
  react: number; // seconds between on-ball decisions
  noise: number; // decision noise
  tackleRate: number; // standing tackle attempts per second when close
  slideRate: number;
}

const DIFF: Record<Difficulty, DiffParams> = {
  amateur: { react: 0.55, noise: 0.16, tackleRate: 0.9, slideRate: 0.08 },
  pro: { react: 0.35, noise: 0.08, tackleRate: 1.6, slideRate: 0.15 },
  worldclass: { react: 0.22, noise: 0.03, tackleRate: 2.4, slideRate: 0.2 },
};

function params(m: Match, team: TeamId): DiffParams {
  // The CPU side plays at the chosen difficulty; AI teammates of humans play at Pro.
  if (m.teamHasHuman(team)) return DIFF.pro;
  return DIFF[m.cfg.difficulty];
}

/** Convert a frame position (attacking +x) for `team` into world coordinates. */
function toWorld(m: Match, team: TeamId, fx: number, fy: number): V2 {
  const d = m.dir(team);
  return v2(fx * d, fy * d);
}

/** The formation position for `p` given where the ball is. */
export function shapeTarget(m: Match, p: SimPlayer, attacking: boolean, ball: V2): V2 {
  const team = p.team;
  const d = m.dir(team);
  const bx = ball.x * d;
  const by = ball.y * d;
  if (p.slot === 0) return toWorld(m, team, -PITCH_HALF_LENGTH + 1.5, 0);
  const slot = m.formations[team][p.slot];
  const L = attacking ? 36 : 26;
  const back = attacking ? clamp(bx * 0.75 - 16, -38, 10) : clamp(bx * 0.7 - 15, -40, -6);
  let fx = back + ((slot.depth + 1) / 2) * L;
  let fy = slot.side * (attacking ? 29 : 21) + by * (attacking ? 0.15 : 0.35);
  fx = clamp(fx, -PITCH_HALF_LENGTH + 3, PITCH_HALF_LENGTH - 6);
  fy = clamp(fy, -PITCH_HALF_WIDTH + 2, PITCH_HALF_WIDTH - 2);
  return toWorld(m, team, fx, fy);
}

/** How dangerous a position is for `team` (0 at own goal line, ~1.2 at the penalty spot). */
function threat(m: Match, team: TeamId, pos: V2): number {
  const fx = pos.x * m.dir(team);
  let t = Math.pow(clamp((fx + PITCH_HALF_LENGTH) / (2 * PITCH_HALF_LENGTH), 0, 1), 2);
  if (fx > 30) t += 0.25 * clamp(1 - Math.abs(pos.y) / 30, 0, 1);
  return t;
}

/** Highest defender line the attackers of `team` must stay behind (frame x). */
function offsideLine(m: Match, team: TeamId): number {
  const d = m.dir(team);
  const xs = m
    .teamPlayers((1 - team) as TeamId)
    .map((q) => q.pos.x * d)
    .sort((a, b) => b - a);
  const second = xs.length >= 2 ? xs[1] : PITCH_HALF_LENGTH;
  return Math.max(second, m.ball.pos.x * d, 0);
}

/**
 * How likely an opponent can cut out a ball played from `from` to `to`: compares how far each
 * opponent is from the ball's path with how far they can run before the ball gets there.
 */
function laneRisk(m: Match, team: TeamId, from: V2, to: V2, ballSpeed = 13): number {
  const dl = dist(from, to);
  let risk = 0;
  for (const o of m.players) {
    if (o.team === team || o.sentOff) continue;
    const { d, t } = pointSegment(o.pos, from, to);
    const tBall = (t * dl) / ballSpeed;
    const reach = 0.8 + Math.max(0, tBall - 0.2) * 5.5;
    risk = Math.max(risk, clamp(1.2 - d / reach, 0, 1));
  }
  return risk;
}

function nearestOpponentDist(m: Match, team: TeamId, pt: V2): number {
  let best = Infinity;
  for (const o of m.players) if (o.team !== team && !o.sentOff) best = Math.min(best, dist(o.pos, pt));
  return best;
}

interface Intercept {
  t: number;
  pt: V2;
}

function interceptFor(m: Match, p: SimPlayer): Intercept {
  const sp = m.sprintSpeed(p);
  const pred = m.ballPrediction;
  for (let k = 0; k < pred.length; k++) {
    const b = pred[k];
    if (b.z > 2.0) continue;
    const need = Math.max(0, dist(p.pos, b) - 0.5) / sp + 0.15;
    if (need <= k * 0.1) return { t: k * 0.1, pt: v2(b.x, b.y) };
  }
  const last = pred[pred.length - 1] ?? m.ball.pos;
  return { t: 2 + dist(p.pos, last) / sp, pt: v2(last.x, last.y) };
}

// ----------------------------------------------------------------- update

export function aiUpdate(m: Match): void {
  if (m.phase === 'goal') {
    for (const p of m.players) {
      p.wantsSprint = false;
      p.target = { ...p.pos };
    }
    return;
  }
  if (m.phase === 'restart') {
    const r = m.nextRestart;
    for (const p of m.players) {
      if (p.sentOff || p.controller !== null) continue;
      p.wantsSprint = false;
      p.target = r ? shapeTarget(m, p, p.team === r.team, r.spot) : { ...p.pos };
    }
    return;
  }
  if (m.phase !== 'play') return;
  if (m.ballPrediction.length === 0) return;

  const owner = m.ballOwner();
  const ballPos = v2(m.ball.pos.x, m.ball.pos.y);

  // Who gets to the loose ball first, per team.
  const inter: Intercept[] = m.players.map((p) => (p.sentOff ? { t: Infinity, pt: ballPos } : interceptFor(m, p)));
  const bestAll: [number, number] = [Infinity, Infinity];
  const bestAI: [SimPlayer | null, SimPlayer | null] = [null, null];
  for (const p of m.players) {
    if (p.sentOff) continue;
    const t = inter[p.idx].t;
    if (t < bestAll[p.team]) bestAll[p.team] = t;
    if (p.controller === null && p.slot !== 0) {
      const cur = bestAI[p.team];
      if (!cur || t < inter[cur.idx].t) bestAI[p.team] = p;
    }
  }

  for (const team of [0, 1] as TeamId[]) {
    const prm = params(m, team);
    const gk = m.keeper(team);
    const gkBest = inter[gk.idx].t <= bestAll[team] && inter[gk.idx].t < bestAll[1 - team];
    keeperUpdate(m, gk, gkBest, inter[gk.idx].pt);
    if (owner === gk && m.ball.held) keeperDistribute(m, gk);

    const attacking = owner ? owner.team === team : bestAll[team] < bestAll[1 - team];
    const humanBest = m.players.some((p) => p.team === team && p.controller !== null && inter[p.idx].t <= bestAll[team] + 0.05);

    // Defensive assignments.
    let presser: SimPlayer | null = null;
    let second: SimPlayer | null = null;
    if (owner && owner.team !== team && !m.ball.held) {
      const cands = m
        .teamPlayers(team)
        .filter((p) => p.controller === null && p.slot !== 0)
        .sort((a, b) => dist(a.pos, owner.pos) - dist(b.pos, owner.pos));
      const humanClose = m.players.some((p) => p.team === team && p.controller !== null && dist(p.pos, owner.pos) < 5);
      const contain = m.controllers.some((c) => c.team === team && c.contain);
      if (!humanClose) presser = cands[0] ?? null;
      if (contain) second = humanClose ? cands[0] ?? null : cands[1] ?? null;
      // Deep in our own third a second man always helps.
      const fxOwn = owner.pos.x * m.dir(team);
      if (!second && fxOwn < -25 && !m.teamHasHuman(team)) second = cands[1] ?? null;
    }
    const marked = new Set<number>();

    for (const p of m.teamPlayers(team)) {
      if (p.controller !== null || p.slot === 0) continue;
      p.wantsSprint = false;
      if (owner === p) {
        ownerAI(m, p, prm);
        continue;
      }
      if (!owner) {
        const pp = m.pendingPass;
        if (pp && pp.team === team && pp.receiver === p.idx) {
          p.target = inter[p.idx].pt;
          p.wantsSprint = dist(p.pos, p.target) > 2;
          continue;
        }
        const receiverChasing = pp && pp.team === team && pp.receiver >= 0 && m.players[pp.receiver].controller === null;
        if (bestAI[team] === p && !humanBest && !receiverChasing) {
          p.target = inter[p.idx].pt;
          p.wantsSprint = true;
          continue;
        }
      } else if (owner.team !== team && !m.ball.held) {
        if (p === presser || p === second) {
          press(m, p, owner, prm, p === presser);
          continue;
        }
      }
      const base = shapeTarget(m, p, attacking, ballPos);
      if (attacking) p.target = supportTarget(m, p, base);
      else p.target = markTarget(m, p, base, marked);
      p.wantsSprint = dist(p.pos, p.target) > 10;
    }
  }
}

function press(m: Match, p: SimPlayer, owner: SimPlayer, prm: DiffParams, first: boolean): void {
  const goal = v2(m.ownGoalX(p.team), 0);
  const toGoal = norm(sub(goal, owner.pos));
  const gap = first ? 1.0 : 2.5;
  const lead = { x: owner.vel.x * 0.25, y: owner.vel.y * 0.25 };
  p.target = v2(owner.pos.x + toGoal.x * gap + lead.x, owner.pos.y + toGoal.y * gap + lead.y);
  const d = dist(p.pos, owner.pos);
  p.wantsSprint = d > 3.5;
  if (!first || p.action !== 'none') return;
  const facing = angleBetween(p.facing, sub(owner.pos, p.pos)) < 0.9;
  if (d < 1.5 && facing && m.rng.chance(prm.tackleRate * DT)) m.startTackle(p);
  else if (
    d > 1.4 &&
    d < 2.8 &&
    facing &&
    !m.inOwnPenaltyArea(p.team, owner.pos) &&
    m.rng.chance(prm.slideRate * DT)
  ) {
    p.facing = norm(sub(owner.pos, p.pos));
    m.startSlide(p);
  }
}

function markTarget(m: Match, p: SimPlayer, base: V2, marked: Set<number>): V2 {
  const goal = v2(m.ownGoalX(p.team), 0);
  let best: SimPlayer | null = null;
  let bd = 11;
  for (const o of m.teamPlayers((1 - p.team) as TeamId)) {
    if (o.slot === 0 || marked.has(o.idx) || o.idx === m.ball.owner) continue;
    const d = dist(o.pos, base);
    if (d < bd) {
      bd = d;
      best = o;
    }
  }
  if (!best) return base;
  marked.add(best.idx);
  const gs = norm(sub(goal, best.pos));
  const mark = v2(best.pos.x + gs.x * 1.6, best.pos.y + gs.y * 1.6);
  return v2(base.x + (mark.x - base.x) * 0.6, base.y + (mark.y - base.y) * 0.6);
}

function supportTarget(m: Match, p: SimPlayer, base: V2): V2 {
  const team = p.team;
  const d = m.dir(team);
  const mem = m.aiMem[p.idx];
  const slot = m.formations[team][p.slot];
  const line = offsideLine(m, team);
  let fx = base.x * d;
  let fy = base.y * d;
  const ballFx = m.ball.pos.x * d;
  // Forwards make runs in behind when the ball is in midfield or further forward.
  if (slot.depth >= 0.3 && ballFx > -20 && m.tick >= mem.runUntil && m.rng.chance(0.45 * DT)) {
    if (p.pos.x * d < line - 0.5) mem.runUntil = m.tick + Math.round(TICK_RATE * 2.2);
  }
  if (m.tick < mem.runUntil) {
    fx = Math.min(line + 10, PITCH_HALF_LENGTH - 6);
    p.wantsSprint = true;
  } else {
    fx = Math.min(fx, line - 0.8);
  }
  // Spread out from teammates that are too close.
  for (const q of m.teamPlayers(team)) {
    if (q === p) continue;
    const dd = dist(q.pos, p.pos);
    if (dd < 6 && dd > 0.01) {
      fy += ((p.pos.y - q.pos.y) * d * (6 - dd)) / 6;
    }
  }
  fy = clamp(fy, -PITCH_HALF_WIDTH + 1.5, PITCH_HALF_WIDTH - 1.5);
  return v2(fx * d, fy * d);
}

// --------------------------------------------------------- on-ball AI

interface Option {
  kind: KickKind | 'dribble';
  score: number;
  receiver?: number;
  target?: V2;
  power: number;
}

function ownerAI(m: Match, p: SimPlayer, prm: DiffParams): void {
  const mem = m.aiMem[p.idx];
  const team = p.team;
  const d = m.dir(team);
  const pressure = clamp(1 - (nearestOpponentDist(m, team, p.pos) - 1) / 4, 0, 1);
  // Keep dribbling toward the current target between decisions.
  if (m.tick < mem.nextDecision && pressure < 0.85) {
    p.target = dribbleTarget(m, p);
    return;
  }
  mem.nextDecision = m.tick + Math.round(TICK_RATE * prm.react * (0.8 + m.rng.next() * 0.4));
  const held = (m.tick - mem.holdSince) / TICK_RATE;
  const opts: Option[] = [];

  // Shooting.
  const gx = m.oppGoalX(team);
  const dg = dist(p.pos, v2(gx, 0));
  if (dg < 32) {
    const a1 = Math.atan2(GOAL_HALF_WIDTH - p.pos.y, gx - p.pos.x);
    const a2 = Math.atan2(-GOAL_HALF_WIDTH - p.pos.y, gx - p.pos.x);
    let width = Math.abs(a1 - a2);
    if (width > Math.PI) width = 2 * Math.PI - width;
    let q = clamp(width / 0.6, 0, 1) * (0.55 + p.info.attrs.shooting / 220);
    for (const o of m.teamPlayers((1 - team) as TeamId)) {
      if (o.slot === 0) continue;
      const { d: od, t } = pointSegment(o.pos, p.pos, v2(gx, 0));
      if (t > 0.02 && t < 0.98 && od < 1.2) q -= 0.18;
    }
    const sc = q * 1.45 + (dg < 16 ? 0.3 : 0) - (dg > 25 ? 0.2 : 0);
    opts.push({ kind: 'shot', score: sc, power: clamp(0.45 + dg / 50, 0.5, 0.9) });
  }

  // Passing.
  for (const q of m.teamPlayers(team)) {
    if (q === p) continue;
    const dq = dist(p.pos, q.pos);
    if (dq < 4 || dq > 45) continue;
    if (q.slot === 0 && pressure < 0.7) continue;
    const lead = v2(q.pos.x + q.vel.x * 0.5, q.pos.y + q.vel.y * 0.5);
    const space = Math.min(nearestOpponentDist(m, team, q.pos), 8);
    const val = threat(m, team, q.pos) + 0.06 * (space / 8);
    // Passing to a player standing offside wastes the ball.
    const offside = q.pos.x * d > Math.max(offsideLineFor(m, team), m.ball.pos.x * d, 0) + 0.05;
    const penalty = offside ? 1 : 0;
    const risk = laneRisk(m, team, p.pos, lead) + (space < 1.5 ? 0.3 : 0);
    const progress = (q.pos.x - p.pos.x) * d;
    opts.push({ kind: 'pass', score: val - risk * 0.9 + progress * 0.01 - (dq > 30 ? 0.1 : 0) - penalty, receiver: q.idx, power: 0.5 });
    if (dq > 14) {
      // A lofted ball is safe if the receiver gets to where it lands before any opponent.
      const recvT = dist(q.pos, lead) / m.sprintSpeed(q);
      let oppT = Infinity;
      for (const o of m.teamPlayers((1 - team) as TeamId)) oppT = Math.min(oppT, dist(o.pos, lead) / m.sprintSpeed(o));
      const lobRisk = clamp((recvT - oppT + 0.8) / 1.2, 0, 1);
      // Aerial balls are contested anywhere near where they come down.
      const contested = nearestOpponentDist(m, team, lead) < 4 ? 0.5 : 0;
      opts.push({ kind: 'lob', score: val * 0.88 - lobRisk * 0.8 - contested + progress * 0.01 - 0.14 - penalty, receiver: q.idx, power: 0.5 });
    }
    // Through balls to runners.
    const slot = m.formations[team][q.slot];
    if (slot.depth >= 0.3 && q.pos.x * d > p.pos.x * d && !offside) {
      const ahead = v2(q.pos.x + d * 9, q.pos.y + q.vel.y * 0.4);
      ahead.x = clamp(ahead.x, -PITCH_HALF_LENGTH + 2, PITCH_HALF_LENGTH - 2);
      const oppFirst = m.teamPlayers((1 - team) as TeamId).some((o) => dist(o.pos, ahead) < dist(q.pos, ahead) - 1);
      const r = laneRisk(m, team, p.pos, ahead) + (oppFirst ? 0.6 : 0);
      opts.push({ kind: 'through', score: threat(m, team, ahead) + 0.1 - r * 0.8, target: ahead, receiver: q.idx, power: 0.5 });
    }
  }

  // Dribbling.
  // Dribble into space: value grows with the room in front of the player.
  const fwd = norm(sub(v2(m.oppGoalX(team), 0), p.pos));
  let room = 10;
  for (const o of m.teamPlayers((1 - team) as TeamId)) {
    const to = sub(o.pos, p.pos);
    if (angleBetween(fwd, to) < 0.8) room = Math.min(room, len(to));
  }
  const dribble = threat(m, team, p.pos) + (room / 10) * 0.28 - 0.08 - pressure * 0.22;
  opts.push({ kind: 'dribble', score: dribble, power: 0 });

  // Clearances when stuck deep under pressure.
  const fx = p.pos.x * d;
  if (fx < -30 && pressure > 0.6) opts.push({ kind: 'clear', score: 0.35, power: 0.8 });

  for (const o of opts) o.score += m.rng.gauss(prm.noise);
  // Settle the ball for a moment unless pressed.
  if (held < 0.3 && pressure < 0.5) {
    for (const o of opts) if (o.kind !== 'dribble') o.score -= 0.3;
  }
  opts.sort((a, b) => b.score - a.score);
  const best = opts[0];
  if (best.kind === 'dribble') {
    p.target = dribbleTarget(m, p);
    return;
  }
  m.kick(p, best.kind, {
    power: best.power,
    receiver: best.kind === 'shot' || best.kind === 'clear' ? undefined : best.receiver,
    target: best.target,
    dir: best.kind === 'clear' ? v2(d, 0) : undefined,
  });
}

function offsideLineFor(m: Match, team: TeamId): number {
  const d = m.dir(team);
  const xs = m
    .teamPlayers((1 - team) as TeamId)
    .map((q) => q.pos.x * d)
    .sort((a, b) => b - a);
  return xs.length >= 2 ? xs[1] : PITCH_HALF_LENGTH;
}

function dribbleTarget(m: Match, p: SimPlayer): V2 {
  const team = p.team;
  const d = m.dir(team);
  const goal = v2(m.oppGoalX(team), 0);
  let dirv = norm(sub(goal, p.pos));
  // Steer around nearby defenders in front.
  for (const o of m.teamPlayers((1 - team) as TeamId)) {
    const to = sub(o.pos, p.pos);
    const dl = len(to);
    if (dl < 6 && dl > 0.01 && angleBetween(dirv, to) < 1.0) {
      const side = Math.sign(dirv.x * to.y - dirv.y * to.x) || 1;
      const perp = v2(dirv.y * side, -dirv.x * side);
      const w = (6 - dl) / 6;
      dirv = norm(v2(dirv.x + perp.x * w * 1.3, dirv.y + perp.y * w * 1.3));
    }
  }
  if (Math.abs(p.pos.y) > PITCH_HALF_WIDTH - 4) dirv = norm(v2(dirv.x, dirv.y - Math.sign(p.pos.y) * 0.8));
  if (p.pos.x * d > PITCH_HALF_LENGTH - 6) dirv = norm(v2(dirv.x * 0.3, -Math.sign(p.pos.y || 1) * 1));
  p.wantsSprint = nearestOpponentDist(m, team, p.pos) > 4 && p.stamina > 0.3;
  return v2(p.pos.x + dirv.x * 5, p.pos.y + dirv.y * 5);
}

/** Keeper holding the ball in play: release it after a short hold. */
function keeperDistribute(m: Match, gk: SimPlayer): void {
  if (m.gkHold < 1.2) return;
  aiTakeRestart(m, gk, 'goalkick');
}

/** AI execution of a restart (or a keeper's distribution in open play). */
export function aiTakeRestart(m: Match, taker: SimPlayer, kind: RestartKind): void {
  const team = taker.team;
  const d = m.dir(team);
  const mates = m.teamPlayers(team).filter((q) => q !== taker && q.slot !== 0);
  const go = (k: KickKind, opt: { power: number; receiver?: number; target?: V2; dir?: V2 }) => {
    if (m.phase === 'play') m.kick(taker, k, opt);
    else m.takeRestart(taker, k, { ...opt, restart: kind });
  };
  const safest = (maxD: number) => {
    let best: SimPlayer | null = null;
    let bs = -Infinity;
    for (const q of mates) {
      const dq = dist(q.pos, taker.pos);
      if (dq > maxD || dq < 3) continue;
      const s = -laneRisk(m, team, taker.pos, q.pos) * 2 + Math.min(nearestOpponentDist(m, team, q.pos), 8) / 8 + threat(m, team, q.pos) * 0.5;
      if (s > bs) {
        bs = s;
        best = q;
      }
    }
    return best;
  };
  switch (kind) {
    case 'kickoff': {
      const q = mates.reduce((a, c) => (dist(c.pos, taker.pos) < dist(a.pos, taker.pos) ? c : a));
      go('pass', { power: 0.3, receiver: q.idx });
      return;
    }
    case 'throwin': {
      const q = safest(22) ?? mates[0];
      go('throw', { power: 0.5, receiver: q.idx });
      return;
    }
    case 'corner': {
      const gx = m.oppGoalX(team);
      const s = Math.sign(gx);
      const target = v2(gx - s * (6 + m.rng.next() * 6), m.rng.gauss(4));
      go('lob', { power: 0.6, target });
      return;
    }
    case 'goalkick': {
      const q = safest(30);
      if (q && laneRisk(m, team, taker.pos, q.pos) < 0.35) go('pass', { power: 0.5, receiver: q.idx });
      else {
        const fwd = mates.reduce((a, c) => (c.pos.x * d > a.pos.x * d ? c : a));
        go('lob', { power: 0.8, target: v2(clamp(fwd.pos.x, -40, 40), fwd.pos.y) });
      }
      return;
    }
    case 'freekick': {
      const gx = m.oppGoalX(team);
      const dg = dist(taker.pos, v2(gx, 0));
      if (!m.restart?.indirect && dg < 27 && m.phase !== 'play') {
        const y = (m.rng.chance(0.5) ? 1 : -1) * (GOAL_HALF_WIDTH - 0.8);
        go('shot', { power: 0.7, target: v2(gx, y) });
        return;
      }
      const q = safest(35) ?? mates[0];
      go('pass', { power: 0.5, receiver: q.idx });
      return;
    }
    case 'penalty': {
      const gx = m.oppGoalX(team);
      const y = [-1, 1][Math.floor(m.rng.next() * 2)] * (GOAL_HALF_WIDTH - 0.9 - m.rng.next() * 0.8);
      go('shot', { power: 0.6 + m.rng.next() * 0.2, target: v2(gx, y) });
      return;
    }
  }
}
