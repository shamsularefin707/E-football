import type { Sfx } from './audio/sfx';
import type { DeviceId, InputHub } from './input/devices';
import { GameRenderer, type CameraMode, type Quality } from './render/renderer';
import { DT, GOAL_CELEBRATION_TIME, HALF_TIME_PAUSE, PITCH_HALF_LENGTH } from './sim/constants';
import { Match } from './sim/match';
import { emptyInput, type MatchConfig, type MatchEvent, type PlayerAction } from './sim/types';
import { Hud } from './ui/hud';

export interface GameOptions {
  cfg: MatchConfig;
  /** Input device for each controller id. */
  devices: DeviceId[];
  quality: Quality;
  night: boolean;
  camera: CameraMode;
  radar: boolean;
  showFps: boolean;
  hint: string;
}

export interface GameHooks {
  onPause(): void;
  onHalfTime(): void;
  onFullTime(): void;
}

interface Frame {
  p: Float32Array; // per player: x, y, vx, vy, fx, fy, actionTime, dx, dy
  a: PlayerAction[];
  off: boolean[];
  b: [number, number, number];
  owner: number;
  held: boolean;
}

const REPLAY_HZ = 30;
const REPLAY_SECONDS = 8;
const STRIDE = 9;

/** Owns one match: fixed-step simulation, rendering, input, sound, HUD and goal replays. */
export class Game {
  readonly m: Match;
  readonly renderer: GameRenderer;
  readonly hud: Hud;
  paused = false;
  private raf = 0;
  private last = 0;
  private acc = 0;
  private running = false;
  private frames: Frame[] = [];
  private replayAcc = 0;
  private replay: { frames: Frame[]; i: number; t: number; live: Frame } | null = null;
  private replayDone = false;
  private halftimeShown = false;
  private fulltimeShown = false;
  private disposed = false;

  constructor(
    canvas: HTMLCanvasElement,
    hudHost: HTMLElement,
    readonly opts: GameOptions,
    private input: InputHub,
    private sfx: Sfx,
    private hooks: GameHooks,
  ) {
    this.m = new Match(opts.cfg);
    this.renderer = new GameRenderer(canvas, this.m, { quality: opts.quality, night: opts.night, camera: opts.camera });
    this.hud = new Hud(hudHost, this.m, this.renderer, { radar: opts.radar, showFps: opts.showFps, hint: opts.hint });
    this.renderer.resize();
    this.renderer.snapCamera();
    window.addEventListener('resize', this.onResize);
    this.input.capture = true;
    this.input.consumePresses();
  }

  private onResize = () => this.renderer.resize();

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const loop = (now: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.25, (now - this.last) / 1000);
      this.last = now;
      this.frame(dt);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  pause(): void {
    this.paused = true;
    this.input.capture = false;
  }

  resume(): void {
    this.paused = false;
    this.input.capture = true;
    this.input.consumePresses();
    this.last = performance.now();
  }

  /** Leave the half-time screen: the sim starts the second half on the next tick. */
  continueAfterHalfTime(): void {
    if (this.m.phase === 'halftime') this.m.phaseTime = HALF_TIME_PAUSE;
    this.step();
    this.renderer.snapCamera();
    this.resume();
  }

  setCamera(mode: CameraMode): void {
    this.renderer.cameraMode = mode;
  }

  /** Advance exactly one simulation tick (also used by tests). */
  step(): void {
    const m = this.m;
    for (const c of m.controllers) m.setInput(c.id, this.opts.devices[c.id] ? this.input.read(this.opts.devices[c.id]) : emptyInput());
    m.step();
    for (const e of m.events) this.onEvent(e);
    this.recordFrame();
  }

  private frame(dt: number): void {
    const m = this.m;
    this.pollMenuKeys();
    if (this.replay) {
      this.stepReplay(dt);
    } else if (!this.paused) {
      this.acc += dt;
      let n = 0;
      while (this.acc >= DT && n < 8) {
        this.step();
        this.acc -= DT;
        n++;
        if (this.paused || this.replay) break;
      }
      if (n === 8) this.acc = 0; // too far behind (tab was hidden): drop time rather than spiral
      if (m.phase === 'goal' && !this.replayDone && m.phaseTime > 1.6 && this.frames.length > REPLAY_HZ * 2) this.startReplay();
      if (m.phase !== 'goal') this.replayDone = false;
      if (m.phase === 'halftime' && !this.halftimeShown && m.phaseTime > 1.2) {
        this.halftimeShown = true;
        this.pause();
        this.hooks.onHalfTime();
      }
      if (m.phase !== 'halftime') this.halftimeShown = false;
      if (m.phase === 'fulltime' && !this.fulltimeShown && m.phaseTime > 2) {
        this.fulltimeShown = true;
        this.pause();
        this.hooks.onFullTime();
      }
      const near = 1 - Math.min(1, Math.abs(PITCH_HALF_LENGTH - Math.abs(m.ball.pos.x)) / 40);
      this.sfx.setExcitement(m.phase === 'play' ? near : 0.2);
    }
    this.renderer.render(dt);
    this.hud.update(dt);
  }

