import { builtinLeagues } from '../data';
import type { ClubData, LeagueData } from '../data/lineup';
import { makePlayer } from '../data/ratings';
import type { CameraMode, Quality } from '../render/renderer';
import type { Difficulty, Position } from '../sim/types';

export interface Settings {
  quality: 'auto' | Quality;
  sound: boolean;
  camera: CameraMode;
  showFps: boolean;
  halfLength: number;
  difficulty: Difficulty;
  timeOfDay: 'day' | 'night';
  radar: boolean;
}

const SETTINGS_KEY = 'efootball.settings.v1';
const EDITS_KEY = 'efootball.edits.v1';

export const DEFAULT_SETTINGS: Settings = {
  quality: 'auto',
  sound: true,
  camera: 'broadcast',
  showFps: false,
  halfLength: 4,
  difficulty: 'pro',
  timeOfDay: 'night',
  radar: true,
};

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable (private window): settings last for this visit only */
  }
}

export function loadSettings(): Settings {
  return { ...DEFAULT_SETTINGS, ...(readJson<Partial<Settings>>(SETTINGS_KEY) ?? {}) };
}

export function saveSettings(s: Settings): void {
  writeJson(SETTINGS_KEY, s);
}

/** Pick a render quality from the GPU and memory the browser reports. */
export function detectQuality(): Quality {
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  if (mem !== undefined && mem <= 4) return 'low';
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') ?? c.getContext('webgl');
    if (!gl) return 'low';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)).toLowerCase();
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    if (/swiftshader|llvmpipe|software|basic render/.test(name)) return 'low';
    if (/intel|iris|uhd|hd graphics|radeon\(tm\) graphics|radeon graphics|mali|adreno|powervr|apple gpu/.test(name)) return 'medium';
    return 'high';
  } catch {
    return 'medium';
  }
}

export function resolveQuality(s: Settings): Quality {
  return s.quality === 'auto' ? detectQuality() : s.quality;
}

// ------------------------------------------------------------- team editor

export interface PlayerEdit {
  name: string;
  pos: Position;
  ovr: number;
}

export interface ClubEdit {
  name?: string;
  short?: string;
  players?: PlayerEdit[];
}

export type Edits = Record<string, ClubEdit>;

export function loadEdits(): Edits {
  return readJson<Edits>(EDITS_KEY) ?? {};
}

export function saveEdits(e: Edits): void {
  writeJson(EDITS_KEY, e);
}

/** Built-in data with the user's Team Editor changes applied. */
export function leaguesWithEdits(edits: Edits = loadEdits()): LeagueData[] {
  return builtinLeagues().map((l) => ({ ...l, clubs: l.clubs.map((c) => applyEdit(c, edits[c.id])) }));
}

export function applyEdit(c: ClubData, e: ClubEdit | undefined): ClubData {
  if (!e) return c;
  const players = e.players
    ? e.players.map((p, i) => makePlayer(`${c.id}-e${i + 1}`, p.name, p.pos, clampOvr(p.ovr), i + 1))
    : c.players;
  return { ...c, name: e.name || c.name, short: (e.short || c.short).toUpperCase().slice(0, 4), players };
}

export function clubToEdit(c: ClubData): ClubEdit {
  return { name: c.name, short: c.short, players: c.players.map((p) => ({ name: p.name, pos: p.position, ovr: p.overall })) };
}

export function clampOvr(n: number): number {
  return Math.max(40, Math.min(99, Math.round(Number.isFinite(n) ? n : 70)));
}
