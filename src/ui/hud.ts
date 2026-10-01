import { PITCH_HALF_LENGTH, PITCH_HALF_WIDTH } from '../sim/constants';
import type { Match } from '../sim/match';
import type { MatchEvent } from '../sim/types';
import { CONTROLLER_COLORS, type GameRenderer } from '../render/renderer';
import { h } from './dom';

interface Banner {
  big: string;
  small?: string;
  kind?: string;
  time: number;
}

/** Scoreboard, event banners, controller name tags, radar and FPS counter, drawn as DOM over the canvas. */
export class Hud {
  private root: HTMLElement;
  private sbHome = h('span');
  private sbAway = h('span');
  private sbScore = h('div', { class: 'sb-score' });
  private sbClock = h('div', { class: 'sb-clock' });
  private sbAdded = h('div', { class: 'sb-added' });
  private bannerEl = h('div', { class: 'banner' });
  private tags: HTMLElement[] = [];
  private radar = h('canvas', { class: 'radar', width: 210, height: 136 });
  private hintEl = h('div', { class: 'hint' });
  private fpsEl = h('div', { class: 'fps' });
  private replayEl = h('div', { class: 'replay-tag' }, 'REPLAY');
  private banner: Banner | null = null;
  private hintTime = 10;
  private frames = 0;
  private fpsTime = 0;
  fps = 0;

  constructor(
    host: HTMLElement,
    private m: Match,
    private r: GameRenderer,
    private opts: { radar: boolean; showFps: boolean; hint: string },
  ) {
    host.innerHTML = '';
    const home = m.cfg.home;
    const away = m.cfg.away;
    const board = h(
      'div',
      { class: 'scoreboard' },
      h('div', { class: 'sb-team' }, h('span', { class: 'sb-chip', style: { background: home.kit.shirt } }), this.sbHome),
      this.sbScore,
      h('div', { class: 'sb-team' }, this.sbAway, h('span', { class: 'sb-chip', style: { background: away.kit.shirt } })),
      this.sbClock,
      this.sbAdded,
    );
    this.sbHome.textContent = home.short;
    this.sbAway.textContent = away.short;
    this.root = h('div', null, board, h('div', { class: 'pause-hint' }, 'Esc / P / Start: pause'), this.bannerEl);
    for (const c of m.controllers) {
      const tag = h('div', { class: 'tag', style: { color: CONTROLLER_COLORS[c.id % 4] } }, h('div', { class: 'nm' }), h('div', { class: 'pw' }, h('i')));
      this.tags.push(tag);
      this.root.appendChild(tag);
    }
    if (opts.radar) this.root.appendChild(this.radar);
    this.hintEl.textContent = opts.hint;
    if (opts.hint) this.root.appendChild(this.hintEl);
    if (opts.showFps) this.root.appendChild(this.fpsEl);
    host.appendChild(this.root);
  }

  setReplay(on: boolean): void {
    if (on && !this.replayEl.isConnected) this.root.appendChild(this.replayEl);
    if (!on) this.replayEl.remove();
    this.root.classList.toggle('replaying', on);
  }

  setVisible(on: boolean): void {
    this.root.style.display = on ? '' : 'none';
  }

  showBanner(big: string, small?: string, kind?: string, time = 2.2): void {
    this.banner = { big, small, kind, time };
    this.bannerEl.className = `banner ${kind ?? ''}`;
    this.bannerEl.replaceChildren(...[h('div', { class: 'big' }, big), small ? h('div', { class: 'small' }, small) : null].filter((x): x is HTMLDivElement => !!x));
    this.bannerEl.style.opacity = '1';
  }

  onEvent(e: MatchEvent): void {
    const m = this.m;
    const team = (t: number) => (t === 0 ? m.cfg.home : m.cfg.away);
    const name = (i: number) => m.players[i].info.shortName;
    switch (e.type) {
      case 'goal': {
        const who = e.ownGoal ? `${name(e.scorer)} (OG)` : name(e.scorer);
        this.showBanner('GOAL!', `${who} ${minuteLabel(m.clock, m.half)}  ·  ${m.cfg.home.short} ${m.score[0]}-${m.score[1]} ${m.cfg.away.short}`, 'goal', 3.6);
        break;
      }
      case 'offside':
        this.showBanner('Offside', name(e.player));
        break;
      case 'foul':
        this.showBanner(e.penalty ? 'Penalty!' : 'Foul', `${name(e.by)} on ${name(e.on)}`, e.penalty ? 'goal' : undefined, e.penalty ? 3 : 2);
        break;
      case 'card':
        this.showBanner(e.color === 'red' ? 'Red card' : 'Yellow card', `${name(e.player)} · ${team(m.players[e.player].team).short}`, `card-${e.color}`, 2.6);
        break;
      case 'out':
        if (e.kind === 'corner') this.showBanner('Corner', team(e.team).name, undefined, 1.6);
        break;
      case 'woodwork':
        this.showBanner('Off the woodwork!', undefined, undefined, 1.6);
        break;
      case 'save':
        if (!this.banner || this.banner.big !== 'GOAL!') this.showBanner(e.caught ? 'Save' : 'Great save!', name(e.keeper), undefined, 1.4);
        break;
      case 'halftime':
        this.showBanner('Half time', `${m.cfg.home.short} ${m.score[0]}-${m.score[1]} ${m.cfg.away.short}`);
        break;
      case 'fulltime':
        this.showBanner('Full time', `${m.cfg.home.short} ${m.score[0]}-${m.score[1]} ${m.cfg.away.short}`, undefined, 3);
        break;
      case 'kickoff':
        if (m.clock === 0 || m.clock === 2700) this.showBanner(m.half === 1 ? 'Kick off' : 'Second half', `${m.cfg.home.name} v ${m.cfg.away.name}`, undefined, 1.6);
        break;
    }
  }