  private pollMenuKeys(): void {
    const keys = this.input.consumePresses();
    const pads = this.input.padMenuPresses();
    if (this.replay) {
      // Any action key or Start skips the replay.
      if (keys.length || pads.some((p) => p.start || p.a)) this.endReplay();
      return;
    }
    if (this.paused) return;
    if (keys.includes('Escape') || keys.includes('KeyP') || pads.some((p) => p.start)) {
      this.pause();
      this.hooks.onPause();
    }
  }

  private onEvent(e: MatchEvent): void {
    this.hud.onEvent(e);
    const s = this.sfx;
    switch (e.type) {
      case 'kick':
        s.kick(e.power);
        break;
      case 'whistle':
        s.whistle(e.long);
        break;
      case 'goal':
        s.whistle();
        s.roar(GOAL_CELEBRATION_TIME);
        this.renderer.addShake(0.5);
        break;
      case 'woodwork':
        s.thud();
        s.groan();
        this.renderer.addShake(0.2);
        break;
      case 'save':
        s.thud();
        break;
      case 'out':
        if (e.kind === 'goalkick' && this.m.lastKick?.kind === 'shot') s.groan();
        break;
      case 'kickoff':
        s.whistle();
        break;
      case 'halftime':
      case 'fulltime':
        break;
    }
  }

  // ----------------------------------------------------------- replays

  private snapshot(): Frame {
    const m = this.m;
    const p = new Float32Array(m.players.length * STRIDE);
    m.players.forEach((q, i) => {
      p.set([q.pos.x, q.pos.y, q.vel.x, q.vel.y, q.facing.x, q.facing.y, q.actionTime, q.diveDir.x, q.diveDir.y], i * STRIDE);
    });
    const b = m.ball;
    return { p, a: m.players.map((q) => q.action), off: m.players.map((q) => q.sentOff), b: [b.pos.x, b.pos.y, b.pos.z], owner: b.owner, held: b.held };
  }

  private applyFrame(f: Frame): void {
    const m = this.m;
    m.players.forEach((q, i) => {
      const o = i * STRIDE;
      q.pos.x = f.p[o];
      q.pos.y = f.p[o + 1];
      q.vel.x = f.p[o + 2];
      q.vel.y = f.p[o + 3];
      q.facing.x = f.p[o + 4];
      q.facing.y = f.p[o + 5];
      q.actionTime = f.p[o + 6];
      q.diveDir.x = f.p[o + 7];
      q.diveDir.y = f.p[o + 8];
      q.action = f.a[i];
      q.sentOff = f.off[i];
    });
    m.ball.pos.x = f.b[0];
    m.ball.pos.y = f.b[1];
    m.ball.pos.z = f.b[2];
    m.ball.owner = f.owner;
    m.ball.held = f.held;
  }

  private recordFrame(): void {
    this.replayAcc += DT;
    if (this.replayAcc < 1 / REPLAY_HZ) return;
    this.replayAcc -= 1 / REPLAY_HZ;
    this.frames.push(this.snapshot());
    if (this.frames.length > REPLAY_HZ * REPLAY_SECONDS) this.frames.shift();
  }

  private startReplay(): void {
    // Replay up to the moment of the goal (frames recorded after it show the celebration).
    const afterGoal = Math.round(this.m.phaseTime * REPLAY_HZ);
    const frames = this.frames.slice(Math.max(0, this.frames.length - afterGoal - REPLAY_HZ * 5), this.frames.length - afterGoal + REPLAY_HZ);
    if (frames.length < REPLAY_HZ) {
      this.replayDone = true;
      return;
    }
    this.replay = { frames, i: 0, t: 0, live: this.snapshot() };
    this.replayDone = true;
    this.hud.setReplay(true);
    this.input.capture = true;
    this.renderer.snapCamera();
  }

  private stepReplay(dt: number): void {
    const r = this.replay!;
    r.t += dt * 0.75; // slight slow motion
    const i = Math.floor(r.t * REPLAY_HZ);
    if (i >= r.frames.length) {
      this.endReplay();
      return;
    }
    this.applyFrame(r.frames[i]);
  }

  private endReplay(): void {
    if (!this.replay) return;
    this.applyFrame(this.replay.live);
    this.replay = null;
    this.hud.setReplay(false);
    this.renderer.snapCamera();
    this.last = performance.now();
    this.acc = 0;
  }

  get inReplay(): boolean {
    return this.replay !== null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    window.removeEventListener('resize', this.onResize);
    this.input.capture = false;
    this.renderer.dispose();
  }
}
