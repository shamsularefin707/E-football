import { describe, expect, it } from 'vitest';
import {
  CENTRE_CIRCLE_RADIUS,
  GOAL_HALF_WIDTH,
  PENALTY_AREA_DEPTH,
  PITCH_HALF_LENGTH,
  PITCH_HALF_WIDTH,
  RESTART_DELAY,
} from '../../src/sim/constants';
import type { Match } from '../../src/sim/match';
import { v2 } from '../../src/sim/vec';
import { freePlay, newMatch, run, runUntil } from './helpers';

/** Move everyone except the listed players out to the far touchline so they don't interfere. */
function park(m: Match, keep: number[] = []): void {
  m.players.forEach((p, i) => {
    if (keep.includes(i)) return;
    p.pos = v2(-30 + (i % 11) * 3, -PITCH_HALF_WIDTH + 1 + (i < 11 ? 0 : 1.5));
    p.vel = v2();
  });
}

function eventsOf(m: Match, type: string) {
  return m.log.filter((l) => l.e.type === type).map((l) => l.e);
}

function shootFrom(m: Match, x: number, y: number, z: number, vx: number, vy: number, vz: number, team: 0 | 1): void {
  freePlay(m);
  m.ball.pos = { x, y, z };
  m.ball.vel = { x: vx, y: vy, z: vz };
  m.ball.lastTouchTeam = team;
  m.ball.lastTouch = team * 11 + 9;
  m.lastKick = { id: ++m.kickId, kind: 'shot', team, kicker: team * 11 + 9 };
}

describe('kick-off', () => {
  it('lines both teams up legally and starts play', () => {
    const m = newMatch({ seed: 3 });
    expect(m.phase).toBe('kickoff');
    const r = m.restart!;
    for (const p of m.players) {
      const ownHalf = p.pos.x * m.dir(p.team) <= 0.01;
      expect(ownHalf, `player ${p.idx} in own half`).toBe(true);
      if (p.team !== r.team) expect(Math.hypot(p.pos.x, p.pos.y)).toBeGreaterThanOrEqual(CENTRE_CIRCLE_RADIUS);
    }
    expect(m.ball.pos.x).toBe(0);
    expect(m.ball.pos.y).toBe(0);
    expect(m.ball.owner).toBe(r.taker);
    // The CPU takes the kick-off and the clock only starts then.
    expect(runUntil(m, () => m.phase === 'play', 3)).toBe(true);
    expect(m.clock).toBe(0);
    run(m, 1);
    expect(m.clock).toBeGreaterThan(0);
  });
});

