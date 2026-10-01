import { describe, expect, it } from 'vitest';
import { newMatch } from './helpers';

/** CPU vs CPU matches should look like football, not pinball or a stalemate. */
describe('match balance (CPU vs CPU)', () => {
  it('produces believable numbers across several matches', () => {
    const seeds = [11, 12, 13, 14, 15, 16];
    let shots = 0;
    let goals = 0;
    let passes = 0;
    let done = 0;
    for (const seed of seeds) {
      const m = newMatch({ seed, half: 4 });
      let ticks = 0;
      while (m.phase !== 'fulltime' && ticks < 60 * 60 * 15) {
        m.step();
        ticks++;
      }
      expect(m.phase).toBe('fulltime');
      for (const s of m.stats) {
        shots += s.shots;
        goals += s.goals;
        passes += s.passes;
        done += s.passesCompleted;
        expect(s.possessionTicks).toBeGreaterThan(0);
      }
    }
    const n = seeds.length;
    expect(shots / n).toBeGreaterThan(5);
    expect(shots / n).toBeLessThan(40);
    expect(goals / n).toBeGreaterThan(0.8);
    expect(goals / n).toBeLessThan(9);
    expect(done / passes).toBeGreaterThan(0.55);
  });

  it('a much stronger side usually beats a much weaker one', () => {
    let strongGoals = 0;
    let weakGoals = 0;
    for (const seed of [21, 22, 23, 24]) {
      const m = newMatch({ seed, half: 4, ovr: [88, 62] });
      while (m.phase !== 'fulltime') m.step();
      strongGoals += m.score[0];
      weakGoals += m.score[1];
    }
    expect(strongGoals).toBeGreaterThan(weakGoals);
  });
});
