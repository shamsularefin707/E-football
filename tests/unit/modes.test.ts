import { describe, expect, it } from 'vitest';
import type { Match } from '../../src/sim/match';
import { Rng } from '../../src/sim/rng';
import { emptyInput, type ControllerConfig, type ControllerInput } from '../../src/sim/types';
import { v2 } from '../../src/sim/vec';
import { freePlay, newMatch, run, runUntil } from './helpers';

const MODES: Record<string, ControllerConfig[]> = {
  'vs CPU': [{ id: 0, team: 0 }],
  '1v1': [
    { id: 0, team: 0 },
    { id: 1, team: 1 },
  ],
  '2v2': [
    { id: 0, team: 0 },
    { id: 1, team: 0 },
    { id: 2, team: 1 },
    { id: 3, team: 1 },
  ],
  'co-op vs CPU': [
    { id: 0, team: 0 },
    { id: 1, team: 0 },
  ],
};

/** Checks that must hold on every tick of every match. */
function checkInvariants(m: Match): void {
  const b = m.ball;
  for (const v of [b.pos.x, b.pos.y, b.pos.z, b.vel.x, b.vel.y, b.vel.z]) expect(Number.isFinite(v)).toBe(true);
  expect(Math.abs(b.pos.x)).toBeLessThan(62);
  expect(Math.abs(b.pos.y)).toBeLessThan(45);
  expect(b.pos.z).toBeGreaterThanOrEqual(0);
  if (b.owner >= 0) expect(m.players[b.owner].sentOff).toBe(false);
  const owners = new Map<number, number>();
  for (const p of m.players) {
    expect(Number.isFinite(p.pos.x) && Number.isFinite(p.pos.y)).toBe(true);
    if (p.controller !== null) {
      expect(owners.has(p.controller), 'one player per controller').toBe(false);
      owners.set(p.controller, p.idx);
    }
  }
  for (const c of m.controllers) {
    const p = m.players[c.player];
    if (!p) continue;
    expect(p.team, 'controller stays on its own team').toBe(c.team);
    expect(p.controller).toBe(c.id);
    expect(p.sentOff).toBe(false);
  }
  expect(m.score[0]).toBe(m.stats[0].goals);
  expect(m.score[1]).toBe(m.stats[1].goals);
}

function randomInput(rng: Rng, prev: ControllerInput): ControllerInput {
  // Sticky random input: buttons tend to be held for a while, like a person.
  const flip = (v: boolean, p: number) => (rng.chance(p) ? !v : v);
  return {
    moveX: rng.chance(0.05) ? rng.range(-1, 1) : prev.moveX,
    moveY: rng.chance(0.05) ? rng.range(-1, 1) : prev.moveY,
    sprint: flip(prev.sprint, 0.02),
    pass: flip(prev.pass, 0.04),
    shoot: flip(prev.shoot, 0.02),
    through: flip(prev.through, 0.02),
    lob: flip(prev.lob, 0.015),
    switchPlayer: flip(prev.switchPlayer, 0.02),
  };
}

describe.each(Object.entries(MODES))('%s', (_name, controllers) => {
  it('gives every controller a player on its own team from the kick-off', () => {
    const m = newMatch({ controllers, seed: 5 });
    checkInvariants(m);
    for (const c of m.controllers) expect(c.player).toBeGreaterThanOrEqual(0);
    // The human on the kicking side is the kick-off taker.
    const kicking = m.controllers.filter((c) => c.team === m.restart!.team);
    if (kicking.length) expect(kicking.some((c) => c.player === m.restart!.taker)).toBe(true);
  });

  it('plays a full match with button-mashing humans and keeps every rule invariant', () => {
    for (const seed of [1, 2]) {
      const m = newMatch({ controllers, seed, half: 2 });
      const rng = new Rng(seed * 7);
      const inputs = new Map(controllers.map((c) => [c.id, emptyInput()]));
      let ticks = 0;
      const stuck: Record<string, number> = {};
      let lastPhase = m.phase;
      let phaseTicks = 0;
      while (m.phase !== 'fulltime' && ticks < 60 * 60 * 12) {
        for (const c of controllers) {
          const next = randomInput(rng, inputs.get(c.id)!);
          inputs.set(c.id, next);
          m.setInput(c.id, next);
        }
        m.step();
        ticks++;
        if (ticks % 6 === 0) checkInvariants(m);
        phaseTicks = m.phase === lastPhase ? phaseTicks + 1 : 0;
        lastPhase = m.phase;
        if (m.phase !== 'play') stuck[m.phase] = Math.max(stuck[m.phase] ?? 0, phaseTicks);
      }
      expect(m.phase).toBe('fulltime');
      // No restart ever stalls the game: idle humans get covered by the CPU after 20s.
      for (const [phase, t] of Object.entries(stuck)) expect(t / 60, `${phase} too long`).toBeLessThan(22);
      checkInvariants(m);
    }
  });
});

