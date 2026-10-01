import { containInNet, stepBall } from './ball';
import {
  BALL_RADIUS,
  CENTRE_CIRCLE_RADIUS,
  CONTROL_MAX_HEIGHT,
  CONTROL_RADIUS,
  DT,
  GK_HOLD_TIME,
  GOAL_AREA_DEPTH,
  GOAL_CELEBRATION_TIME,
  GOAL_HALF_WIDTH,
  GOAL_HEIGHT,
  HALF_TIME_PAUSE,
  HEADER_MAX_HEIGHT,
  KICK_COOLDOWN,
  PENALTY_AREA_DEPTH,
  PENALTY_AREA_HALF_WIDTH,
  PENALTY_SPOT_DIST,
  PITCH_HALF_LENGTH,
  PITCH_HALF_WIDTH,
  PLAYER_RADIUS,
  RESTART_DELAY,
  SET_PIECE_DISTANCE,
  STAMINA_RECOVER,
  STAMINA_SPRINT_DRAIN,
  TICK_RATE,
} from './constants';
import { getFormation, type Slot } from './formations';
import { groundSpeedFor, loftFor, rollTime, shotVz } from './kick';
import { Rng } from './rng';
import {
  emptyInput,
  emptyStats,
  type BallState,
  type ControllerInput,
  type KickKind,
  type MatchConfig,
  type MatchEvent,
  type PlayerInfo,
  type Phase,
  type Restart,
  type RestartKind,
  type SimPlayer,
  type TeamId,
  type TeamStats,
} from './types';
import { angleBetween, clamp, dist, len, norm, sub, v2, type V2 } from './vec';
import { aiUpdate, aiTakeRestart, shapeTarget } from './ai/brain';
import { keeperSaveCheck } from './ai/keeper';

export interface ControllerRT {
  id: number;
  team: TeamId;
  player: number;
  input: ControllerInput;
  prev: ControllerInput;
  charge: { kind: KickKind; t: number } | null;
  queued: { kind: KickKind; power: number; dir: V2; ttl: number } | null;
  farTimer: number;
  contain: boolean;
  idleTime: number;
}

export interface KickOptions {
  power: number;
  dir?: V2; // desired direction (stick); falls back to facing
  receiver?: number; // AI may name a receiver directly
  target?: V2; // AI may name a target point directly
  restart?: RestartKind;
}

const KICK_BUTTONS: { key: 'pass' | 'shoot' | 'through' | 'lob'; kind: KickKind }[] = [
  { key: 'pass', kind: 'pass' },
  { key: 'shoot', kind: 'shot' },
  { key: 'through', kind: 'through' },
  { key: 'lob', kind: 'lob' },
];

export class Match {
  readonly cfg: MatchConfig;
  readonly rng: Rng;
  readonly players: SimPlayer[] = [];
  readonly ball: BallState;
  readonly formations: [Slot[], Slot[]];
  readonly stats: [TeamStats, TeamStats] = [emptyStats(), emptyStats()];
  readonly controllers: ControllerRT[] = [];
  readonly score: [number, number] = [0, 0];

  phase: Phase = 'kickoff';
  phaseTime = 0;
  restart: Restart | null = null;
  half: 1 | 2 = 1;
  /** Game clock in seconds (0..5400 plus added time). */
  clock = 0;
  addedMinutes = 0;
  stoppages = 0;
  tick = 0;
  events: MatchEvent[] = [];
  /** Every event since kick-off, for tests and the post-match screen. */
  log: { tick: number; clock: number; e: MatchEvent }[] = [];

  /** Team 0 attacks +x in the first half. */
  attackDir: [number, number] = [1, -1];
  firstKickoffTeam: TeamId = 0;
  kickId = 0;
  lastKick: { id: number; kind: KickKind; team: TeamId; kicker: number; restart?: RestartKind } | null = null;
  offsideSet = new Set<number>();
  pendingPass: { team: TeamId; kicker: number; receiver: number } | null = null;
  indirectKicker = -1;
  gkHold = 0;
  nextRestart: Restart | null = null;
  kickoffTeamAfterGoal: TeamId = 0;
  /** Per-player AI decision timers and memory, owned by the AI module. */
  aiMem: { nextDecision: number; holdSince: number; runUntil: number }[] = [];
  /** Predicted free-ball positions at 0.1s steps, refreshed each tick. */
  ballPrediction: { x: number; y: number; z: number }[] = [];
  readonly gameSecondsPerTick: number;

  constructor(cfg: MatchConfig) {
    this.cfg = cfg;
    this.rng = new Rng(cfg.seed);
    this.formations = [getFormation(cfg.home.formation), getFormation(cfg.away.formation)];
    this.gameSecondsPerTick = (45 * 60) / (cfg.halfLengthMinutes * 60 * TICK_RATE);
    const teams = [cfg.home, cfg.away];
    for (let t = 0; t < 2; t++) {
      for (let s = 0; s < 11; s++) {
        const info = teams[t].lineup[s];
        this.players.push({
          idx: t * 11 + s,
          team: t as TeamId,
          slot: s,
          info,
          pos: v2(),
          vel: v2(),
          facing: v2(t === 0 ? 1 : -1, 0),
          stamina: 1,
          action: 'none',
          actionTime: 0,
          actionResolved: false,
          kickCooldown: 0,
          yellow: 0,
          sentOff: false,
          controller: null,
          target: v2(),
          wantsSprint: false,
          diveDir: v2(),
        });
        this.aiMem.push({ nextDecision: 0, holdSince: 0, runUntil: 0 });
      }
    }
    this.ball = {
      pos: { x: 0, y: 0, z: 0 },
      vel: { x: 0, y: 0, z: 0 },
      spin: 0,
      owner: -1,
      held: false,
      lastTouch: -1,
      lastTouchTeam: 0,
    };
    for (const c of cfg.controllers) {
      this.controllers.push({
        id: c.id,
        team: c.team,
        player: -1,
        input: emptyInput(),
        prev: emptyInput(),
        charge: null,
        queued: null,
        farTimer: 0,
        contain: false,
        idleTime: 0,
      });
    }
    this.firstKickoffTeam = this.rng.chance(0.5) ? 0 : 1;
    this.beginRestart({ kind: 'kickoff', team: this.firstKickoffTeam, spot: v2(0, 0), taker: -1, indirect: false });
    this.setupRestart();
  }

  // ---------------------------------------------------------------- helpers

  dir(team: TeamId): number {
    return this.attackDir[team];
  }
  ownGoalX(team: TeamId): number {
    return -this.dir(team) * PITCH_HALF_LENGTH;
  }
  oppGoalX(team: TeamId): number {
    return this.dir(team) * PITCH_HALF_LENGTH;
  }
  teamPlayers(team: TeamId): SimPlayer[] {
    return this.players.filter((p) => p.team === team && !p.sentOff);
  }
  keeper(team: TeamId): SimPlayer {
    return this.players[team * 11];
  }
  isHuman(p: SimPlayer): boolean {
    return p.controller !== null;
  }
  teamHasHuman(team: TeamId): boolean {
    return this.controllers.some((c) => c.team === team);
  }
  minute(): number {
    return Math.floor(this.clock / 60) + 1;
  }
  /** True if point (x,y) lies in the penalty area that `team` defends. */
  inOwnPenaltyArea(team: TeamId, p: V2): boolean {
    const gx = this.ownGoalX(team);
    return Math.abs(p.x - gx) <= PENALTY_AREA_DEPTH && Math.abs(p.y) <= PENALTY_AREA_HALF_WIDTH && Math.abs(p.x) <= PITCH_HALF_LENGTH;
  }
  ballOwner(): SimPlayer | null {
    return this.ball.owner >= 0 ? this.players[this.ball.owner] : null;
  }
  possessionTeam(): TeamId | null {
    const o = this.ballOwner();
    return o ? o.team : null;
  }
  jogSpeed(p: SimPlayer): number {
    return 4.6 + p.info.attrs.pace * 0.02;
  }
  sprintSpeed(p: SimPlayer): number {
    return 6.0 + p.info.attrs.pace * 0.037;
  }
  private emit(e: MatchEvent): void {
    this.events.push(e);
    this.log.push({ tick: this.tick, clock: this.clock, e });
  }

  setInput(controllerId: number, input: ControllerInput): void {
    const c = this.controllers.find((k) => k.id === controllerId);
    if (c) c.input = { ...input };
  }

  /** Power (0..1) a controller is currently charging, for the HUD power bar. */
  chargePower(c: ControllerRT): number {
    return c.charge ? Math.min(1, c.charge.t / 0.9) : 0;
  }

