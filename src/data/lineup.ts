import { getFormation, roleFit } from '../sim/formations';
import type { Kit, PlayerInfo, TeamSetup } from '../sim/types';

export interface ClubData {
  id: string;
  name: string;
  short: string;
  league: string;
  home: Kit;
  away: Kit;
  formation: string;
  players: PlayerInfo[];
}

export interface LeagueData {
  id: string;
  name: string;
  country: string;
  clubs: ClubData[];
}

/** Choose the best XI for a formation: greedy over (slot, player) pairs by fit-weighted rating. */
export function pickLineup(players: PlayerInfo[], formation: string): { lineup: PlayerInfo[]; bench: PlayerInfo[] } {
  const slots = getFormation(formation);
  const pairs: { s: number; p: number; score: number }[] = [];
  slots.forEach((slot, s) =>
    players.forEach((pl, p) => {
      const fit = roleFit(pl.position, slot.role);
      if (fit > 0) pairs.push({ s, p, score: pl.overall * fit + fit * 5 });
    }),
  );
  pairs.sort((a, b) => b.score - a.score);
  const lineup: (PlayerInfo | null)[] = slots.map(() => null);
  const used = new Set<number>();
  for (const pr of pairs) {
    if (lineup[pr.s] || used.has(pr.p)) continue;
    lineup[pr.s] = players[pr.p];
    used.add(pr.p);
  }
  // Squads without a natural fit for some slot (or without a keeper) still field 11.
  for (let s = 0; s < lineup.length; s++) {
    if (lineup[s]) continue;
    const idx = players.findIndex((_, i) => !used.has(i));
    if (idx >= 0) {
      lineup[s] = players[idx];
      used.add(idx);
    }
  }
  const bench = players.filter((_, i) => !used.has(i));
  return { lineup: lineup.filter((x): x is PlayerInfo => !!x), bench };
}

export function teamRating(lineup: PlayerInfo[]): number {
  if (lineup.length === 0) return 0;
  return Math.round(lineup.reduce((s, p) => s + p.overall, 0) / lineup.length);
}

/** Stars out of 5 in half steps, like the kick-off screen. */
export function teamStars(lineup: PlayerInfo[]): number {
  const r = teamRating(lineup);
  return Math.max(0.5, Math.min(5, Math.round(((r - 60) / 25) * 10) / 2));
}

function hexToRgb(h: string): [number, number, number] {
  const n = parseInt(h.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function kitDistance(a: Kit, b: Kit): number {
  const [r1, g1, b1] = hexToRgb(a.shirt);
  const [r2, g2, b2] = hexToRgb(b.shirt);
  return Math.hypot(r1 - r2, g1 - g2, b1 - b2);
}

const GK_KITS: Kit[] = [
  { shirt: '#1fbf4a', shorts: '#14301c', socks: '#1fbf4a' },
  { shirt: '#f2c400', shorts: '#222222', socks: '#f2c400' },
  { shirt: '#7a3cff', shorts: '#2a1060', socks: '#7a3cff' },
  { shirt: '#ff6a00', shorts: '#222222', socks: '#ff6a00' },
];

export function buildTeamSetup(club: ClubData, opts: { useAway?: boolean; formation?: string; lineup?: PlayerInfo[] } = {}): TeamSetup {
  const formation = opts.formation ?? club.formation;
  const picked = opts.lineup && opts.lineup.length === 11 ? { lineup: opts.lineup, bench: club.players.filter((p) => !opts.lineup!.includes(p)) } : pickLineup(club.players, formation);
  return {
    id: club.id,
    name: club.name,
    short: club.short,
    kit: opts.useAway ? club.away : club.home,
    gkKit: GK_KITS[0],
    formation,
    lineup: picked.lineup,
    bench: picked.bench,
  };
}

/** Make sure the two teams (and keepers) wear clearly different colours. */
export function resolveKitClash(home: TeamSetup, awayClub: ClubData, away: TeamSetup): TeamSetup {
  let out = away;
  if (kitDistance(home.kit, away.kit) < 120) out = { ...away, kit: awayClub.away };
  if (kitDistance(home.kit, out.kit) < 120) out = { ...out, kit: { shirt: '#f5f5f5', shorts: '#202020', socks: '#f5f5f5' } };
  const gkFree = GK_KITS.filter((k) => kitDistance(k, home.kit) > 120 && kitDistance(k, out.kit) > 120);
  const homeGk = gkFree[0] ?? GK_KITS[0];
  const awayGk = gkFree[1] ?? GK_KITS[1];
  home.gkKit = homeGk;
  return { ...out, gkKit: awayGk };
}