  update(dt: number): void {
    const m = this.m;
    this.sbScore.textContent = `${m.score[0]} - ${m.score[1]}`;
    const t = Math.floor(m.clock);
    this.sbClock.textContent = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
    this.sbAdded.textContent = m.addedMinutes > 0 ? `+${m.addedMinutes}` : '';
    this.sbAdded.style.display = m.addedMinutes > 0 ? '' : 'none';

    if (this.banner) {
      this.banner.time -= dt;
      if (this.banner.time <= 0) {
        this.bannerEl.style.opacity = '0';
        this.banner = null;
      }
    }

    // Controller tags above the controlled players.
    m.controllers.forEach((c, i) => {
      const tag = this.tags[i];
      const p = m.players[c.player];
      const at = p && !p.sentOff && m.phase !== 'fulltime' ? this.r.project(p.pos.x, p.pos.y, 2.9) : null;
      if (!at) {
        tag.style.display = 'none';
        return;
      }
      tag.style.display = '';
      tag.style.left = `${at.x}px`;
      tag.style.top = `${at.y}px`;
      const nm = tag.firstElementChild as HTMLElement;
      const label = `P${c.id + 1} ${p.info.shortName}`;
      if (nm.textContent !== label) nm.textContent = label;
      const pw = m.chargePower(c);
      const bar = tag.lastElementChild as HTMLElement;
      bar.style.visibility = pw > 0 ? 'visible' : 'hidden';
      (bar.firstElementChild as HTMLElement).style.width = `${Math.round(pw * 100)}%`;
    });

    if (this.opts.radar) this.drawRadar();

    if (this.hintTime > 0) {
      this.hintTime -= dt;
      if (this.hintTime <= 0) this.hintEl.style.opacity = '0';
    }

    this.frames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 0.5) {
      this.fps = Math.round(this.frames / this.fpsTime);
      this.frames = 0;
      this.fpsTime = 0;
      if (this.opts.showFps) this.fpsEl.textContent = `${this.fps} fps · ${this.r.currentPixelRatio.toFixed(2)}x`;
    }
  }

  private drawRadar(): void {
    const ctx = this.radar.getContext('2d');
    if (!ctx) return;
    const W = this.radar.width;
    const H = this.radar.height;
    const sx = (x: number) => ((x + PITCH_HALF_LENGTH) / (PITCH_HALF_LENGTH * 2)) * (W - 10) + 5;
    const sy = (y: number) => ((PITCH_HALF_WIDTH - y) / (PITCH_HALF_WIDTH * 2)) * (H - 10) + 5;
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 1;
    ctx.strokeRect(5, 5, W - 10, H - 10);
    ctx.beginPath();
    ctx.moveTo(W / 2, 5);
    ctx.lineTo(W / 2, H - 5);
    ctx.stroke();
    const m = this.m;
    const cols = [m.cfg.home.kit.shirt, m.cfg.away.kit.shirt];
    for (const p of m.players) {
      if (p.sentOff) continue;
      ctx.fillStyle = p.controller !== null ? CONTROLLER_COLORS[p.controller % 4] : cols[p.team];
      ctx.beginPath();
      ctx.arc(sx(p.pos.x), sy(p.pos.y), p.controller !== null ? 4 : 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.stroke();
    }
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(sx(m.ball.pos.x), sy(m.ball.pos.y), 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** 23', or 45+2' in added time. */
export function minuteLabel(clock: number, half: 1 | 2): string {
  const end = half === 1 ? 2700 : 5400;
  const min = Math.floor(clock / 60) + 1;
  if (clock >= end) return `${end / 60}+${Math.min(9, Math.floor((clock - end) / 60) + 1)}'`;
  return `${min}'`;
}