  // ------------------------------------------------------------------- step

  step(): void {
    this.events = [];
    this.tick++;
    this.phaseTime += DT;
    switch (this.phase) {
      case 'fulltime':
        this.movePlayers();
        return;
      case 'halftime':
        if (this.phaseTime >= HALF_TIME_PAUSE) this.startSecondHalf();
        return;
      case 'goal':
        stepBall(this.ball, DT);
        containInNet(this.ball);
        aiUpdate(this);
        this.movePlayers();
        if (this.phaseTime >= GOAL_CELEBRATION_TIME) {
          this.beginRestart({ kind: 'kickoff', team: this.kickoffTeamAfterGoal, spot: v2(0, 0), taker: -1, indirect: false });
          this.setupRestart();
        }
        return;
      case 'restart':
        this.runClock();
        if (this.ball.owner < 0) {
          stepBall(this.ball, DT);
          this.boards();
        }
        aiUpdate(this);
        this.movePlayers();
        if (this.phaseTime >= RESTART_DELAY) this.setupRestart();
        return;
      case 'kickoff':
      case 'setpiece':
        if (this.phase === 'setpiece') this.runClock();
        if (this.phase !== 'setpiece' && this.phase !== 'kickoff') return; // half ended
        this.stepSetPiece();
        return;
      case 'play':
        this.stepPlay();
        return;
    }
  }

  private stepPlay(): void {
    this.updateBallPrediction();
    this.handleControllers();
    aiUpdate(this);
    this.movePlayers();
    this.updateActions();
    if (this.phase !== 'play') return;
    this.stepBallInPlay();
    if (this.phase !== 'play') return;
    this.checkBoundaries();
    if (this.phase !== 'play') return;
    const o = this.ballOwner();
    const team = o ? o.team : this.ball.lastTouchTeam;
    this.stats[team].possessionTicks++;
    this.runClock();
  }

  // -------------------------------------------------------------- the clock

  private runClock(): void {
    const before = this.clock;
    this.clock += this.gameSecondsPerTick;
    const halfStart = this.half === 1 ? 0 : 2700;
    const nominalEnd = halfStart + 2700;
    if (before < nominalEnd - 60 && this.clock >= nominalEnd - 60) {
      this.addedMinutes = clamp(1 + Math.floor(this.stoppages / 3), 1, 5);
    }
    const end = nominalEnd + this.addedMinutes * 60;
    if (this.clock >= end && this.addedMinutes > 0) {
      // A penalty that has been awarded is always taken before the whistle.
      if ((this.phase === 'setpiece' || this.phase === 'restart') && this.restart?.kind === 'penalty') return;
      if (this.phase === 'restart' && this.nextRestart?.kind === 'penalty') return;
      this.clock = end;
      this.endHalf();
    }
  }

  private endHalf(): void {
    this.emit({ type: 'whistle', long: true });
    this.ball.vel = { x: 0, y: 0, z: 0 };
    this.releaseCharges();
    if (this.half === 1) {
      this.phase = 'halftime';
      this.phaseTime = 0;
      this.emit({ type: 'halftime' });
    } else {
      this.phase = 'fulltime';
      this.phaseTime = 0;
      this.ball.owner = -1;
      this.emit({ type: 'fulltime' });
    }
  }

  private startSecondHalf(): void {
    this.half = 2;
    this.clock = 2700;
    this.addedMinutes = 0;
    this.stoppages = 0;
    this.attackDir = [-this.attackDir[0], -this.attackDir[1]];
    const team = (1 - this.firstKickoffTeam) as TeamId;
    this.beginRestart({ kind: 'kickoff', team, spot: v2(0, 0), taker: -1, indirect: false });
    this.setupRestart();
  }

  // ------------------------------------------------------------ controllers

  private handleControllers(): void {
    for (const c of this.controllers) {
      const p = this.players[c.player];
      if (!p || p.sentOff) {
        this.switchPlayer(c, true);
        continue;
      }
      const inp = c.input;
      const pressed = (k: keyof ControllerInput) => !!inp[k] && !c.prev[k];
      const released = (k: keyof ControllerInput) => !inp[k] && !!c.prev[k];
      const owner = this.ballOwner();
      const isOwner = owner === p && !this.ball.held;
      const defending = owner !== null && owner.team !== p.team;
      const anyInput =
        Math.abs(inp.moveX) > 0.1 || Math.abs(inp.moveY) > 0.1 || inp.pass || inp.shoot || inp.lob || inp.through || inp.sprint;
      c.idleTime = anyInput ? 0 : c.idleTime + DT;

      if (pressed('switchPlayer') && !isOwner) this.switchPlayer(c, false);

      c.contain = defending && inp.shoot;

      if (defending) {
        c.charge = null;
        if (pressed('pass')) this.startTackle(p);
        if (pressed('lob')) this.startSlide(p);
      } else {
        for (const b of KICK_BUTTONS) {
          if (pressed(b.key) && !c.charge) c.charge = { kind: b.kind, t: 0 };
        }
        if (c.charge) {
          const key = KICK_BUTTONS.find((b) => b.kind === c.charge!.kind)!.key;
          c.charge.t += DT;
          if (released(key) || c.charge.t > 1.6) {
            const power = this.chargePower(c);
            const dirv = this.stickDir(inp) ?? p.facing;
            if (isOwner) this.kick(p, c.charge.kind, { power, dir: dirv });
            else c.queued = { kind: c.charge.kind, power, dir: dirv, ttl: 0.8 };
            c.charge = null;
          }
        }
      }
      if (c.queued) {
        c.queued.ttl -= DT;
        if (c.queued.ttl <= 0) c.queued = null;
      }
      // Auto-switch when the controlled player is far from a ball the team doesn't have.
      const team = this.possessionTeam();
      if (team !== p.team && dist(p.pos, this.ball.pos) > 28) c.farTimer += DT;
      else c.farTimer = 0;
      if (c.farTimer > 1.5) {
        c.farTimer = 0;
        this.switchPlayer(c, false);
      }
      c.prev = { ...inp };
    }
  }

  private releaseCharges(): void {
    for (const c of this.controllers) {
      c.charge = null;
      c.queued = null;
    }
  }

  stickDir(inp: ControllerInput): V2 | null {
    const l = Math.hypot(inp.moveX, inp.moveY);
    return l > 0.2 ? { x: inp.moveX / l, y: inp.moveY / l } : null;
  }

  /** Give controller `c` control of player `p`, taking it from whoever had it. */
  assign(c: ControllerRT, p: SimPlayer): void {
    if (p.controller === c.id) {
      c.player = p.idx;
      return;
    }
    if (p.controller !== null) return; // a teammate already controls this player
    const old = this.players[c.player];
    if (old && old.controller === c.id) old.controller = null;
    p.controller = c.id;
    c.player = p.idx;
    c.charge = null;
  }

  /** Switch to the best free teammate near the ball. `force` allows switching from nobody. */
  switchPlayer(c: ControllerRT, force: boolean): void {
    const cur = this.players[c.player];
    const ref = this.ballPrediction[5] ?? this.ball.pos;
    const cands = this.teamPlayers(c.team)
      .filter((q) => q.slot !== 0 && (q.controller === null || q.controller === c.id))
      .sort((a, b) => dist(a.pos, ref) - dist(b.pos, ref));
    if (cands.length === 0) return;
    let pick = cands[0];
    if (!force && cur && pick === cur && cands.length > 1) pick = cands[1];
    if (cur && cur.controller === c.id && pick !== cur) cur.controller = null;
    this.assign(c, pick);
  }

  private controllerOf(p: SimPlayer): ControllerRT | null {
    return p.controller === null ? null : this.controllers.find((c) => c.id === p.controller) ?? null;
  }