describe('goals and out of play', () => {
  it('counts a goal when the ball crosses the line between the posts and under the bar', () => {
    const m = newMatch({ seed: 4 });
    park(m);
    shootFrom(m, 49, 1, 0.5, 18, 0, 1, 0);
    expect(runUntil(m, () => m.phase !== 'play', 1)).toBe(true);
    expect(m.phase).toBe('goal');
    expect(m.score).toEqual([1, 0]);
    const g = eventsOf(m, 'goal')[0] as { team: number; ownGoal: boolean };
    expect(g.team).toBe(0);
    expect(g.ownGoal).toBe(false);
    // After the celebration the conceding side kicks off.
    expect(runUntil(m, () => m.phase === 'kickoff', 8)).toBe(true);
    expect(m.restart!.team).toBe(1);
    expect(m.ball.pos.x).toBe(0);
  });

  it('does not count a ball over the bar', () => {
    const m = newMatch({ seed: 4 });
    park(m);
    shootFrom(m, 49, 0, 2.8, 18, 0, 0.5, 0);
    runUntil(m, () => m.phase !== 'play', 1);
    expect(m.score).toEqual([0, 0]);
    expect(m.nextRestart?.kind ?? m.restart?.kind).toBe('goalkick');
  });

  it('gives a goal kick when the attackers put it wide, a corner when the defenders do', () => {
    const m = newMatch({ seed: 4 });
    park(m);
    shootFrom(m, 49, 6, 0.3, 18, 0, 0, 0);
    runUntil(m, () => m.phase !== 'play', 1);
    expect(m.nextRestart!.kind).toBe('goalkick');
    expect(m.nextRestart!.team).toBe(1);
    expect(m.nextRestart!.spot.x).toBeCloseTo(PITCH_HALF_LENGTH - 5.5);
    run(m, RESTART_DELAY + 0.1);
    expect(m.phase).toBe('setpiece');
    expect(m.restart!.taker).toBe(11); // the keeper takes goal kicks
    for (const p of m.teamPlayers(0)) expect(m.inOwnPenaltyArea(1, p.pos)).toBe(false);

    const m2 = newMatch({ seed: 4 });
    park(m2);
    shootFrom(m2, 49, -8, 0.3, 18, 0, 0, 1); // last touch by the defending team
    runUntil(m2, () => m2.phase !== 'play', 1);
    expect(m2.nextRestart!.kind).toBe('corner');
    expect(m2.nextRestart!.team).toBe(0);
    expect(m2.nextRestart!.spot).toEqual({ x: PITCH_HALF_LENGTH, y: -PITCH_HALF_WIDTH });
    expect(m2.stats[0].corners).toBe(1);
    run(m2, RESTART_DELAY + 0.1);
    for (const p of m2.teamPlayers(1)) expect(Math.hypot(p.pos.x - PITCH_HALF_LENGTH, p.pos.y + PITCH_HALF_WIDTH)).toBeGreaterThanOrEqual(9.15);
  });

  it('gives a throw-in to the team that did not touch it last', () => {
    const m = newMatch({ seed: 4 });
    park(m);
    m.players.forEach((p) => (p.pos = v2(p.pos.x, 0))); // keep the touchline clear
    shootFrom(m, 10, 32, 0, 0, 8, 0, 0);
    runUntil(m, () => m.phase !== 'play', 2);
    expect(m.nextRestart!.kind).toBe('throwin');
    expect(m.nextRestart!.team).toBe(1);
    expect(m.nextRestart!.spot.y).toBe(PITCH_HALF_WIDTH);
    run(m, RESTART_DELAY + 0.1);
    const taker = m.players[m.restart!.taker];
    expect(taker.team).toBe(1);
    expect(m.ball.held).toBe(true);
    // The CPU takes it and play resumes, with no offside on a throw-in.
    expect(runUntil(m, () => m.phase === 'play', 3)).toBe(true);
    expect(m.lastKick!.kind).toBe('throw');
  });

  it('bounces off the post and the crossbar without a goal', () => {
    const m = newMatch({ seed: 4 });
    park(m);
    m.keeper(1).pos = v2(30, 30);
    shootFrom(m, 47, GOAL_HALF_WIDTH + 0.05, 0.5, 25, 0, 0, 0);
    run(m, 0.3);
    expect(eventsOf(m, 'woodwork').length).toBe(1);
    expect(m.score).toEqual([0, 0]);

    const m2 = newMatch({ seed: 4 });
    park(m2);
    m2.keeper(1).pos = v2(30, 30);
    shootFrom(m2, 50, 0, 2.5, 20, 0, 0, 0);
    run(m2, 0.3);
    expect(eventsOf(m2, 'woodwork').length).toBe(1);
    expect(m2.score).toEqual([0, 0]);
  });
});

describe('offside', () => {
  function setup(receiverX: number) {
    const m = newMatch({ seed: 9 });
    freePlay(m);
    park(m, [5, 9, 11]);
    const passer = m.players[5];
    const recv = m.players[9];
    passer.pos = v2(10, 0);
    recv.pos = v2(receiverX, 0);
    // Defenders lined up at x = 25 on the wings, out of the passing lane.
    m.teamPlayers(1).forEach((q, i) => {
      if (q.slot === 0) return;
      q.pos = v2(25, i % 2 ? 30 : -30);
    });
    m.ball.pos = { x: 10.5, y: 0, z: 0 };
    m.ball.owner = 5;
    return { m, passer, recv };
  }

  it('flags a receiver beyond the second-last defender when the ball is played', () => {
    const { m, passer, recv } = setup(32);
    m.kick(passer, 'pass', { power: 0.6, receiver: recv.idx });
    expect(m.offsideSet.has(recv.idx)).toBe(true);
    expect(runUntil(m, () => eventsOf(m, 'offside').length > 0, 6)).toBe(true);
    expect(m.nextRestart!.kind).toBe('freekick');
    expect(m.nextRestart!.indirect).toBe(true);
    expect(m.nextRestart!.team).toBe(1);
    expect(m.stats[0].offsides).toBe(1);
  });

  it('lets play go on when the receiver was level or behind', () => {
    const { m, passer, recv } = setup(20);
    m.kick(passer, 'pass', { power: 0.6, receiver: recv.idx });
    expect(m.offsideSet.size).toBe(0);
    runUntil(m, () => m.ball.owner === recv.idx, 6);
    expect(eventsOf(m, 'offside').length).toBe(0);
  });

  it('is never called in your own half', () => {
    const m = newMatch({ seed: 9 });
    freePlay(m);
    const passer = m.players[5];
    passer.pos = v2(-40, 0);
    m.ball.pos = { x: -39.5, y: 0, z: 0 };
    m.ball.owner = 5;
    m.teamPlayers(1).forEach((q) => (q.pos = v2(-45, q.pos.y)));
    m.players[9].pos = v2(-5, 0);
    expect(m.offsideCandidates(passer).map((p) => p.idx)).not.toContain(9);
  });
});

