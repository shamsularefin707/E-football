/** Small seeded PRNG (mulberry32) so matches are reproducible in tests. */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0 || 1;
  }
  next(): number {
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }
  /** Roughly normal noise with the given standard deviation. */
  gauss(sd: number): number {
    return (this.next() + this.next() + this.next() - 1.5) * 2 * sd;
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
}