  /** When a team wins the ball, a human on that team takes over the ball carrier. */
  private autoSwitchToCarrier(p: SimPlayer): void {
    if (p.controller !== null) return;
    const humans = this.controllers.filter((c) => c.team === p.team);
    if (humans.length === 0) return;
    let best = humans[0];
    let bd = Infinity;
    for (const c of humans) {
      const q = this.players[c.player];
      const d = q ? dist(q.pos, p.pos) : 0;
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    const old = this.players[best.player];
    if (old && old.controller === best.id) old.controller = null;
    p.controller = best.id;
    best.player = p.idx;
    best.charge = null;
  }

  // --------------------------------------------------------------- movement

  private movePlayers(): void {
    const owner = this.ballOwner();
    for (const p of this.players) {
      if (p.sentOff) continue;
      p.kickCooldown = Math.max(0, p.kickCooldown - DT);
      let desired: V2;
      let maxSpeed = this.jogSpeed(p);
      let sprinting = false;
      const c = this.controllerOf(p);
      const frozen = this.phase === 'kickoff' || this.phase === 'setpiece' || this.phase === 'halftime';
      if (c && !frozen && this.phase !== 'fulltime' && this.phase !== 'goal') {
        const l = Math.min(1, Math.hypot(c.input.moveX, c.input.moveY));
        sprinting = c.input.sprint && l > 0.1;
        if (sprinting) maxSpeed = this.sprintSpeed(p);
        desired = l > 0.1 ? { x: (c.input.moveX / Math.max(l, 1e-6)) * l * maxSpeed, y: (c.input.moveY / Math.max(l, 1e-6)) * l * maxSpeed } : v2();
        if (c.contain) desired = this.containVelocity(p, desired);
        // Receive assist: with the stick left alone, the intended receiver comes to meet the pass.
        if (l <= 0.1 && this.pendingPass && this.pendingPass.receiver === p.idx && this.ball.owner < 0) {
          const meet = this.ballPrediction[4] ?? this.ball.pos;
          const d = sub(v2(meet.x, meet.y), p.pos);
          const dl = len(d);
          const sp = Math.min(this.jogSpeed(p), dl * 2.5);
          desired = dl > 0.3 ? { x: (d.x / dl) * sp, y: (d.y / dl) * sp } : v2();
        }
      } else {
        sprinting = p.wantsSprint;
        if (sprinting) maxSpeed = this.sprintSpeed(p);
        const d = sub(p.target, p.pos);
        const dl = len(d);
        const sp = dl < 0.25 ? 0 : Math.min(maxSpeed, dl * 2.2);
        desired = dl > 1e-6 ? { x: (d.x / dl) * sp, y: (d.y / dl) * sp } : v2();
      }
      if (owner === p && !this.ball.held) {
        const f = 0.84 + p.info.attrs.dribbling * 0.0012;
        desired = { x: desired.x * f, y: desired.y * f };
      }
      // Stamina: sprinting drains, everything else recovers slowly.
      if (sprinting && len(p.vel) > 5) p.stamina = Math.max(0, p.stamina - STAMINA_SPRINT_DRAIN * DT * (1.4 - p.info.attrs.stamina / 100));
      else p.stamina = Math.min(1, p.stamina + STAMINA_RECOVER * DT);
      const tired = 0.86 + 0.14 * p.stamina;
      desired = { x: desired.x * tired, y: desired.y * tired };

      switch (p.action) {
        case 'slide':
          p.vel = { x: p.vel.x * (1 - 1.6 * DT), y: p.vel.y * (1 - 1.6 * DT) };
          break;
        case 'stumble':
        case 'celebrate':
          p.vel = { x: p.vel.x * (1 - 5 * DT), y: p.vel.y * (1 - 5 * DT) };
          break;
        case 'dive':
          break; // keeper dive velocity is scripted by the keeper module
        default: {
          const accel = 7 + p.info.attrs.accel * 0.05;
          const dv = sub(desired, p.vel);
          const dvl = len(dv);
          const maxDv = (p.action === 'tackle' ? accel * 0.5 : accel) * DT;
          p.vel = dvl > maxDv ? { x: p.vel.x + (dv.x / dvl) * maxDv, y: p.vel.y + (dv.y / dvl) * maxDv } : desired;
        }
      }
      if (frozen) p.vel = v2();
      p.pos = { x: p.pos.x + p.vel.x * DT, y: p.pos.y + p.vel.y * DT };
      p.pos.x = clamp(p.pos.x, -PITCH_HALF_LENGTH - 3, PITCH_HALF_LENGTH + 3);
      p.pos.y = clamp(p.pos.y, -PITCH_HALF_WIDTH - 3, PITCH_HALF_WIDTH + 3);

      // Facing follows movement; standing players face the ball.
      const sp = len(p.vel);
      let want: V2 | null = null;
      if (p.action === 'slide' || p.action === 'dive') want = null;
      else if (sp > 0.6) want = norm(p.vel);
      else if (!frozen || p.idx !== this.restart?.taker) want = norm(sub(this.ball.pos, p.pos));
      if (want && len(want) > 0) {
        const turnRate = (owner === p ? 7 : 10) * DT;
        const ang = Math.atan2(p.facing.y, p.facing.x);
        const target = Math.atan2(want.y, want.x);
        let diff = target - ang;
        while (diff > Math.PI) diff -= 2 * Math.PI;
        while (diff < -Math.PI) diff += 2 * Math.PI;
        const na = ang + clamp(diff, -turnRate, turnRate);
        p.facing = { x: Math.cos(na), y: Math.sin(na) };
      }
    }
    this.separatePlayers();
  }

  /** Jockeying: move to stay goal-side of the carrier, at a short distance. */
  private containVelocity(p: SimPlayer, fallback: V2): V2 {
    const o = this.ballOwner();
    if (!o) return fallback;
    const goal = v2(this.ownGoalX(p.team), 0);
    const spot = { x: o.pos.x + norm(sub(goal, o.pos)).x * 1.6, y: o.pos.y + norm(sub(goal, o.pos)).y * 1.6 };
    const d = sub(spot, p.pos);
    const l = len(d);
    const sp = Math.min(this.jogSpeed(p), l * 3);
    return l > 1e-6 ? { x: (d.x / l) * sp, y: (d.y / l) * sp } : v2();
  }

  private separatePlayers(): void {
    const min = PLAYER_RADIUS * 2;
    const ps = this.players;
    for (let i = 0; i < ps.length; i++) {
      const a = ps[i];
      if (a.sentOff) continue;
      for (let j = i + 1; j < ps.length; j++) {
        const b = ps[j];
        if (b.sentOff) continue;
        const dx = b.pos.x - a.pos.x;
        const dy = b.pos.y - a.pos.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= min * min || d2 < 1e-10) continue;
        const d = Math.sqrt(d2);
        const push = (min - d) / 2;
        const nx = dx / d;
        const ny = dy / d;
        // Stronger players get pushed less.
        const wa = b.info.attrs.physical / (a.info.attrs.physical + b.info.attrs.physical);
        a.pos.x -= nx * push * 2 * wa;
        a.pos.y -= ny * push * 2 * wa;
        b.pos.x += nx * push * 2 * (1 - wa);
        b.pos.y += ny * push * 2 * (1 - wa);
      }
    }
  }

  // ---------------------------------------------------- tackles and actions

  startTackle(p: SimPlayer): void {
    if (p.action !== 'none' || p.sentOff) return;
    p.action = 'tackle';
    p.actionTime = 0.35;
    p.actionResolved = false;
  }

  startSlide(p: SimPlayer): void {
    if (p.action !== 'none' || p.sentOff || p.slot === 0) return;
    p.action = 'slide';
    p.actionTime = 0.75;
    p.actionResolved = false;
    const sp = Math.max(7, len(p.vel) + 1.5);
    p.vel = { x: p.facing.x * sp, y: p.facing.y * sp };
  }

  private updateActions(): void {
    for (const p of this.players) {
      if (p.sentOff || p.action === 'none') continue;
      if (p.action === 'tackle' && !p.actionResolved) this.resolveTackle(p);
      if (p.action === 'slide' && !p.actionResolved) this.resolveSlide(p);
      if (this.phase !== 'play') return;
      p.actionTime -= DT;
      if (p.actionTime <= 0) {
        if (p.action === 'slide') {
          p.action = 'stumble';
          p.actionTime = 0.45;
        } else {
          p.action = 'none';
          p.actionTime = 0;
        }
      }
    }
  }

  private resolveTackle(p: SimPlayer): void {
    const o = this.ballOwner();
    if (!o || o.team === p.team || this.ball.held) return;
    const to = sub(o.pos, p.pos);
    if (len(to) > 1.5 || angleBetween(p.facing, to) > 1.25) return;
    p.actionResolved = true;
    const fromBehind = angleBetween(o.facing, sub(p.pos, o.pos)) > 2.2;
    const foulP = fromBehind ? 0.45 : 0.05;
    if (this.rng.chance(foulP)) {
      this.foul(p, o, false);
      return;
    }
    const a = p.info.attrs;
    const b = o.info.attrs;
    const win = clamp(0.5 + (a.defending - b.dribbling) / 110 + (a.physical - b.physical) / 400, 0.12, 0.88);
    if (this.rng.chance(win)) {
      this.ball.owner = -1;
      const f = norm(to);
      this.ball.vel = { x: f.x * 3 + this.rng.gauss(1.2), y: f.y * 3 + this.rng.gauss(1.2), z: 0 };
      this.touch(p);
      if (this.phase !== 'play') return;
      o.action = 'stumble';
      o.actionTime = 0.4;
      o.kickCooldown = 0.45;
      this.emit({ type: 'tackle', by: p.idx, won: true });
    } else {
      p.action = 'stumble';
      p.actionTime = 0.55;
      this.emit({ type: 'tackle', by: p.idx, won: false });
    }
  }

