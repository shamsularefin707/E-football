import type { Position } from './types';

/**
 * Formation slot in a normalised frame for a team attacking towards +x:
 * depth -1 = back line, +1 = front line; side +1 = left touchline, -1 = right.
 * Slot 0 is always the goalkeeper.
 */
export interface Slot {
  depth: number;
  side: number;
  role: Position;
}

const gk: Slot = { depth: -1.6, side: 0, role: 'GK' };

export const FORMATIONS: Record<string, Slot[]> = {
  '4-3-3': [
    gk,
    { depth: -1, side: 0.75, role: 'LB' },
    { depth: -1, side: 0.25, role: 'CB' },
    { depth: -1, side: -0.25, role: 'CB' },
    { depth: -1, side: -0.75, role: 'RB' },
    { depth: -0.1, side: 0.45, role: 'CM' },
    { depth: -0.35, side: 0, role: 'CDM' },
    { depth: -0.1, side: -0.45, role: 'CM' },
    { depth: 0.85, side: 0.7, role: 'LW' },
    { depth: 1, side: 0, role: 'ST' },
    { depth: 0.85, side: -0.7, role: 'RW' },
  ],
  '4-2-3-1': [
    gk,
    { depth: -1, side: 0.75, role: 'LB' },
    { depth: -1, side: 0.25, role: 'CB' },
    { depth: -1, side: -0.25, role: 'CB' },
    { depth: -1, side: -0.75, role: 'RB' },
    { depth: -0.35, side: 0.25, role: 'CDM' },
    { depth: -0.35, side: -0.25, role: 'CDM' },
    { depth: 0.45, side: 0.7, role: 'LM' },
    { depth: 0.45, side: 0, role: 'CAM' },
    { depth: 0.45, side: -0.7, role: 'RM' },
    { depth: 1, side: 0, role: 'ST' },
  ],
  '4-4-2': [
    gk,
    { depth: -1, side: 0.75, role: 'LB' },
    { depth: -1, side: 0.25, role: 'CB' },
    { depth: -1, side: -0.25, role: 'CB' },
    { depth: -1, side: -0.75, role: 'RB' },
    { depth: -0.1, side: 0.75, role: 'LM' },
    { depth: -0.15, side: 0.25, role: 'CM' },
    { depth: -0.15, side: -0.25, role: 'CM' },
    { depth: -0.1, side: -0.75, role: 'RM' },
    { depth: 1, side: 0.22, role: 'ST' },
    { depth: 1, side: -0.22, role: 'ST' },
  ],
  '3-5-2': [
    gk,
    { depth: -1, side: 0.45, role: 'CB' },
    { depth: -1, side: 0, role: 'CB' },
    { depth: -1, side: -0.45, role: 'CB' },
    { depth: -0.05, side: 0.85, role: 'LWB' },
    { depth: -0.3, side: 0.25, role: 'CM' },
    { depth: -0.4, side: 0, role: 'CDM' },
    { depth: -0.3, side: -0.25, role: 'CM' },
    { depth: -0.05, side: -0.85, role: 'RWB' },
    { depth: 1, side: 0.22, role: 'ST' },
    { depth: 1, side: -0.22, role: 'ST' },
  ],
  '3-4-3': [
    gk,
    { depth: -1, side: 0.45, role: 'CB' },
    { depth: -1, side: 0, role: 'CB' },
    { depth: -1, side: -0.45, role: 'CB' },
    { depth: -0.15, side: 0.8, role: 'LM' },
    { depth: -0.25, side: 0.22, role: 'CM' },
    { depth: -0.25, side: -0.22, role: 'CM' },
    { depth: -0.15, side: -0.8, role: 'RM' },
    { depth: 0.85, side: 0.65, role: 'LW' },
    { depth: 1, side: 0, role: 'ST' },
    { depth: 0.85, side: -0.65, role: 'RW' },
  ],
  '4-1-2-1-2': [
    gk,
    { depth: -1, side: 0.75, role: 'LB' },
    { depth: -1, side: 0.25, role: 'CB' },
    { depth: -1, side: -0.25, role: 'CB' },
    { depth: -1, side: -0.75, role: 'RB' },
    { depth: -0.4, side: 0, role: 'CDM' },
    { depth: -0.05, side: 0.45, role: 'CM' },
    { depth: -0.05, side: -0.45, role: 'CM' },
    { depth: 0.45, side: 0, role: 'CAM' },
    { depth: 1, side: 0.22, role: 'ST' },
    { depth: 1, side: -0.22, role: 'ST' },
  ],
  '4-1-4-1': [
    gk,
    { depth: -1, side: 0.75, role: 'LB' },
    { depth: -1, side: 0.25, role: 'CB' },
    { depth: -1, side: -0.25, role: 'CB' },
    { depth: -1, side: -0.75, role: 'RB' },
    { depth: -0.45, side: 0, role: 'CDM' },
    { depth: 0.2, side: 0.75, role: 'LM' },
    { depth: 0.05, side: 0.25, role: 'CM' },
    { depth: 0.05, side: -0.25, role: 'CM' },
    { depth: 0.2, side: -0.75, role: 'RM' },
    { depth: 1, side: 0, role: 'ST' },
  ],
  '3-4-2-1': [
    gk,
    { depth: -1, side: 0.45, role: 'CB' },
    { depth: -1, side: 0, role: 'CB' },
    { depth: -1, side: -0.45, role: 'CB' },
    { depth: -0.1, side: 0.85, role: 'LWB' },
    { depth: -0.3, side: 0.22, role: 'CM' },
    { depth: -0.3, side: -0.22, role: 'CM' },
    { depth: -0.1, side: -0.85, role: 'RWB' },
    { depth: 0.6, side: 0.35, role: 'CAM' },
    { depth: 0.6, side: -0.35, role: 'CAM' },
    { depth: 1, side: 0, role: 'ST' },
  ],
  '4-3-1-2': [
    gk,
    { depth: -1, side: 0.75, role: 'LB' },
    { depth: -1, side: 0.25, role: 'CB' },
    { depth: -1, side: -0.25, role: 'CB' },
    { depth: -1, side: -0.75, role: 'RB' },
    { depth: -0.25, side: 0.45, role: 'CM' },
    { depth: -0.35, side: 0, role: 'CDM' },
    { depth: -0.25, side: -0.45, role: 'CM' },
    { depth: 0.45, side: 0, role: 'CAM' },
    { depth: 1, side: 0.22, role: 'ST' },
    { depth: 1, side: -0.22, role: 'ST' },
  ],
  '5-3-2': [
    gk,
    { depth: -0.85, side: 0.85, role: 'LWB' },
    { depth: -1, side: 0.4, role: 'CB' },
    { depth: -1, side: 0, role: 'CB' },
    { depth: -1, side: -0.4, role: 'CB' },
    { depth: -0.85, side: -0.85, role: 'RWB' },
    { depth: -0.2, side: 0.4, role: 'CM' },
    { depth: -0.3, side: 0, role: 'CDM' },
    { depth: -0.2, side: -0.4, role: 'CM' },
    { depth: 1, side: 0.22, role: 'ST' },
    { depth: 1, side: -0.22, role: 'ST' },
  ],
};

