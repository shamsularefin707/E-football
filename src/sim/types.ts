import type { V2 } from './vec';

export type TeamId = 0 | 1;
export type Position =
  | 'GK'
  | 'CB'
  | 'LB'
  | 'RB'
  | 'LWB'
  | 'RWB'
  | 'CDM'
  | 'CM'
  | 'CAM'
  | 'LM'
  | 'RM'
  | 'LW'
  | 'RW'
  | 'CF'
  | 'ST';

/** Ratings on a 1..99 scale. */
export interface Attributes {
  pace: number;
  accel: number;
  shooting: number;
  passing: number;
  dribbling: number;
  defending: number;
  physical: number;
  stamina: number;
  gkDiving: number;
  gkReflexes: number;
  gkHandling: number;
  gkPositioning: number;
}

export interface PlayerInfo {
  id: string;
  name: string;
  shortName: string;
  position: Position;
  number: number;
  overall: number;
  attrs: Attributes;
  skin: number; // 0..1 tone index for the renderer
  hair: number;
}

export interface Kit {
  shirt: string;
  shorts: string;
  socks: string;
}

export interface TeamSetup {
  id: string;
  name: string;
  short: string;
  kit: Kit;
  gkKit: Kit;
  formation: string;
  /** Exactly 11 players, index 0 is the goalkeeper, others line up with formation slots. */
  lineup: PlayerInfo[];
  bench: PlayerInfo[];
}

export type Difficulty = 'amateur' | 'pro' | 'worldclass';

export interface ControllerConfig {
  id: number;
  team: TeamId;
}

export interface MatchConfig {
  home: TeamSetup;
  away: TeamSetup;
  halfLengthMinutes: number;
  difficulty: Difficulty;
  controllers: ControllerConfig[];
  seed: number;
}

export interface ControllerInput {
  moveX: number; // -1..1 screen right
  moveY: number; // -1..1 screen up (away from the camera)
  sprint: boolean;
  pass: boolean;
  shoot: boolean;
  through: boolean;
  lob: boolean;
  switchPlayer: boolean;
}

export const emptyInput = (): ControllerInput => ({
  moveX: 0,
  moveY: 0,
  sprint: false,
  pass: false,
  shoot: false,
  through: false,
  lob: false,
  switchPlayer: false,
});

export type PlayerAction = 'none' | 'tackle' | 'slide' | 'stumble' | 'dive' | 'kick' | 'celebrate' | 'throw';

export interface SimPlayer {
  idx: number; // 0..21, team = idx < 11 ? 0 : 1
  team: TeamId;
  slot: number; // 0..10 within team (0 = GK)
  info: PlayerInfo;
  pos: V2;
  vel: V2;
  facing: V2;
  stamina: number; // 0..1
  action: PlayerAction;
  actionTime: number; // seconds remaining
  actionResolved: boolean;
  kickCooldown: number;
  yellow: number;
  sentOff: boolean;
  controller: number | null;
  /** Where the AI wants this player to go this tick (debug + renderer). */
  target: V2;
  wantsSprint: boolean;
  diveDir: V2;
}

export interface BallState {
  pos: { x: number; y: number; z: number };
  vel: { x: number; y: number; z: number };
  spin: number;
  owner: number; // player idx or -1
  held: boolean; // in a goalkeeper's hands
  lastTouch: number;
  lastTouchTeam: TeamId;
}

export type Phase = 'kickoff' | 'play' | 'restart' | 'setpiece' | 'goal' | 'halftime' | 'fulltime';

export type RestartKind = 'kickoff' | 'throwin' | 'corner' | 'goalkick' | 'freekick' | 'penalty';

export interface Restart {
  kind: RestartKind;
  team: TeamId;
  spot: V2;
  taker: number;
  indirect: boolean;
}

export type MatchEvent =
  | { type: 'kick'; player: number; power: number; kind: KickKind }
  | { type: 'goal'; team: TeamId; scorer: number; ownGoal: boolean; minute: number }
  | { type: 'whistle'; long: boolean }
  | { type: 'foul'; by: number; on: number; spot: V2; penalty: boolean }
  | { type: 'card'; player: number; color: 'yellow' | 'red' }
  | { type: 'offside'; player: number }
  | { type: 'out'; kind: RestartKind; team: TeamId }
  | { type: 'save'; keeper: number; caught: boolean }
  | { type: 'woodwork' }
  | { type: 'tackle'; by: number; won: boolean }
  | { type: 'halftime' }
  | { type: 'fulltime' }
  | { type: 'kickoff'; team: TeamId };

export type KickKind = 'pass' | 'through' | 'lob' | 'shot' | 'clear' | 'throw' | 'header' | 'dribble';

export interface TeamStats {
  goals: number;
  shots: number;
  onTarget: number;
  passes: number;
  passesCompleted: number;
  fouls: number;
  yellow: number;
  red: number;
  corners: number;
  offsides: number;
  possessionTicks: number;
}

export const emptyStats = (): TeamStats => ({
  goals: 0,
  shots: 0,
  onTarget: 0,
  passes: 0,
  passesCompleted: 0,
  fouls: 0,
  yellow: 0,
  red: 0,
  corners: 0,
  offsides: 0,
  possessionTicks: 0,
});