  private resolveSlide(p: SimPlayer): void {
    const foot = { x: p.pos.x + p.facing.x * 0.8, y: p.pos.y + p.facing.y * 0.8 };
    const b = this.ball;
    if (b.pos.z < 0.6 && dist(foot, b.pos) < 0.9 && !b.held) {
      p.actionResolved = true;
      const o = this.ballOwner();
      if (o && o !== p) {
        o.action = 'stumble';
        o.actionTime = 0.5;
        o.kickCooldown = 0.5;
      }
      b.owner = -1;
      b.vel = { x: p.facing.x * 8 + this.rng.gauss(2), y: p.facing.y * 8 + this.rng.gauss(2), z: 0.5 };
      this.touch(p);
      p.kickCooldown = 0.5;
      if (this.phase === 'play') this.emit({ type: 'tackle', by: p.idx, won: true });
      return;
    }
    for (const q of this.players) {
      if (q.team === p.team || q.sentOff) continue;
      const involved = b.owner === q.idx || dist(q.pos, b.pos) < 3;
      if (!involved) continue;
      if (dist(q.pos, foot) < 0.85 || dist(q.pos, p.pos) < 0.8) {
        p.actionResolved = true;
        this.foul(p, q, true);
        return;
      }
    }
  }

  private foul(by: SimPlayer, on: SimPlayer, slide: boolean): void {
    const fromBehind = angleBetween(on.facing, sub(by.pos, on.pos)) > 2.1;
    const spot = { x: on.pos.x, y: on.pos.y };
    const penalty = this.inOwnPenaltyArea(by.team, spot);
    this.stats[by.team].fouls++;
    this.stoppages++;
    on.action = 'stumble';
    on.actionTime = 0.8;
    this.emit({ type: 'foul', by: by.idx, on: on.idx, spot, penalty });
    let card: 'yellow' | 'red' | null = null;
    const r = this.rng.next();
    if (slide && fromBehind) card = r < 0.08 ? 'red' : r < 0.6 ? 'yellow' : null;
    else if (slide) card = r < 0.2 ? 'yellow' : null;
    else if (fromBehind) card = r < 0.12 ? 'yellow' : null;
    if (card) this.giveCard(by, card);
    const team = on.team;
    if (penalty) {
      const gx = this.ownGoalX(by.team);
      const s = Math.sign(gx);
      this.beginRestart({ kind: 'penalty', team, spot: v2(gx - s * PENALTY_SPOT_DIST, 0), taker: -1, indirect: false });
    } else {
      const fx = clamp(spot.x, -PITCH_HALF_LENGTH + 1, PITCH_HALF_LENGTH - 1);
      const fy = clamp(spot.y, -PITCH_HALF_WIDTH + 1, PITCH_HALF_WIDTH - 1);
      this.beginRestart({ kind: 'freekick', team, spot: v2(fx, fy), taker: -1, indirect: false });
    }
  }

  giveCard(p: SimPlayer, color: 'yellow' | 'red'): void {
    // Keepers are never sent off here: there is no substitute keeper flow yet.
    if (p.slot === 0) color = 'yellow';
    if (color === 'yellow') {
      p.yellow++;
      this.stats[p.team].yellow++;
      this.emit({ type: 'card', player: p.idx, color: 'yellow' });
      if (p.yellow >= 2 && p.slot !== 0) color = 'red';
      else return;
    }
    this.stats[p.team].red++;
    this.emit({ type: 'card', player: p.idx, color: 'red' });
    p.sentOff = true;
    p.pos = v2(0, -PITCH_HALF_WIDTH - 6);
    p.vel = v2();
    if (this.ball.owner === p.idx) this.ball.owner = -1;
    const c = this.controllerOf(p);
    p.controller = null;
    if (c) this.switchPlayer(c, true);
  }

  // ------------------------------------------------------------------ kicks

  /** Pick the teammate best matching direction `d` from player `p`. */
  pickReceiver(p: SimPlayer, d: V2, maxAngle = 0.75): SimPlayer | null {
    let best: SimPlayer | null = null;
    let bs = -Infinity;
    for (const q of this.teamPlayers(p.team)) {
      if (q === p) continue;
      const to = sub(q.pos, p.pos);
      const dl = len(to);
      if (dl < 2) continue;
      const ang = angleBetween(d, to);
      if (ang > maxAngle) continue;
      const s = Math.cos(ang) * 2.2 - dl / 45 - (q.slot === 0 ? 0.6 : 0);
      if (s > bs) {
        bs = s;
        best = q;
      }
    }
    return best;
  }

  private pressure(p: SimPlayer): number {
    let m = Infinity;
    for (const q of this.players) if (q.team !== p.team && !q.sentOff) m = Math.min(m, dist(q.pos, p.pos));
    return clamp(1 - (m - 1) / 4, 0, 1);
  }

