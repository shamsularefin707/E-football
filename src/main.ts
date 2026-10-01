import './ui/style.css';
import { Sfx } from './audio/sfx';
import { buildTeamSetup, resolveKitClash, type LeagueData } from './data/lineup';
import { Game } from './game';
import { InputHub } from './input/devices';
import { fullTime, halfTime, pauseMenu, type OverlayHost } from './ui/overlays';
import {
  clubOf,
  controlsHint,
  controlsPanel,
  controlsScreen,
  defaultRows,
  editorScreen,
  kickoffScreen,
  mainMenu,
  settingsScreen,
  type AppShell,
  type KickoffState,
} from './ui/screens';
import { leaguesWithEdits, loadSettings, resolveQuality, saveSettings, type Settings } from './ui/store';
import { h } from './ui/dom';

class App implements AppShell, OverlayHost {
  readonly ui = document.getElementById('ui') as HTMLElement;
  readonly hudHost = document.getElementById('hud') as HTMLElement;
  readonly canvas = document.getElementById('game') as HTMLCanvasElement;
  readonly input = new InputHub();
  readonly sfx = new Sfx();
  settings: Settings = loadSettings();
  leagues: LeagueData[] = leaguesWithEdits();
  game: Game | null = null;
  private last: KickoffState | null = null;

  constructor() {
    this.sfx.enabled = this.settings.sound;
  }

  get sound(): boolean {
    return this.settings.sound;
  }

  saveSettings(): void {
    saveSettings(this.settings);
  }

  reloadLeagues(): void {
    this.leagues = leaguesWithEdits();
  }

  setSound(on: boolean): void {
    this.settings.sound = on;
    this.saveSettings();
    this.sfx.setEnabled(on);
  }

  mainMenu(): void {
    this.endGame();
    mainMenu(this);
  }

  kickoff(): void {
    if (!this.last) {
      const big = (league: number, name: string) => Math.max(0, this.leagues[league].clubs.findIndex((c) => c.name === name));
      const s = this.settings;
      this.last = {
        mode: 'cpu',
        side: 0,
        home: { league: 0, club: big(0, 'Liverpool'), away: false, formation: '' },
        away: { league: 1, club: big(1, 'Real Madrid'), away: false, formation: '' },
        rows: defaultRows('cpu', 0),
        half: s.halfLength,
        difficulty: s.difficulty,
        night: s.timeOfDay === 'night',
        camera: s.camera,
      };
      this.last.home.formation = clubOf(this.leagues, this.last.home).formation;
      this.last.away.formation = clubOf(this.leagues, this.last.away).formation;
    }
    kickoffScreen(this, this.last);
  }

  editor(): void {
    editorScreen(this);
  }

  controls(onBack?: () => void): void {
    if (this.game && onBack) {
      // In a match: show the controls in a modal over the pitch.
      this.ui.replaceChildren(
        h('div', { class: 'overlay' }, h('div', { class: 'modal wide' }, h('h2', { class: 'screen-title' }, 'Controls'), controlsPanel(this), h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: onBack }, 'Back')))),
      );
      return;
    }
    controlsScreen(this, onBack);
  }

  settingsScreen(): void {
    settingsScreen(this);
  }

  startMatch(k: KickoffState): void {
    this.last = k;
    this.sfx.start();
    this.endGame();
    const homeClub = clubOf(this.leagues, k.home);
    const awayClub = clubOf(this.leagues, k.away);
    const home = buildTeamSetup(homeClub, { useAway: k.home.away, formation: k.home.formation });
    const away = resolveKitClash(home, awayClub, buildTeamSetup(awayClub, { useAway: k.away.away, formation: k.away.formation }));
    const devices = k.rows.map((r) => r.device);
    this.ui.replaceChildren();
    this.game = new Game(
      this.canvas,
      this.hudHost,
      {
        cfg: {
          home,
          away,
          halfLengthMinutes: k.half,
          difficulty: k.difficulty,
          controllers: k.rows.map((r, i) => ({ id: i, team: r.team })),
          seed: (Date.now() ^ (Math.random() * 0x7fffffff)) >>> 0,
        },
        devices,
        quality: resolveQuality(this.settings),
        night: k.night,
        camera: k.camera,
        radar: this.settings.radar,
        showFps: this.settings.showFps,
        hint: controlsHint(this.input, devices),
      },
      this.input,
      this.sfx,
      {
        onPause: () => pauseMenu(this, this.game!),
        onHalfTime: () =>
          halfTime(this, this.game!, () => {
            this.ui.replaceChildren();
            this.game!.continueAfterHalfTime();
          }),
        onFullTime: () => fullTime(this, this.game!, () => this.startMatch(k)),
      },
    );
    this.canvas.style.visibility = 'visible';
    this.game.start();
  }

  resume(): void {
    this.ui.replaceChildren();
    this.game?.resume();
  }

  restart(): void {
    if (this.last) this.startMatch(this.last);
  }

  quit(): void {
    this.mainMenu();
  }

  private endGame(): void {
    if (!this.game) return;
    this.game.dispose();
    this.game = null;
    this.hudHost.replaceChildren();
    this.canvas.style.visibility = 'hidden';
  }
}

const app = new App();
app.canvas.style.visibility = 'hidden';
app.mainMenu();

// Test and debugging hook (read-only use from the browser console or e2e tests).
(window as unknown as { __efb: unknown }).__efb = app;
