import { ENGLAND } from './leagues/england';
import { FRANCE } from './leagues/france';
import { GERMANY } from './leagues/germany';
import { ITALY } from './leagues/italy';
import { SPAIN } from './leagues/spain';
import { WORLD } from './leagues/world';
import type { ClubData, LeagueData } from './lineup';
import { parseLeague } from './pack';

export const DATA_SEASON = '2025-26';

let cache: LeagueData[] | null = null;

/** The built-in data pack (real clubs). Edits made in the Team Editor are layered on top. */
export function builtinLeagues(): LeagueData[] {
  if (!cache) {
    cache = [
      parseLeague('eng', 'Premier League', 'England', ENGLAND),
      parseLeague('esp', 'LaLiga', 'Spain', SPAIN),
      parseLeague('ita', 'Serie A', 'Italy', ITALY),
      parseLeague('ger', 'Bundesliga', 'Germany', GERMANY),
      parseLeague('fra', 'Ligue 1', 'France', FRANCE),
      parseLeague('row', 'Rest of World', 'World', WORLD),
    ];
  }
  return cache;
}

export function allClubs(leagues: LeagueData[]): ClubData[] {
  return leagues.flatMap((l) => l.clubs);
}