export const FORMATION_NAMES = Object.keys(FORMATIONS);

export function getFormation(name: string): Slot[] {
  return FORMATIONS[name] ?? FORMATIONS['4-3-3'];
}

/** How well a player with `pos` fits a slot needing `role`, 0..1. */
export function roleFit(pos: Position, role: Position): number {
  if (pos === role) return 1;
  if (pos === 'GK' || role === 'GK') return 0;
  const groups: Position[][] = [
    ['CB'],
    ['LB', 'LWB', 'LM'],
    ['RB', 'RWB', 'RM'],
    ['CDM', 'CM'],
    ['CM', 'CAM'],
    ['LM', 'LW'],
    ['RM', 'RW'],
    ['ST', 'CF', 'CAM'],
    ['LW', 'RW', 'ST', 'CF'],
    ['LB', 'RB', 'CB'],
  ];
  for (const g of groups) if (g.includes(pos) && g.includes(role)) return 0.85;
  const def: Position[] = ['CB', 'LB', 'RB', 'LWB', 'RWB'];
  const mid: Position[] = ['CDM', 'CM', 'CAM', 'LM', 'RM'];
  const att: Position[] = ['LW', 'RW', 'CF', 'ST'];
  const line = (p: Position) => (def.includes(p) ? 0 : mid.includes(p) ? 1 : att.includes(p) ? 2 : -1);
  const d = Math.abs(line(pos) - line(role));
  return d === 0 ? 0.75 : d === 1 ? 0.55 : 0.3;
}
