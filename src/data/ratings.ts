import type { Attributes, PlayerInfo, Position } from '../sim/types';

/** Deterministic hash of a string to 0..1, so every player gets stable "personality". */
export function hash01(s: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

type Profile = Partial<Record<keyof Attributes, number>>;

// Offsets from overall rating per position. Our own model, not copied from any game database.
const PROFILES: Record<string, Profile> = {
  GK: { pace: -30, accel: -28, shooting: -60, passing: -25, dribbling: -50, defending: -55, physical: -10, gkDiving: 1, gkReflexes: 2, gkHandling: -1, gkPositioning: 0 },
  CB: { pace: -10, accel: -12, shooting: -32, passing: -12, dribbling: -16, defending: 3, physical: 2 },
  FB: { pace: 3, accel: 3, shooting: -24, passing: -5, dribbling: -5, defending: -3, physical: -6 },
  CDM: { pace: -12, accel: -10, shooting: -16, passing: -2, dribbling: -8, defending: 1, physical: 0 },
  CM: { pace: -9, accel: -7, shooting: -8, passing: 2, dribbling: -2, defending: -13, physical: -8 },
  CAM: { pace: -6, accel: -3, shooting: -3, passing: 2, dribbling: 2, defending: -38, physical: -16 },
  WIDE: { pace: 5, accel: 6, shooting: -4, passing: -4, dribbling: 2, defending: -40, physical: -16 },
  ST: { pace: -2, accel: -2, shooting: 2, passing: -12, dribbling: -3, defending: -46, physical: -5 },
};

function profileFor(pos: Position): Profile {
  switch (pos) {
    case 'GK':
      return PROFILES.GK;
    case 'CB':
      return PROFILES.CB;
    case 'LB':
    case 'RB':
    case 'LWB':
    case 'RWB':
      return PROFILES.FB;
    case 'CDM':
      return PROFILES.CDM;
    case 'CM':
      return PROFILES.CM;
    case 'CAM':
      return PROFILES.CAM;
    case 'LM':
    case 'RM':
    case 'LW':
    case 'RW':
      return PROFILES.WIDE;
    default:
      return PROFILES.ST;
  }
}

const KEYS: (keyof Attributes)[] = [
  'pace',
  'accel',
  'shooting',
  'passing',
  'dribbling',
  'defending',
  'physical',
  'stamina',
  'gkDiving',
  'gkReflexes',
  'gkHandling',
  'gkPositioning',
];

export function deriveAttributes(name: string, pos: Position, overall: number): Attributes {
  const prof = profileFor(pos);
  const out = {} as Attributes;
  KEYS.forEach((k, i) => {
    const jitter = (hash01(name, i + 1) - 0.5) * 9;
    let base: number;
    if (k === 'stamina') base = 62 + (overall - 60) * 0.5 + jitter * 1.5;
    else if (k.startsWith('gk')) base = pos === 'GK' ? overall + (prof[k] ?? 0) + jitter * 0.6 : 25 + jitter;
    else base = overall + (prof[k] ?? -10) + jitter;
    out[k] = Math.round(Math.max(15, Math.min(99, base)));
  });
  return out;
}

export function shortName(full: string): string {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  // Keep particles with the surname (van Dijk, De Bruyne, dos Santos).
  const particles = new Set(['van', 'von', 'de', 'da', 'di', 'dos', 'das', 'del', 'der', 'den', 'le', 'la', 'ter', 'ten', 'el', 'al', 'bin']);
  let i = parts.length - 1;
  while (i > 0 && particles.has(parts[i - 1].toLowerCase())) i--;
  return parts.slice(i).join(' ');
}

export function makePlayer(id: string, name: string, pos: Position, overall: number, number: number): PlayerInfo {
  return {
    id,
    name,
    shortName: shortName(name),
    position: pos,
    number,
    overall,
    attrs: deriveAttributes(name, pos, overall),
    skin: hash01(name, 99),
    hair: hash01(name, 77),
  };
}