describe('fouls, penalties and cards', () => {
  function slideScenario(ownerX: number) {
    const m = newMatch({ seed: 11 });
    freePlay(m);
    park(m, [11 + 9, 4]);
    const owner = m.players[11 + 9]; // team 1 attacks -x in the first half
    const tackler = m.players[4];
    owner.pos = v2(ownerX, 0);
    owner.facing = v2(-1, 0);
    owner.vel = v2(-3, 0);
    tackler.pos = v2(ownerX + 1.5, 0);
    tackler.facing = v2(-1, 0);
    m.ball.owner = owner.idx;
    m.ball.pos = { x: ownerX - 0.45, y: 0, z: 0 };
    return { m, owner, tackler };
  }

  it('a slide through the back of a player is a foul and a free kick', () => {
    const { m, owner, tackler } = slideScenario(0);
    m.startSlide(tackler);
    m.step();
    const f = eventsOf(m, 'foul');
    expect(f.length).toBe(1);
    expect(m.stats[0].fouls).toBe(1);
    expect(m.nextRestart!.kind).toBe('freekick');
    expect(m.nextRestart!.team).toBe(1);
    run(m, RESTART_DELAY + 0.1);
    expect(m.phase).toBe('setpiece');
    expect(m.ball.pos.x).toBeCloseTo(owner.pos.x === 0 ? 0 : m.ball.pos.x, 0);
    for (const p of m.teamPlayers(0)) expect(Math.hypot(p.pos.x - m.restart!.spot.x, p.pos.y - m.restart!.spot.y)).toBeGreaterThanOrEqual(9.15);
  });

  it('a foul inside the area is a penalty from the spot', () => {
    const { m, tackler } = slideScenario(-45);
    m.startSlide(tackler);
    m.step();
    expect((eventsOf(m, 'foul')[0] as { penalty: boolean }).penalty).toBe(true);
    expect(m.nextRestart!.kind).toBe('penalty');
    expect(m.nextRestart!.spot).toEqual({ x: -PITCH_HALF_LENGTH + 11, y: 0 });
    run(m, RESTART_DELAY + 0.1);
    expect(m.phase).toBe('setpiece');
    const taker = m.players[m.restart!.taker];
    for (const p of m.players) {
      if (p === taker || p.sentOff) continue;
      if (p.idx === 0) {
        expect(p.pos.x).toBeCloseTo(-PITCH_HALF_LENGTH, 0);
        continue;
      }
      if (p.slot === 0) continue;
      expect(m.inOwnPenaltyArea(0, p.pos), `player ${p.idx} outside the area`).toBe(false);
    }
    // The penalty is taken and play goes on.
    expect(runUntil(m, () => m.phase !== 'setpiece', 4)).toBe(true);
    expect(m.lastKick!.kind).toBe('shot');
    expect(m.lastKick!.restart).toBe('penalty');
  });

  it('a second yellow is a red card and the player leaves the pitch', () => {
    const m = newMatch({ seed: 2 });
    const p = m.players[6];
    m.giveCard(p, 'yellow');
    expect(p.sentOff).toBe(false);
    m.giveCard(p, 'yellow');
    expect(p.sentOff).toBe(true);
    expect(m.teamPlayers(0).length).toBe(10);
    expect(eventsOf(m, 'card').map((e) => (e as { color: string }).color)).toEqual(['yellow', 'yellow', 'red']);
    expect(m.stats[0].red).toBe(1);
    // Sent-off players are never picked again.
    run(m, 30);
    expect(m.ball.owner).not.toBe(6);
    expect(Math.abs(p.pos.y)).toBeGreaterThan(PITCH_HALF_WIDTH);
  });

  it('standing tackles from the front are usually clean and sometimes win the ball', () => {
    let won = 0;
    let fouls = 0;
    let lost = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const m = newMatch({ seed });
      freePlay(m);
      park(m, [11 + 9, 4]);
      const owner = m.players[20];
      const t = m.players[4];
      owner.pos = v2(0, 0);
      owner.facing = v2(-1, 0);
      t.pos = v2(-1.1, 0);
      t.facing = v2(1, 0);
      m.ball.owner = owner.idx;
      m.ball.pos = { x: -0.45, y: 0, z: 0 };
      m.startTackle(t);
      m.step();
      if (eventsOf(m, 'foul').length) fouls++;
      const tk = eventsOf(m, 'tackle')[0] as { won: boolean } | undefined;
      if (tk?.won) won++;
      else if (tk) lost++;
    }
    expect(won).toBeGreaterThan(5);
    expect(lost).toBeGreaterThan(5);
    expect(fouls).toBeLessThan(8);
  });
});