  /**
   * Strike the ball. Works for the owner, for a keeper holding it, and for first-time / header
   * contacts on a free ball near the player.
   */
  kick(p: SimPlayer, kind: KickKind, opt: KickOptions): void {
    const b = this.ball;
    const a = p.info.attrs;
    const power = clamp(opt.power, 0, 1);
    const d0 = opt.dir && len(opt.dir) > 0.1 ? norm(opt.dir) : p.facing;
    const pressure = this.pressure(p);
    let vx = 0;
    let vy = 0;
    let vz = 0;
    let spin = 0;
    let receiver: SimPlayer | null = opt.receiver !== undefined ? this.players[opt.receiver] : null;
    const throwIn = kind === 'throw';
    const header = b.pos.z > CONTROL_MAX_HEIGHT && b.owner !== p.idx && !b.held;
    const start = { x: b.pos.x, y: b.pos.y };

    if (kind === 'shot') {
      const gx = this.oppGoalX(p.team);
      const gk = this.keeper((1 - p.team) as TeamId);
      // Stick across the goal picks the corner; otherwise aim away from the keeper.
      const across = this.dir(p.team) * d0.y;
      let aimY: number;
      if (opt.target) aimY = opt.target.y;
      else if (Math.abs(d0.y) > 0.3) aimY = Math.sign(d0.y) * (GOAL_HALF_WIDTH - 0.5) * Math.min(1, Math.abs(across) + 0.4);
      else if (Math.hypot(gk.pos.x - gx, gk.pos.y) > 4) aimY = 0; // keeper out of position: hit the middle
      else aimY = (gk.pos.y > 0 ? -1 : 1) * (GOAL_HALF_WIDTH - 0.9);
      const tgt = { x: gx, y: aimY };
      const dGoal = dist(start, tgt);
      const skill = a.shooting / 100;
      const angSd = 0.012 + (1 - skill) * 0.07 + pressure * 0.03 + dGoal / 1600 + (header ? 0.04 : 0);
      const ang = Math.atan2(tgt.y - start.y, tgt.x - start.x) + this.rng.gauss(angSd);
      const speed = header ? 12 + power * 6 : 15 + power * 13 + skill * 4;
      let zt = header ? 0.4 + power * 0.8 : 0.3 + power * 1.25;
      zt += this.rng.gauss(0.15 + Math.pow(power, 3) * 0.9 * (1.25 - skill));
      zt = Math.max(0, zt);
      vx = Math.cos(ang) * speed;
      vy = Math.sin(ang) * speed;
      vz = header ? (zt - b.pos.z) * 1.5 : shotVz(dGoal, speed, zt);
      spin = this.rng.gauss(0.4);
      this.stats[p.team].shots++;
    } else if (kind === 'clear') {
      const ang = Math.atan2(d0.y, d0.x) + this.rng.gauss(0.15);
      const l = loftFor(35 + power * 20, 2.4);
      vx = Math.cos(ang) * l.vh;
      vy = Math.sin(ang) * l.vh;
      vz = l.vz;
    } else {
      // Passing family: pass / through / lob / throw / header pass.
      if (!receiver && !opt.target) receiver = this.pickReceiver(p, d0, kind === 'lob' ? 0.9 : 0.75);
      let tgt: V2;
      if (opt.target) tgt = opt.target;
      else if (receiver) {
        const dr = dist(start, receiver.pos);
        if (kind === 'through') {
          const run = len(receiver.vel) > 1 ? norm(receiver.vel) : v2(this.dir(p.team), 0);
          const lead = 5 + power * 10;
          tgt = { x: receiver.pos.x + run.x * lead, y: receiver.pos.y + run.y * lead };
        } else {
          const tEst = kind === 'lob' ? 1 + dr / 25 : dr / 15;
          tgt = { x: receiver.pos.x + receiver.vel.x * tEst * 0.8, y: receiver.pos.y + receiver.vel.y * tEst * 0.8 };
        }
      } else {
        const reach = kind === 'lob' ? 15 + power * 30 : 8 + power * 25;
        tgt = { x: start.x + d0.x * reach, y: start.y + d0.y * reach };
      }
      tgt = { x: clamp(tgt.x, -PITCH_HALF_LENGTH + 1, PITCH_HALF_LENGTH - 1), y: clamp(tgt.y, -PITCH_HALF_WIDTH + 1, PITCH_HALF_WIDTH - 1) };
      const dl = Math.max(1, dist(start, tgt));
      const skill = a.passing / 100;
      const angSd = (0.008 + (1 - skill) * 0.05 + pressure * 0.015) * (1 + dl / 40) * (kind === 'lob' ? 1.4 : 1);
      const ang = Math.atan2(tgt.y - start.y, tgt.x - start.x) + this.rng.gauss(angSd);
      if (kind === 'lob') {
        const t = clamp(0.9 + dl / 22, 1.0, 2.8);
        const l = loftFor(dl * (1 + this.rng.gauss(0.04 + (1 - skill) * 0.06)), t);
        vx = Math.cos(ang) * l.vh;
        vy = Math.sin(ang) * l.vh;
        vz = l.vz;
        spin = -Math.sign(d0.y * this.dir(p.team)) * 0.3;
      } else if (throwIn) {
        const sp = clamp(dl * 0.9, 6, 15);
        vx = Math.cos(ang) * sp;
        vy = Math.sin(ang) * sp;
        vz = 2.5;
      } else if (header) {
        const sp = clamp(dl * 0.8, 6, 14);
        vx = Math.cos(ang) * sp;
        vy = Math.sin(ang) * sp;
        vz = -0.5; // headed down so it can be controlled
      } else {
        const vEnd = kind === 'through' ? 4 + power * 3 : 2.5 + power * 5;
        const sp = clamp(groundSpeedFor(dl, vEnd) * (1 + this.rng.gauss(0.03 + (1 - skill) * 0.05)), 5, 32);
        vx = Math.cos(ang) * sp;
        vy = Math.sin(ang) * sp;
        vz = 0;
      }
    }

    if (b.held || throwIn) b.pos.z = throwIn ? 1.8 : 1.0;
    else if (!header) b.pos.z = Math.max(0, b.pos.z);
    b.owner = -1;
    b.held = false;
    b.vel = { x: vx, y: vy, z: vz };
    b.spin = spin;
    b.lastTouch = p.idx;
    b.lastTouchTeam = p.team;
    p.kickCooldown = KICK_COOLDOWN;
    if (p.action === 'none' || p.action === 'tackle') {
      p.action = throwIn ? 'throw' : 'kick';
      p.actionTime = 0.3;
    }
    this.kickId++;
    const offsideApplies = kind !== 'shot' && kind !== 'clear' && opt.restart !== 'throwin' && opt.restart !== 'corner' && opt.restart !== 'goalkick';
    // Offside is judged at the moment the ball is played.
    this.offsideSet.clear();
    if (offsideApplies) for (const q of this.offsideCandidates(p)) this.offsideSet.add(q.idx);
    this.indirectKicker = opt.restart && this.restart?.indirect ? p.idx : -1;
    this.lastKick = { id: this.kickId, kind: header && kind !== 'shot' ? 'header' : kind, team: p.team, kicker: p.idx, restart: opt.restart };
    if ((kind === 'pass' || kind === 'through' || kind === 'lob' || kind === 'throw') && !header) {
      this.stats[p.team].passes++;
      this.pendingPass = { team: p.team, kicker: p.idx, receiver: receiver ? receiver.idx : -1 };
    } else this.pendingPass = null;
    this.emit({ type: 'kick', player: p.idx, power, kind: this.lastKick.kind });
    // A human passing hands control to the receiver, as in FIFA.
    const c = this.controllerOf(p);
    if (c && receiver && receiver.controller === null && kind !== 'shot' && kind !== 'clear') this.assign(c, receiver);
  }

  /** Attackers in an offside position relative to the ball played by `p`. */
  offsideCandidates(p: SimPlayer): SimPlayer[] {
    const dir = this.dir(p.team);
    const opp = this.teamPlayers((1 - p.team) as TeamId)
      .map((q) => q.pos.x * dir)
      .sort((x, y) => y - x);
    const secondLast = opp.length >= 2 ? opp[1] : -PITCH_HALF_LENGTH;
    const ballX = this.ball.pos.x * dir;
    const out: SimPlayer[] = [];
    for (const q of this.teamPlayers(p.team)) {
      if (q === p) continue;
      const x = q.pos.x * dir;
      if (x > 0 && x > ballX + 0.05 && x > secondLast + 0.05) out.push(q);
    }
    return out;
  }

  /**
   * Register a touch of the ball by `p`. Applies offside, pass completion, and indirect free kick
   * bookkeeping. Returns false if the touch stopped play (offside).
   */
  touch(p: SimPlayer): boolean {
    if (this.offsideSet.has(p.idx)) {
      this.offsideSet.clear();
      this.stats[p.team].offsides++;
      this.stoppages++;
      this.emit({ type: 'offside', player: p.idx });
      this.ball.owner = -1;
      this.beginRestart({
        kind: 'freekick',
        team: (1 - p.team) as TeamId,
        spot: v2(clamp(p.pos.x, -PITCH_HALF_LENGTH + 1, PITCH_HALF_LENGTH - 1), clamp(p.pos.y, -PITCH_HALF_WIDTH + 1, PITCH_HALF_WIDTH - 1)),
        taker: -1,
        indirect: true,
      });
      return false;
    }
    this.offsideSet.clear();
    if (this.pendingPass) {
      if (this.pendingPass.team === p.team && this.pendingPass.kicker !== p.idx) this.stats[p.team].passesCompleted++;
      if (this.pendingPass.kicker !== p.idx) this.pendingPass = null;
    }
    if (this.indirectKicker !== p.idx) this.indirectKicker = -1;
    this.ball.lastTouch = p.idx;
    this.ball.lastTouchTeam = p.team;
    return true;
  }

  private gainPossession(p: SimPlayer): void {
    if (!this.touch(p)) return;
    const b = this.ball;
    b.owner = p.idx;
    b.spin = 0;
    this.aiMem[p.idx].holdSince = this.tick;
    this.aiMem[p.idx].nextDecision = this.tick + Math.round(TICK_RATE * 0.25);
    // A keeper gathering the ball in their own area picks it up.
    if (p.slot === 0 && this.inOwnPenaltyArea(p.team, p.pos)) {
      b.held = true;
      this.gkHold = 0;
      b.vel = { x: 0, y: 0, z: 0 };
    }
    this.autoSwitchToCarrier(p);
    const c = this.controllerOf(p);
    if (c && c.queued && !b.held) {
      const q = c.queued;
      c.queued = null;
      this.kick(p, q.kind, { power: q.power, dir: q.dir });
    }
  }

  // ------------------------------------------------------------------- ball

  private updateBallPrediction(): void {
    const sim: BallState = {
      pos: { ...this.ball.pos },
      vel: { ...this.ball.vel },
      spin: this.ball.spin,
      owner: -1,
      held: false,
      lastTouch: -1,
      lastTouchTeam: 0,
    };
    const owner = this.ballOwner();
    this.ballPrediction.length = 0;
    for (let i = 0; i <= 20; i++) {
      if (owner) {
        this.ballPrediction.push({ x: owner.pos.x + owner.vel.x * i * 0.1, y: owner.pos.y + owner.vel.y * i * 0.1, z: 0 });
      } else {
        this.ballPrediction.push({ ...sim.pos });
        for (let k = 0; k < 6; k++) stepBall(sim, 0.1 / 6);
      }
    }
  }

