import { buildTeamSetup, type ClubData } from '../../src/data/lineup';
import { makePlayer } from '../../src/data/ratings';
import { Match } from '../../src/sim/match';
import type { ControllerConfig, Difficulty, Position, TeamSetup } from '../../src/sim/types';

const SQUAD: [Position, number][] = [
  ['GK', 0], ['LB', -2], ['CB', 0], ['CB', -1], ['RB', -2], ['CM', 0], ['CDM', -1], ['CM', -2],
  ['LW', 0], ['ST', 1], ['RW', -1], ['GK', -8], ['CB', -6], ['CM', -6], ['ST', -6], ['RB', -7],
];

export function testClub(id: string, ovr: number, shirt = '#c00000'): ClubData {
  return {
    id,
    name: `Test ${id}`,
    short: id.toUpperCase().slice(0, 3),
    league: 'test',
    home: { shirt, shorts: '#ffffff', socks: shirt },
    away: { shirt: '#ffffff', shorts: '#000000', socks: '#ffffff' },
    formation: '4-3-3',
    players: SQUAD.map(([pos, d], i) => makePlayer(`${id}-${i}`, `${id} Player ${i}`, pos, ovr + d, i + 1)),
  };
}

export function testTeams(ovrA = 80, ovrB = 80): [TeamSetup, TeamSetup] {
  return [buildTeamSetup(testClub('aaa', ovrA)), buildTeamSetup(testClub('bbb', ovrB, '#0040c0'))];
}

export function newMatch(opts: { controllers?: ControllerConfig[]; seed?: number; half?: number; difficulty?: Difficulty; ovr?: [number, number] } = {}): Match {
  const [home, away] = testTeams(opts.ovr?.[0] ?? 80, opts.ovr?.[1] ?? 80);
  return new Match({
    home,
    away,
    halfLengthMinutes: opts.half ?? 4,
    difficulty: opts.difficulty ?? 'pro',
    controllers: opts.controllers ?? [],
    seed: opts.seed ?? 1,
  });
}

export function run(m: Match, seconds: number, each?: () => void): void {
  const n = Math.round(seconds * 60);
  for (let i = 0; i < n; i++) {
    each?.();
    m.step();
  }
}

export function runUntil(m: Match, pred: () => boolean, maxSeconds = 60): boolean {
  const n = Math.round(maxSeconds * 60);
  for (let i = 0; i < n; i++) {
    if (pred()) return true;
    m.step();
  }
  return pred();
}

/** Put the match into open play with nobody on the ball. */
export function freePlay(m: Match): void {
  m.phase = 'play';
  m.phaseTime = 0;
  m.restart = null;
  m.nextRestart = null;
  m.ball.owner = -1;
  m.ball.held = false;
}