describe('goalkeepers', () => {
  it('save a good share of central shots from distance but not all', () => {
    let saves = 0;
    let goals = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const m = newMatch({ seed });
      park(m, [11]);
      m.keeper(1).pos = v2(PITCH_HALF_LENGTH - 1, 0);
      shootFrom(m, 30, 0, 0.3, 24, (seed % 5) - 2, 2, 0);
      runUntil(m, () => m.phase !== 'play' || eventsOf(m, 'save').length > 0, 3);
      if (eventsOf(m, 'save').length) saves++;
      if (m.score[0]) goals++;
    }
    expect(saves).toBeGreaterThan(10);
    expect(goals).toBeGreaterThan(0);
  });
});

describe('clock and halves', () => {
  it('runs 45 minutes plus added time each half and swaps ends at half time', () => {
    const m = newMatch({ seed: 21, half: 2 });
    let lastClock = 0;
    let ticks = 0;
    let sawHalftime = false;
    while (m.phase !== 'fulltime' && ticks < 60 * 60 * 10) {
      m.step();
      ticks++;
      expect(m.clock).toBeGreaterThanOrEqual(lastClock);
      lastClock = m.clock;
      if (m.phase === 'halftime' && !sawHalftime) {
        sawHalftime = true;
        expect(m.clock).toBeGreaterThanOrEqual(45 * 60 + 60);
        expect(m.clock).toBeLessThanOrEqual(45 * 60 + 5 * 60);
        run(m, 3.1);
        expect(m.half).toBe(2);
        expect(m.clock).toBe(45 * 60);
        expect(m.attackDir).toEqual([-1, 1]);
        expect(m.restart!.team).toBe(1 - m.firstKickoffTeam);
        lastClock = m.clock;
      }
    }
    expect(sawHalftime).toBe(true);
    expect(m.phase).toBe('fulltime');
    expect(m.clock).toBeGreaterThanOrEqual(90 * 60 + 60);
    expect(m.clock).toBeLessThanOrEqual(90 * 60 + 5 * 60);
    // A 2-minute half is ~2 real minutes of open play plus stoppages.
    expect(ticks / 60).toBeGreaterThan(4 * 60);
    expect(ticks / 60).toBeLessThan(6.5 * 60);
  });

  it('the clock does not run during goal celebrations or before the kick-off', () => {
    const m = newMatch({ seed: 4 });
    const c0 = m.clock;
    run(m, 0.5); // waiting for the kick-off
    expect(m.clock).toBe(c0);
    park(m);
    shootFrom(m, 49, 0, 0.5, 18, 0, 1, 0);
    runUntil(m, () => m.phase === 'goal', 1);
    const c1 = m.clock;
    run(m, 3);
    expect(m.phase).toBe('goal');
    expect(m.clock).toBe(c1);
  });
});

describe('penalty box geometry', () => {
  it('knows which area belongs to which team and flips at half time', () => {
    const m = newMatch();
    expect(m.inOwnPenaltyArea(0, v2(-PITCH_HALF_LENGTH + 5, 0))).toBe(true);
    expect(m.inOwnPenaltyArea(0, v2(-PITCH_HALF_LENGTH + PENALTY_AREA_DEPTH + 1, 0))).toBe(false);
    expect(m.inOwnPenaltyArea(1, v2(PITCH_HALF_LENGTH - 5, 0))).toBe(true);
    m.attackDir = [-1, 1];
    expect(m.inOwnPenaltyArea(0, v2(PITCH_HALF_LENGTH - 5, 0))).toBe(true);
  });
});