  private stepBallInPlay(): void {
    const b = this.ball;
    const owner = this.ballOwner();
    if (owner) {
      if (b.held) {
        b.pos = { x: owner.pos.x + owner.facing.x * 0.35, y: owner.pos.y + owner.facing.y * 0.35, z: 1.0 };
        b.vel = { x: owner.vel.x, y: owner.vel.y, z: 0 };
        this.gkHold += DT;
        if (this.gkHold > GK_HOLD_TIME + 4) aiTakeRestart(this, owner, 'goalkick'); // never hold forever
        return;
      }
      if (owner.action === 'stumble' || owner.action === 'slide') {
        b.owner = -1;
      } else {
        const sp = len(owner.vel);
        const ahead = 0.45 + sp * 0.05;
        const tx = owner.pos.x + owner.facing.x * ahead;
        const ty = owner.pos.y + owner.facing.y * ahead;
        const k = Math.min(1, 16 * DT);
        b.pos.x += (tx - b.pos.x) * k + owner.vel.x * DT;
        b.pos.y += (ty - b.pos.y) * k + owner.vel.y * DT;
        b.pos.z = 0;
        b.vel = { x: owner.vel.x, y: owner.vel.y, z: 0 };
        return;
      }
    }
    const prev = { ...b.pos };
    if (stepBall(b, DT)) this.emit({ type: 'woodwork' });
    this.prevBallPos = prev;
    // Goalkeepers get a chance to save shots before outfield players touch the ball.
    for (const t of [0, 1] as TeamId[]) {
      const gk = this.keeper(t);
      if (keeperSaveCheck(this, gk)) {
        if (this.ball.held) this.gkHold = 0;
        return;
      }
    }
    this.tryControl();
  }

  prevBallPos = { x: 0, y: 0, z: 0 };

  /** Advertising boards around the pitch stop a dead ball rolling away. */
  private boards(): void {
    const b = this.ball;
    const bx = PITCH_HALF_LENGTH + 4;
    const by = PITCH_HALF_WIDTH + 4;
    if (Math.abs(b.pos.x) > bx && Math.abs(b.pos.y) > GOAL_HALF_WIDTH) {
      b.pos.x = Math.sign(b.pos.x) * bx;
      b.vel.x *= -0.2;
    }
    if (Math.abs(b.pos.x) > PITCH_HALF_LENGTH + 2.2) {
      // Behind the goal line inside the posts' width: the net or the boards stop it.
      b.pos.x = Math.sign(b.pos.x) * Math.min(Math.abs(b.pos.x), bx);
      if (Math.abs(b.pos.y) <= GOAL_HALF_WIDTH) {
        b.pos.x = Math.sign(b.pos.x) * (PITCH_HALF_LENGTH + 2.2);
        b.vel.x *= -0.1;
      }
    }
    if (Math.abs(b.pos.y) > by) {
      b.pos.y = Math.sign(b.pos.y) * by;
      b.vel.y *= -0.2;
    }
    if (b.pos.z > 12) {
      b.pos.z = 12;
      b.vel.z = Math.min(0, b.vel.z);
    }
  }

  /** Called by the keeper module when a save is made. */
  registerSave(gk: SimPlayer, caught: boolean): void {
    const shooterTeam = (1 - gk.team) as TeamId;
    if (this.lastKick && this.lastKick.kind === 'shot' && this.lastKick.team === shooterTeam) this.stats[shooterTeam].onTarget++;
    this.emit({ type: 'save', keeper: gk.idx, caught });
    if (caught) {
      this.gainPossession(gk);
    } else {
      this.touch(gk);
      gk.kickCooldown = 0.5;
    }
  }

  private tryControl(): void {
    const b = this.ball;
    if (b.owner >= 0) return;
    const hs = Math.hypot(b.vel.x, b.vel.y);
    let cands: SimPlayer[] = [];
    for (const p of this.players) {
      if (p.sentOff || p.kickCooldown > 0 || p.action === 'stumble' || p.action === 'slide' || p.action === 'dive') continue;
      const d = dist(p.pos, b.pos);
      const gkInBox = p.slot === 0 && this.inOwnPenaltyArea(p.team, p.pos);
      // Hard strikes at goal can only be stopped through the keeper's save check.
      if (p.slot === 0 && hs > 9 && b.vel.x * Math.sign(this.ownGoalX(p.team)) > 0) continue;
      const reach = gkInBox ? 1.1 : CONTROL_RADIUS;
      const maxZ = gkInBox ? 2.4 : CONTROL_MAX_HEIGHT;
      if (d < reach && b.pos.z < maxZ) cands.push(p);
      else if (d < 0.9 && b.pos.z >= CONTROL_MAX_HEIGHT && b.pos.z < HEADER_MAX_HEIGHT) this.tryHeader(p);
      if (b.owner >= 0 || this.phase !== 'play') return;
      if (b.vel.x !== b.vel.x) return;
    }
    if (cands.length === 0) return;
    if (cands.length > 1) {
      // Contested ball: weighted by strength and distance.
      const w = cands.map((p) => (1 + p.info.attrs.physical / 100) / (0.3 + dist(p.pos, b.pos)));
      let r = this.rng.next() * w.reduce((s, x) => s + x, 0);
      let pick = cands[0];
      for (let i = 0; i < cands.length; i++) {
        r -= w[i];
        if (r <= 0) {
          pick = cands[i];
          break;
        }
      }
      cands = [pick];
    }
    const p = cands[0];
    // Hard balls may bounce off a poor first touch (keepers in their box always gather).
    const gkInBox = p.slot === 0 && this.inOwnPenaltyArea(p.team, p.pos);
    if (hs > 17 && !gkInBox) {
      const ok = clamp(0.55 + p.info.attrs.dribbling / 250 - (hs - 17) * 0.04, 0.1, 0.95);
      if (!this.rng.chance(ok)) {
        if (!this.touch(p)) return;
        b.vel = { x: -b.vel.x * 0.25 + this.rng.gauss(2), y: -b.vel.y * 0.25 + this.rng.gauss(2), z: Math.abs(this.rng.gauss(1.5)) };
        p.kickCooldown = 0.25;
        return;
      }
    }
    this.gainPossession(p);
  }

  private tryHeader(p: SimPlayer): void {
    if (p.slot === 0) return;
    const c = this.controllerOf(p);
    let kind: KickKind | null = null;
    let power = 0.6;
    let dir: V2 | undefined;
    if (c) {
      if (c.queued) {
        kind = c.queued.kind === 'shot' ? 'shot' : 'pass';
        power = c.queued.power;
        dir = c.queued.dir;
        c.queued = null;
      }
    } else {
      // AI only heads the ball when it matters; otherwise it lets the ball drop and controls it.
      const toGoal = this.oppGoalX(p.team) - p.pos.x;
      const near = Math.abs(toGoal) < 16 && Math.abs(p.pos.y) < 12;
      const defending = Math.abs(p.pos.x - this.ownGoalX(p.team)) < 25;
      let oppClose = false;
      for (const q of this.players) if (q.team !== p.team && !q.sentOff && dist(q.pos, p.pos) < 2.5) oppClose = true;
      if (near) kind = 'shot';
      else if (defending && oppClose) {
        kind = 'clear';
        dir = v2(this.dir(p.team), 0);
      } else if (oppClose && this.ball.pos.z > 1.5) kind = 'pass';
      power = 0.7;
    }
    if (!kind) return;
    if (!this.touch(p)) return;
    this.kick(p, kind, { power, dir: dir ?? v2(this.dir(p.team), 0) });
  }

  // ------------------------------------------------------- boundaries/goals

