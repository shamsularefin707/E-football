import { describe, expect, it } from 'vitest';
import { builtinLeagues } from '../../src/data/index';
import { pickLineup, teamStars } from '../../src/data/lineup';
import { FORMATIONS } from '../../src/sim/formations';
import { newMatch } from './helpers';
import { Match } from '../../src/sim/match';
import { buildTeamSetup } from '../../src/data/lineup';

describe('built-in data pack', () => {
  const leagues = builtinLeagues();
  const clubs = leagues.flatMap((l) => l.clubs);

  it('has the five big leagues with full divisions plus extra clubs', () => {
    const counts = Object.fromEntries(leagues.map((l) => [l.id, l.clubs.length]));
    expect(counts).toMatchObject({ eng: 20, esp: 20, ita: 20, ger: 18, fra: 18 });
    expect(counts.row).toBeGreaterThanOrEqual(10);
  });

  it('every club can field a legal XI in its formation with a keeper', () => {
    for (const c of clubs) {
      expect(FORMATIONS[c.formation], `${c.name} formation ${c.formation}`).toBeDefined();
      expect(c.players.length, `${c.name} squad size`).toBeGreaterThanOrEqual(14);
      expect(c.players.some((p) => p.position === 'GK'), `${c.name} has a keeper`).toBe(true);
      const { lineup } = pickLineup(c.players, c.formation);
      expect(lineup.length).toBe(11);
      expect(lineup[0].position).toBe('GK');
      expect(new Set(lineup.map((p) => p.id)).size).toBe(11);
      expect(teamStars(lineup)).toBeGreaterThan(0);
      for (const k of [c.home.shirt, c.away.shirt]) expect(k).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('no player appears at two clubs', () => {
    const seen = new Map<string, string>();
    const dups: string[] = [];
    for (const c of clubs)
      for (const p of c.players) {
        const prev = seen.get(p.name);
        if (prev && prev !== c.name) dups.push(`${p.name}: ${prev} / ${c.name}`);
        seen.set(p.name, c.name);
      }
    // Different people who share a name.
    const allowed = ['Luis Suarez', 'Danilo', 'Wesley', 'Nico Gonzalez', 'Vitinha', 'Ederson', 'Matheus Cunha', 'Pedro'];
    expect(dups.filter((d) => !allowed.some((a) => d.startsWith(a + ':')))).toEqual([]);
  });

  it('ratings are in a sensible range', () => {
    for (const c of clubs)
      for (const p of c.players) {
        expect(p.overall).toBeGreaterThanOrEqual(60);
        expect(p.overall).toBeLessThanOrEqual(95);
        for (const v of Object.values(p.attrs)) expect(v).toBeGreaterThanOrEqual(15);
      }
  });

  it('a real-club match runs to full time', () => {
    const eng = leagues[0].clubs;
    const m = new Match({
      home: buildTeamSetup(eng.find((c) => c.short === 'ARS')!),
      away: buildTeamSetup(eng.find((c) => c.short === 'LIV')!, { useAway: true }),
      halfLengthMinutes: 2,
      difficulty: 'worldclass',
      controllers: [],
      seed: 3,
    });
    while (m.phase !== 'fulltime') m.step();
    expect(m.phase).toBe('fulltime');
    void newMatch;
  });
});