describe('human controls', () => {
  it('moves the controlled player with the stick and sprints faster', () => {
    const m = newMatch({ controllers: [{ id: 0, team: 0 }], seed: 5 });
    freePlay(m);
    const p = m.players[m.controllers[0].player];
    m.ball.owner = -1;
    m.ball.pos = { x: 0, y: 30, z: 0 };
    const x0 = p.pos.x;
    run(m, 1, () => m.setInput(0, { ...emptyInput(), moveX: 1 }));
    const jog = p.pos.x - x0;
    expect(jog).toBeGreaterThan(3.5);
    const x1 = p.pos.x;
    run(m, 1, () => m.setInput(0, { ...emptyInput(), moveX: 1, sprint: true }));
    expect(p.pos.x - x1).toBeGreaterThan(jog * 1.15);
    // Stick up (away from the camera) is +y.
    const y0 = p.pos.y;
    run(m, 0.6, () => m.setInput(0, { ...emptyInput(), moveY: 1 }));
    expect(p.pos.y).toBeGreaterThan(y0 + 1);
  });

  it('a held pass button charges power and releasing passes to a teammate who becomes controlled', () => {
    const m = newMatch({ controllers: [{ id: 0, team: 0 }], seed: 5 });
    freePlay(m);
    const c = m.controllers[0];
    const p = m.players[c.player];
    p.pos = v2(0, 0);
    p.facing = v2(1, 0);
    m.ball.owner = p.idx;
    m.ball.pos = { x: 0.45, y: 0, z: 0 };
    const mate = m.players.find((q) => q.team === 0 && q !== p && q.slot !== 0)!;
    mate.pos = v2(15, 0);
    // Opponents out of the way (but deep enough that the receiver is onside).
    m.teamPlayers(1).forEach((q, i) => (q.pos = v2(30 + i, 30)));
    run(m, 0.5, () => m.setInput(0, { ...emptyInput(), moveX: 1, pass: true }));
    expect(m.chargePower(c)).toBeGreaterThan(0.4);
    m.setInput(0, emptyInput());
    m.step();
    expect(m.lastKick?.kind).toBe('pass');
    expect(c.player).toBe(mate.idx);
    expect(mate.controller).toBe(0);
    expect(runUntil(m, () => m.ball.owner === mate.idx, 3)).toBe(true);
    expect(m.stats[0].passesCompleted).toBe(1);
  });

  it('shoot button scores against an empty goal', () => {
    const m = newMatch({ controllers: [{ id: 0, team: 0 }], seed: 5 });
    freePlay(m);
    const c = m.controllers[0];
    const p = m.players[c.player];
    p.pos = v2(38, 0);
    p.facing = v2(1, 0);
    m.ball.owner = p.idx;
    m.ball.pos = { x: 38.45, y: 0, z: 0 };
    m.teamPlayers(1).forEach((q, i) => (q.pos = v2(-20 - i, 30)));
    run(m, 0.35, () => m.setInput(0, { ...emptyInput(), moveX: 1, shoot: true }));
    m.setInput(0, emptyInput());
    expect(runUntil(m, () => m.phase === 'goal', 3)).toBe(true);
    expect(m.score).toEqual([1, 0]);
    expect(m.stats[0].shots).toBe(1);
    expect(m.stats[0].onTarget).toBe(1);
  });

  it('pass button tackles and lob button slides when defending', () => {
    const m = newMatch({ controllers: [{ id: 0, team: 0 }], seed: 5 });
    freePlay(m);
    const c = m.controllers[0];
    const p = m.players[c.player];
    const o = m.players[20];
    m.ball.owner = o.idx;
    o.pos = v2(5, 5);
    m.ball.pos = { x: 4.6, y: 5, z: 0 };
    m.setInput(0, { ...emptyInput(), pass: true });
    m.step();
    expect(['tackle', 'stumble', 'none']).toContain(p.action);
    expect(m.log.some((l) => l.e.type === 'tackle') || p.action === 'tackle').toBe(true);
    m.setInput(0, emptyInput());
    run(m, 1);
    p.action = 'none';
    m.ball.owner = o.idx;
    m.setInput(0, { ...emptyInput(), lob: true });
    m.step();
    expect(['slide', 'stumble']).toContain(p.action);
  });

  it('switching picks the teammate nearest the ball, never the keeper or the partner', () => {
    const m = newMatch({
      controllers: [
        { id: 0, team: 0 },
        { id: 1, team: 0 },
      ],
      seed: 5,
    });
    freePlay(m);
    m.ball.owner = 20;
    m.ball.pos = { x: -40, y: 0, z: 0 };
    m.players[20].pos = v2(-40, 0);
    for (let i = 0; i < 30; i++) {
      const id = i % 2;
      m.setInput(id, { ...emptyInput(), switchPlayer: true });
      m.step();
      m.setInput(id, emptyInput());
      m.step();
      const [a, b] = m.controllers;
      expect(a.player).not.toBe(b.player);
      expect(m.players[a.player].slot).not.toBe(0);
      expect(m.players[b.player].slot).not.toBe(0);
    }
  });

  it('a human kick-off taker is not rushed, and the kick-off pass starts play', () => {
    const m = newMatch({ controllers: [{ id: 0, team: 0 }], seed: 2 });
    // Make sure the human team kicks off.
    if (m.restart!.team !== 0) {
      runUntil(m, () => m.phase === 'play', 3);
      return; // the CPU kicked off: covered elsewhere
    }
    run(m, 5);
    expect(m.phase).toBe('kickoff');
    m.setInput(0, { ...emptyInput(), moveY: 1, pass: true });
    run(m, 0.2);
    m.setInput(0, emptyInput());
    m.step();
    expect(m.phase).toBe('play');
    expect(m.lastKick?.restart).toBe('kickoff');
  });

  it('1v1: each human only ever controls their own team', () => {
    const m = newMatch({ controllers: MODES['1v1'], seed: 8 });
    const rng = new Rng(3);
    let a = emptyInput();
    let b = emptyInput();
    run(m, 120, () => {
      a = randomInput(rng, a);
      b = randomInput(rng, b);
      m.setInput(0, a);
      m.setInput(1, b);
    });
    checkInvariants(m);
    expect(m.players[m.controllers[0].player].team).toBe(0);
    expect(m.players[m.controllers[1].player].team).toBe(1);
  });
});