  private checkBoundaries(): void {
    const b = this.ball;
    if (b.owner >= 0 && !b.held) {
      // Dribbling over the line: the ball leaves play.
      if (Math.abs(b.pos.x) <= PITCH_HALF_LENGTH + BALL_RADIUS && Math.abs(b.pos.y) <= PITCH_HALF_WIDTH + BALL_RADIUS) return;
      b.owner = -1;
    } else if (b.held) return;
    const lineX = PITCH_HALF_LENGTH + BALL_RADIUS;
    if (Math.abs(b.pos.x) > lineX) {
      const s = Math.sign(b.pos.x);
      const prev = this.prevBallPos;
      // Where did the ball cross the goal line?
      let cy = b.pos.y;
      let cz = b.pos.z;
      if (Math.abs(prev.x) <= lineX && prev.x !== b.pos.x) {
        const t = (s * lineX - prev.x) / (b.pos.x - prev.x);
        cy = prev.y + (b.pos.y - prev.y) * t;
        cz = prev.z + (b.pos.z - prev.z) * t;
      }
      const defending: TeamId = Math.sign(this.ownGoalX(0)) === s ? 0 : 1;
      const inGoal = Math.abs(cy) < GOAL_HALF_WIDTH && cz < GOAL_HEIGHT;
      if (inGoal) {
        if (this.indirectKicker >= 0 && b.lastTouch === this.indirectKicker) {
          this.beginRestart({ kind: 'goalkick', team: defending, spot: v2(s * (PITCH_HALF_LENGTH - GOAL_AREA_DEPTH), 0), taker: -1, indirect: false });
          return;
        }
        this.scoreGoal((1 - defending) as TeamId);
        return;
      }
      if (b.lastTouchTeam === defending) {
        const att = (1 - defending) as TeamId;
        this.stats[att].corners++;
        this.beginRestart({
          kind: 'corner',
          team: att,
          spot: v2(s * PITCH_HALF_LENGTH, (Math.sign(cy) || 1) * PITCH_HALF_WIDTH),
          taker: -1,
          indirect: false,
        });
      } else {
        this.beginRestart({ kind: 'goalkick', team: defending, spot: v2(s * (PITCH_HALF_LENGTH - GOAL_AREA_DEPTH), 0), taker: -1, indirect: false });
      }
      return;
    }
    if (Math.abs(b.pos.y) > PITCH_HALF_WIDTH + BALL_RADIUS) {
      const team = (1 - b.lastTouchTeam) as TeamId;
      this.beginRestart({
        kind: 'throwin',
        team,
        spot: v2(clamp(b.pos.x, -PITCH_HALF_LENGTH + 0.5, PITCH_HALF_LENGTH - 0.5), Math.sign(b.pos.y) * PITCH_HALF_WIDTH),
        taker: -1,
        indirect: false,
      });
    }
  }

  private scoreGoal(team: TeamId): void {
    const scorerIdx = this.ball.lastTouch;
    const scorer = this.players[scorerIdx];
    const ownGoal = !!scorer && scorer.team !== team;
    this.score[team]++;
    this.stats[team].goals++;
    if (this.lastKick && this.lastKick.kind === 'shot' && this.lastKick.team === team && this.lastKick.kicker === scorerIdx) this.stats[team].onTarget++;
    this.stoppages++;
    this.emit({ type: 'goal', team, scorer: scorerIdx, ownGoal, minute: Math.min(this.minute(), this.half === 1 ? 45 : 90) });
    this.releaseCharges();
    this.offsideSet.clear();
    this.pendingPass = null;
    this.phase = 'goal';
    this.phaseTime = 0;
    this.kickoffTeamAfterGoal = (1 - team) as TeamId;
    if (scorer && !ownGoal) {
      scorer.action = 'celebrate';
      scorer.actionTime = GOAL_CELEBRATION_TIME;
    }
  }

  // --------------------------------------------------------------- restarts

  /** Stop play: whistle, short delay, then set up the restart. */
  beginRestart(r: Restart): void {
    this.nextRestart = r;
    this.releaseCharges();
    this.offsideSet.clear();
    this.pendingPass = null;
    if (r.kind !== 'kickoff') {
      this.emit({ type: 'whistle', long: false });
      if (r.kind !== 'freekick' && r.kind !== 'penalty') this.emit({ type: 'out', kind: r.kind, team: r.team });
    }
    for (const p of this.players) if (p.action === 'tackle' || p.action === 'slide') p.actionResolved = true;
    this.phase = 'restart';
    this.phaseTime = 0;
    if (this.ball.owner >= 0) {
      this.ball.owner = -1;
      this.ball.held = false;
    }
  }

  /** Teleport everyone into position for the pending restart. */
  setupRestart(): void {
    const r = this.nextRestart;
    if (!r) return;
    this.nextRestart = null;
    const team = r.team;
    const opp = (1 - team) as TeamId;
    const dir = this.dir(team);
    const b = this.ball;
    b.pos = { x: r.spot.x, y: r.spot.y, z: 0 };
    b.vel = { x: 0, y: 0, z: 0 };
    b.spin = 0;
    b.held = false;

    // Base positions from the team shape with the ball at the restart spot.
    for (const p of this.players) {
      if (p.sentOff) continue;
      p.vel = v2();
      p.action = 'none';
      p.actionTime = 0;
      p.kickCooldown = 0;
      p.pos = shapeTarget(this, p, p.team === team, r.spot);
    }
    for (const t of [0, 1] as TeamId[]) {
      const gk = this.keeper(t);
      const gx = this.ownGoalX(t);
      gk.pos = v2(gx - Math.sign(gx) * 1.5, 0);
    }

    // Choose the taker.
    let taker: SimPlayer;
    const mates = this.teamPlayers(team).filter((p) => p.slot !== 0);
    const nearest = (pt: V2, list: SimPlayer[]) => list.reduce((a, c) => (dist(c.pos, pt) < dist(a.pos, pt) ? c : a));
    if (r.kind === 'goalkick') taker = this.keeper(team);
    else if (r.kind === 'penalty' || (r.kind === 'freekick' && Math.abs(r.spot.x - this.oppGoalX(team)) < 30))
      taker = mates.reduce((a, c) => (c.info.attrs.shooting > a.info.attrs.shooting ? c : a));
    else if (r.kind === 'corner') taker = mates.reduce((a, c) => (c.info.attrs.passing > a.info.attrs.passing ? c : a));
    else taker = nearest(r.spot, mates);
    r.taker = taker.idx;

    if (r.kind === 'kickoff') {
      for (const p of this.players) {
        if (p.sentOff || p.slot === 0) continue;
        const pd = this.dir(p.team);
        // Everyone in their own half, opponents outside the centre circle.
        if (p.pos.x * pd > -0.6) p.pos.x = -pd * 0.6;
        if (p.team === opp && Math.hypot(p.pos.x, p.pos.y) < CENTRE_CIRCLE_RADIUS + 0.5) {
          const a = Math.atan2(p.pos.y, p.pos.x);
          p.pos = v2(Math.cos(a) * (CENTRE_CIRCLE_RADIUS + 0.6), Math.sin(a) * (CENTRE_CIRCLE_RADIUS + 0.6));
          if (p.pos.x * pd > -0.6) p.pos.x = -pd * 0.6;
        }
      }
      // A second attacker stands close for the first pass.
      const partner = mates.filter((p) => p !== taker).reduce((a, c) => (this.formations[team][c.slot].depth > this.formations[team][a.slot].depth ? c : a));
      partner.pos = v2(-dir * 1.5, 6);
      taker.pos = v2(-dir * 0.5, 0);
      this.emit({ type: 'kickoff', team });
    } else if (r.kind === 'penalty') {
      const gx = this.ownGoalX(opp);
      const s = Math.sign(gx);
      for (const p of this.players) {
        if (p.sentOff || p === taker) continue;
        if (p.slot === 0 && p.team === opp) {
          p.pos = v2(gx - s * 0.2, 0);
          continue;
        }
        if (p.slot === 0) continue;
        // Outside the area and the arc.
        const edge = gx - s * (PENALTY_AREA_DEPTH + 1.5);
        if ((p.pos.x - edge) * s > 0) p.pos.x = edge - s * this.rng.range(0, 6);
        if (dist(p.pos, r.spot) < SET_PIECE_DISTANCE + 0.5) p.pos.x = r.spot.x - s * (SET_PIECE_DISTANCE + 0.6);
      }
      taker.pos = v2(r.spot.x - s * 1.5, 0);
    } else {
      if (r.kind === 'corner') this.arrangeCorner(team, r.spot);
      const minD = r.kind === 'throwin' ? 2.5 : SET_PIECE_DISTANCE + 0.3;
      for (const p of this.teamPlayers(opp)) {
        if (r.kind === 'goalkick') {
          // Opponents leave the penalty area.
          const gx = this.ownGoalX(team);
          const s = Math.sign(gx);
          if (this.inOwnPenaltyArea(team, p.pos)) p.pos.x = gx - s * (PENALTY_AREA_DEPTH + 1);
        }
        const d = dist(p.pos, r.spot);
        if (d < minD) {
          const away = d > 0.01 ? norm(sub(p.pos, r.spot)) : v2(-this.dir(opp), 0);
          p.pos = v2(r.spot.x + away.x * minD, r.spot.y + away.y * minD);
        }
      }
      const into = norm(sub(v2(this.oppGoalX(team) * 0.3, 0), r.spot));
      taker.pos = r.kind === 'throwin' ? v2(r.spot.x, r.spot.y + Math.sign(r.spot.y) * 0.3) : v2(r.spot.x - into.x * 0.6, r.spot.y - into.y * 0.6);
    }
    for (const p of this.players) {
      if (p.sentOff) continue;
      p.pos.x = clamp(p.pos.x, -PITCH_HALF_LENGTH - 2, PITCH_HALF_LENGTH + 2);
      p.pos.y = clamp(p.pos.y, -PITCH_HALF_WIDTH - 2, PITCH_HALF_WIDTH + 2);
      p.target = { ...p.pos };
    }
    const face = norm(sub(r.kind === 'throwin' ? v2(r.spot.x, 0) : v2(this.oppGoalX(team) * 0.5, 0), taker.pos));
    taker.facing = len(face) > 0 ? face : v2(dir, 0);

    b.owner = taker.idx;
    b.held = r.kind === 'throwin' || r.kind === 'goalkick';
    if (r.kind === 'throwin') b.pos.z = 1.8;
    b.lastTouch = taker.idx;
    b.lastTouchTeam = team;
    this.restart = r;
    this.phase = r.kind === 'kickoff' ? 'kickoff' : 'setpiece';
    this.phaseTime = 0;
    this.offsideSet.clear();
    this.indirectKicker = -1;

    // Humans on the restarting team take the taker; others grab a sensible player.
    for (const c of this.controllers) {
      const cur = this.players[c.player];
      if (cur && cur.controller === c.id) cur.controller = null;
      c.player = -1;
    }
    const takerHumans = this.controllers.filter((c) => c.team === team);
    if (takerHumans.length) this.assign(takerHumans[0], taker);
    for (const c of this.controllers) if (c.player < 0) this.switchPlayer(c, true);
    if (r.kind !== 'kickoff') this.emit({ type: 'whistle', long: false });
  }

