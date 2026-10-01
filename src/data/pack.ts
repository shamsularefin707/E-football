import type { Kit, Position } from '../sim/types';
import type { ClubData, LeagueData } from './lineup';
import { makePlayer } from './ratings';

const POSITIONS = new Set<Position>(['GK', 'CB', 'LB', 'RB', 'LWB', 'RWB', 'CDM', 'CM', 'CAM', 'LM', 'RM', 'LW', 'RW', 'CF', 'ST']);

function kit(spec: string): Kit {
  const [shirt, shorts, socks] = spec.split(',').map((s) => s.trim());
  return { shirt, shorts: shorts ?? shirt, socks: socks ?? shirt };
}

/**
 * Parse a league written in the compact text format used by the data files:
 *
 *   # id | Club Name | SHT | home shirt,shorts,socks | away shirt,shorts,socks | formation
 *   GK Player Name 84; CB Other Player 80; ...
 *
 * Ratings are this project's own estimates and can be edited in the Team Editor.
 */
export function parseLeague(id: string, name: string, country: string, text: string): LeagueData {
  const clubs: ClubData[] = [];
  let cur: ClubData | null = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#')) {
      const [cid, cname, short, home, away, formation] = line
        .slice(1)
        .split('|')
        .map((s) => s.trim());
      cur = { id: `${id}-${cid}`, name: cname, short, league: id, home: kit(home), away: kit(away), formation: formation || '4-3-3', players: [] };
      clubs.push(cur);
      continue;
    }
    if (!cur) continue;
    for (const entry of line.split(';')) {
      const e = entry.trim();
      if (!e) continue;
      const m = /^([A-Z]{2,3})\s+(.+?)\s+(\d{2})$/.exec(e);
      if (!m || !POSITIONS.has(m[1] as Position)) throw new Error(`Bad player entry in ${cur.name}: "${e}"`);
      const n = cur.players.length + 1;
      cur.players.push(makePlayer(`${cur.id}-${n}`, m[2], m[1] as Position, Number(m[3]), n));
    }
  }
  return { id, name, country, clubs };
}