  private arrangeCorner(team: TeamId, spot: V2): void {
    const gx = this.oppGoalX(team);
    const s = Math.sign(gx);
    const att = this.teamPlayers(team)
      .filter((p) => p.slot !== 0)
      .sort((a, b) => b.info.attrs.physical + b.info.attrs.shooting - (a.info.attrs.physical + a.info.attrs.shooting))
      .slice(0, 5);
    const boxSpots = [v2(gx - s * 6, 2), v2(gx - s * 9, -3), v2(gx - s * 11, 5), v2(gx - s * 7, -6), v2(gx - s * 14, 0)];
    att.forEach((p, i) => (p.pos = { x: boxSpots[i].x + this.rng.gauss(0.6), y: boxSpots[i].y * Math.sign(spot.y || 1) * -1 + this.rng.gauss(0.6) }));
    const def = this.teamPlayers((1 - team) as TeamId).filter((p) => p.slot !== 0);
    def.slice(0, 6).forEach((p, i) => {
      const m = att[i % att.length];
      p.pos = v2(m.pos.x + s * 0.9, m.pos.y + (i % 2 ? 0.6 : -0.6));
    });
  }

  private stepSetPiece(): void {
    const r = this.restart;
    if (!r) return;
    const taker = this.players[r.taker];
    const b = this.ball;
    b.vel = { x: 0, y: 0, z: 0 };
    b.pos = r.kind === 'throwin' ? { x: taker.pos.x, y: taker.pos.y, z: 1.8 } : { x: r.spot.x, y: r.spot.y, z: 0 };
    if (r.kind === 'goalkick') b.pos.z = 0;
    for (const p of this.players) {
      p.vel = v2();
      p.target = { ...p.pos };
    }
    const c = this.controllerOf(taker);
    if (c) {
      // Aim with the stick; any kick button takes it.
      const inp = c.input;
      const sd = this.stickDir(inp);
      if (sd) taker.facing = sd;
      const pressed = (k: keyof ControllerInput) => !!inp[k] && !c.prev[k];
      const released = (k: keyof ControllerInput) => !inp[k] && !!c.prev[k];
      if (this.phaseTime > 0.4) {
        for (const kb of KICK_BUTTONS) if (pressed(kb.key) && !c.charge) c.charge = { kind: kb.kind, t: 0 };
        if (c.charge) {
          const key = KICK_BUTTONS.find((k) => k.kind === c.charge!.kind)!.key;
          c.charge.t += DT;
          if (released(key) || c.charge.t > 1.6) {
            const power = this.chargePower(c);
            let kind = c.charge.kind;
            c.charge = null;
            if (r.kind === 'throwin') kind = 'throw';
            if (r.kind === 'kickoff' && kind === 'shot') kind = 'pass';
            if (r.kind === 'penalty') kind = 'shot';
            c.prev = { ...inp };
            this.takeRestart(taker, kind, { power, dir: sd ?? taker.facing, restart: r.kind });
            return;
          }
        }
      }
      c.prev = { ...inp };
      for (const other of this.controllers) if (other !== c) other.prev = { ...other.input };
      // Don't let an idle human stall the match forever.
      if (this.phaseTime > 20) aiTakeRestart(this, taker, r.kind);
      return;
    }
    for (const other of this.controllers) other.prev = { ...other.input };
    const delay = r.kind === 'kickoff' ? 0.8 : r.kind === 'penalty' ? 1.5 : 1.0;
    if (this.phaseTime >= delay) aiTakeRestart(this, taker, r.kind);
  }

  /** Execute a restart kick and resume play. */
  takeRestart(taker: SimPlayer, kind: KickKind, opt: KickOptions): void {
    const r = this.restart!;
    this.phase = 'play';
    this.phaseTime = 0;
    if (r.kind === 'kickoff') this.emit({ type: 'whistle', long: false });
    this.kick(taker, kind, opt);
    if (r.kind === 'penalty') this.penaltyKeeperGuess(taker);
  }

  /** At a penalty the keeper commits early to a side. */
  private penaltyKeeperGuess(taker: SimPlayer): void {
    const gk = this.keeper((1 - taker.team) as TeamId);
    const b = this.ball;
    const tLine = Math.abs((this.ownGoalX(gk.team) - b.pos.x) / (b.vel.x || 1e-6));
    const realY = b.pos.y + b.vel.y * tLine;
    const readIt = this.rng.chance(0.25 + gk.info.attrs.gkPositioning / 400);
    const guessY = readIt ? realY : [-2.6, 0, 2.6][Math.floor(this.rng.next() * 3)];
    gk.action = 'dive';
    gk.actionTime = 0.9;
    gk.diveDir = v2(0, Math.sign(guessY - gk.pos.y));
    const sp = Math.min(6.5, Math.abs(guessY - gk.pos.y) / 0.4);
    gk.vel = v2(0, gk.diveDir.y * sp);
  }

  // ---------------------------------------------------- team management

  readonly subsUsed: [number, number] = [0, 0];
  static readonly MAX_SUBS = 5;

  /** Bring `incoming` (from the bench) on for the player in `slot`. Returns false if not allowed. */
  substitute(team: TeamId, slot: number, incoming: PlayerInfo): boolean {
    const p = this.players[team * 11 + slot];
    const setup = team === 0 ? this.cfg.home : this.cfg.away;
    if (p.sentOff || this.subsUsed[team] >= Match.MAX_SUBS) return false;
    const bi = setup.bench.indexOf(incoming);
    if (bi < 0) return false;
    if ((slot === 0) !== (incoming.position === 'GK') && slot === 0) return false; // keepers only in goal
    setup.bench.splice(bi, 1);
    setup.bench.push(p.info);
    setup.lineup[slot] = incoming;
    p.info = incoming;
    p.stamina = 1;
    p.yellow = 0;
    this.subsUsed[team]++;
    return true;
  }

  /** Swap two players' places in the XI (e.g. move a winger to striker). */
  swapSlots(team: TeamId, a: number, b: number): void {
    if (a === b || a === 0 || b === 0) return;
    const pa = this.players[team * 11 + a];
    const pb = this.players[team * 11 + b];
    if (pa.sentOff || pb.sentOff) return;
    const setup = team === 0 ? this.cfg.home : this.cfg.away;
    [pa.info, pb.info] = [pb.info, pa.info];
    [pa.stamina, pb.stamina] = [pb.stamina, pa.stamina];
    [pa.yellow, pb.yellow] = [pb.yellow, pa.yellow];
    [setup.lineup[a], setup.lineup[b]] = [setup.lineup[b], setup.lineup[a]];
  }

  setFormation(team: TeamId, name: string): void {
    this.formations[team] = getFormation(name);
    (team === 0 ? this.cfg.home : this.cfg.away).formation = name;
  }

  // ------------------------------------------------------------ AI access

  /** Seconds for a ground ball of speed v0 to come to rest (for AI). */
  static rollTimeToStop(v0: number): number {
    return rollTime(v0, 0.2);
  }
}
