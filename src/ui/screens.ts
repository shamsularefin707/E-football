import { DATA_SEASON } from '../data';
import { pickLineup, teamRating, teamStars, type ClubData, type LeagueData } from '../data/lineup';
import { ACTION_LABELS, DEFAULT_BINDINGS, DEVICE_LABELS, keyLabel, type Action, type DeviceId, type InputHub } from '../input/devices';
import { CONTROLLER_COLORS, type CameraMode } from '../render/renderer';
import { FORMATION_NAMES } from '../sim/formations';
import type { Difficulty, PlayerInfo, Position, TeamId } from '../sim/types';
import { field, h, kitSwatch, posGroup, select, starsText } from './dom';
import { applyEdit, clampOvr, clubToEdit, loadEdits, saveEdits, type ClubEdit, type Edits, type Settings } from './store';

export type Mode = 'cpu' | '1v1' | '2v2' | 'coop';

export interface TeamPick {
  league: number;
  club: number;
  away: boolean;
  formation: string;
}

export interface ControllerRow {
  device: DeviceId;
  team: TeamId;
}

export interface KickoffState {
  mode: Mode;
  side: TeamId; // which team the humans play for in vs CPU / co-op
  home: TeamPick;
  away: TeamPick;
  rows: ControllerRow[];
  half: number;
  difficulty: Difficulty;
  night: boolean;
  camera: CameraMode;
}

/** What the screens need from the app shell. */
export interface AppShell {
  ui: HTMLElement;
  input: InputHub;
  settings: Settings;
  leagues: LeagueData[];
  saveSettings(): void;
  reloadLeagues(): void;
  setSound(on: boolean): void;
  mainMenu(): void;
  kickoff(): void;
  startMatch(k: KickoffState): void;
  editor(): void;
  controls(back?: () => void): void;
  settingsScreen(): void;
}

const MODES: { value: Mode; label: string; desc: string }[] = [
  { value: 'cpu', label: 'vs CPU', desc: 'One player against the computer.' },
  { value: '1v1', label: '1 v 1', desc: 'Two players, one each side, on this computer.' },
  { value: '2v2', label: '2 v 2', desc: 'Four players, two per side. Needs at least two gamepads.' },
  { value: 'coop', label: 'Co-op vs CPU', desc: 'Two players on the same side against the computer.' },
];

export function defaultRows(mode: Mode, side: TeamId): ControllerRow[] {
  switch (mode) {
    case 'cpu':
      return [{ device: 'kb1', team: side }];
    case '1v1':
      return [
        { device: 'kb1', team: 0 },
        { device: 'kb2', team: 1 },
      ];
    case '2v2':
      return [
        { device: 'kb1', team: 0 },
        { device: 'pad0', team: 0 },
        { device: 'kb2', team: 1 },
        { device: 'pad1', team: 1 },
      ];
    case 'coop':
      return [
        { device: 'kb1', team: side },
        { device: 'kb2', team: side },
      ];
  }
}

export function clubOf(leagues: LeagueData[], t: TeamPick): ClubData {
  const l = leagues[Math.min(t.league, leagues.length - 1)];
  return l.clubs[Math.min(t.club, l.clubs.length - 1)];
}

function back(app: AppShell, to: () => void = () => app.mainMenu()): HTMLElement {
  return h('button', { class: 'btn small', onclick: to }, '‹ Back');
}

// ------------------------------------------------------------------ main menu

export function mainMenu(app: AppShell): void {
  const tile = (t: string, d: string, on: () => void, id: string) => h('button', { class: 'tile', onclick: on, 'data-id': id }, h('span', { class: 't' }, t), h('span', { class: 'd' }, d));
  const clubs = app.leagues.reduce((n, l) => n + l.clubs.length, 0);
  app.ui.replaceChildren(
    h(
      'div',
      { class: 'screen' },
      h(
        'div',
        { class: 'main-menu' },
        h(
          'div',
          null,
          h('h1', { class: 'logo' }, 'E-', h('span', null, 'Football')),
          h('p', { class: 'screen-sub', style: { marginTop: '10px' } }, `${clubs} real clubs · ${DATA_SEASON} squads · 11 v 11`),
          h(
            'nav',
            { class: 'menu-tiles' },
            tile('Kick Off', 'vs CPU, 1v1, 2v2 or co-op on this computer', () => app.kickoff(), 'kickoff'),
            tile('Team Editor', 'Update squads, ratings and positions', () => app.editor(), 'editor'),
            tile('Controls', 'Keyboard bindings and gamepad layout', () => app.controls(), 'controls'),
            tile('Settings', 'Graphics, sound and camera', () => app.settingsScreen(), 'settings'),
          ),
          h('p', { class: 'foot-note' }, 'Player ratings are this game’s own estimates. Crests are not used; kits are colour-only.'),
        ),
        h('div', { class: 'hero-pitch', 'aria-hidden': 'true' }),
      ),
    ),
  );
  (app.ui.querySelector('.tile') as HTMLElement | null)?.focus();
}

// ------------------------------------------------------------------ kick off

export function kickoffScreen(app: AppShell, k: KickoffState): void {
  const render = () => kickoffScreen(app, k);
  const notice = h('div', { class: 'notice', role: 'status' });

  const teamCard = (which: 'home' | 'away') => {
    const t = k[which];
    const club = clubOf(app.leagues, t);
    const league = app.leagues[t.league];
    const { lineup } = pickLineup(club.players, t.formation);
    const avg = (pred: (p: PlayerInfo) => boolean) => {
      const xs = lineup.filter(pred);
      return xs.length ? Math.round(xs.reduce((s, p) => s + p.overall, 0) / xs.length) : 0;
    };
    const step = (d: number) => {
      t.club = (t.club + d + league.clubs.length) % league.clubs.length;
      t.formation = clubOf(app.leagues, t).formation;
      render();
    };
    const humans = k.rows.filter((r) => r.team === (which === 'home' ? 0 : 1)).length;
    return h(
      'section',
      { class: 'panel', 'data-team': which },
      h('h3', null, which === 'home' ? 'Home' : 'Away', humans ? ` · ${humans} player${humans > 1 ? 's' : ''}` : ' · CPU'),
      select(
        app.leagues.map((l, i) => ({ value: String(i), label: l.name })),
        String(t.league),
        (v) => {
          t.league = Number(v);
          t.club = 0;
          t.formation = clubOf(app.leagues, t).formation;
          render();
        },
        { 'aria-label': `${which} league`, class: 'league-select', style: { width: '100%', marginBottom: '10px' } },
      ),
      h(
        'div',
        { class: 'club-picker' },
        h('button', { class: 'arrow', 'aria-label': 'Previous club', onclick: () => step(-1) }, '‹'),
        select(
          league.clubs.map((c, i) => ({ value: String(i), label: c.name })),
          String(t.club),
          (v) => {
            t.club = Number(v);
            t.formation = clubOf(app.leagues, t).formation;
            render();
          },
          { 'aria-label': `${which} club`, class: 'club-select' },
        ),
        h('button', { class: 'arrow', 'aria-label': 'Next club', onclick: () => step(1) }, '›'),
      ),
      h('div', { class: 'team-name' }, club.name),
      h('div', { class: 'stars', title: `${teamStars(lineup)} stars` }, starsText(teamStars(lineup))),
      h(
        'div',
        { class: 'ratings' },
        h('div', { class: 'rating' }, h('b', null, teamRating(lineup)), h('span', null, 'OVR')),
        h('div', { class: 'rating' }, h('b', null, avg((p) => posGroup(p.position) === 'ATT')), h('span', null, 'ATT')),
        h('div', { class: 'rating' }, h('b', null, avg((p) => posGroup(p.position) === 'MID')), h('span', null, 'MID')),
        h('div', { class: 'rating' }, h('b', null, avg((p) => posGroup(p.position) === 'DEF' || p.position === 'GK')), h('span', null, 'DEF')),
      ),
      h(
        'div',
        { class: 'fields', style: { marginTop: '14px' } },
        field(
          'Kit',
          h(
            'div',
            { class: 'row' },
            h('button', { class: 'btn small', 'aria-pressed': String(!t.away), onclick: () => ((t.away = false), render()) }, kitSwatch(club.home), ' Home'),
            h('button', { class: 'btn small', 'aria-pressed': String(t.away), onclick: () => ((t.away = true), render()) }, kitSwatch(club.away), ' Away'),
          ),
        ),
        field(
          'Formation',
          select(
            FORMATION_NAMES.map((f) => ({ value: f, label: f })),
            t.formation,
            (v) => {
              t.formation = v;
              render();
            },
          ),
        ),
      ),
    );
  };

  const pads = app.input.connectedPads();
  const deviceOptions = (Object.keys(DEVICE_LABELS) as DeviceId[]).map((d) => ({
    value: d,
    label: DEVICE_LABELS[d] + (d.startsWith('pad') && Number(d.slice(3)) >= pads ? ' (not connected)' : ''),
  }));
  const fixedTeams = k.mode === '1v1' || k.mode === '2v2';
  const controllers = h(
    'section',
    { class: 'panel' },
    h('h3', null, 'Controllers'),
    ...k.rows.map((r, i) =>
      h(
        'div',
        { class: 'ctrl-row' },
        h('span', { class: 'dot', style: { background: CONTROLLER_COLORS[i] }, 'aria-hidden': 'true' }),
        h('span', null, `Player ${i + 1} · `, h('b', null, r.team === 0 ? clubOf(app.leagues, k.home).short : clubOf(app.leagues, k.away).short)),
        select(deviceOptions, r.device, (v) => {
          r.device = v;
          render();
        }, { 'aria-label': `Player ${i + 1} device`, class: 'device-select' }),
      ),
    ),
    fixedTeams
      ? null
      : h(
          'div',
          { class: 'row', style: { marginTop: '10px' } },
          h('span', { style: { color: 'var(--muted)' } }, 'Play as'),
          h('button', { class: 'tab', 'aria-pressed': String(k.side === 0), onclick: () => setSide(0) }, 'Home'),
          h('button', { class: 'tab', 'aria-pressed': String(k.side === 1), onclick: () => setSide(1) }, 'Away'),
        ),
    notice,
  );
  function setSide(s: TeamId) {
    k.side = s;
    for (const r of k.rows) r.team = s;
    render();
  }

  const settings = h(
    'section',
    { class: 'panel' },
    h('h3', null, 'Match settings'),
    h(
      'div',
      { class: 'fields' },
      field('Half length', select([2, 3, 4, 5, 6, 8, 10].map((n) => ({ value: String(n), label: `${n} min` })), String(k.half), (v) => (k.half = Number(v)), { class: 'half-select' })),
      field(
        'Difficulty',
        select(
          [
            { value: 'amateur' as Difficulty, label: 'Amateur' },
            { value: 'pro' as Difficulty, label: 'Professional' },
            { value: 'worldclass' as Difficulty, label: 'World Class' },
          ],
          k.difficulty,
          (v) => (k.difficulty = v),
        ),
      ),
      field('Time of day', select([{ value: 'night', label: 'Night' }, { value: 'day', label: 'Day' }], k.night ? 'night' : 'day', (v) => (k.night = v === 'night'))),
      field(
        'Camera',
        select(
          [
            { value: 'broadcast' as CameraMode, label: 'Broadcast' },
            { value: 'close' as CameraMode, label: 'Tele (close)' },
            { value: 'wide' as CameraMode, label: 'Wide' },
          ],
          k.camera,
          (v) => (k.camera = v),
        ),
      ),
    ),
  );

  const problems = validateRows(k, pads);
  notice.textContent = problems.error ?? problems.warning ?? '';
  notice.classList.toggle('error', !!problems.error);

  app.ui.replaceChildren(
    h(
      'div',
      { class: 'screen' },
      h('div', { class: 'row' }, back(app), h('h2', { class: 'screen-title', style: { margin: '0 0 0 8px' } }, 'Kick Off')),
      h(
        'div',
        { class: 'row', style: { marginTop: '16px' } },
        h(
          'div',
          { class: 'tabs', role: 'group', 'aria-label': 'Game mode' },
          ...MODES.map((md) =>
            h(
              'button',
              {
                class: 'tab',
                'data-mode': md.value,
                'aria-pressed': String(k.mode === md.value),
                onclick: () => {
                  k.mode = md.value;
                  k.rows = defaultRows(md.value, k.side);
                  render();
                },
              },
              md.label,
            ),
          ),
        ),
        h('span', { style: { color: 'var(--muted)' } }, MODES.find((x) => x.value === k.mode)!.desc),
      ),
      h('div', { class: 'kickoff-grid' }, teamCard('home'), teamCard('away'), controllers, settings),
      h(
        'div',
        { class: 'actions' },
        h('button', { class: 'btn primary', id: 'start-match', disabled: !!problems.error, onclick: () => app.startMatch(k) }, 'Play match ›'),
      ),
    ),
  );
}

export function validateRows(k: KickoffState, pads: number): { error?: string; warning?: string } {
  const seen = new Set<DeviceId>();
  for (const r of k.rows) {
    if (seen.has(r.device)) return { error: `${DEVICE_LABELS[r.device]} is picked twice. Give each player a different device.` };
    seen.add(r.device);
  }
  const missing = k.rows.filter((r) => r.device.startsWith('pad') && Number(r.device.slice(3)) >= pads);
  if (missing.length) return { warning: `${missing.map((r) => DEVICE_LABELS[r.device]).join(', ')} not detected yet. Plug it in and press a button; until then that player stands still.` };
  return {};
}

// ------------------------------------------------------------------ team editor

const POSITIONS: Position[] = ['GK', 'CB', 'LB', 'RB', 'LWB', 'RWB', 'CDM', 'CM', 'CAM', 'LM', 'RM', 'LW', 'RW', 'CF', 'ST'];

export function editorScreen(app: AppShell, sel = { league: 0, club: 0 }): void {
  const edits: Edits = loadEdits();
  const builtinLeague = app.leagues[sel.league];
  const club = builtinLeague.clubs[Math.min(sel.club, builtinLeague.clubs.length - 1)];
  const work: ClubEdit = structuredClone(clubToEdit(club));
  const players = work.players!;
  const notice = h('div', { class: 'notice', role: 'status' });
  const rerender = () => editorScreen(app, sel);

  const tbody = h('tbody');
  const drawRows = () => {
    tbody.replaceChildren(
      ...players.map((p, i) => {
        const name = h('input', { value: p.name, 'aria-label': `Player ${i + 1} name`, maxlength: 40 });
        name.addEventListener('input', () => (p.name = name.value));
        const ovr = h('input', { type: 'number', min: 40, max: 99, value: p.ovr, 'aria-label': `Player ${i + 1} rating`, style: { width: '70px' } });
        ovr.addEventListener('change', () => {
          p.ovr = clampOvr(Number(ovr.value));
          ovr.value = String(p.ovr);
        });
        return h(
          'tr',
          null,
          h('td', null, i + 1),
          h('td', null, name),
          h('td', null, select(POSITIONS.map((x) => ({ value: x, label: x })), p.pos, (v) => (p.pos = v), { 'aria-label': `Player ${i + 1} position` })),
          h('td', null, ovr),
          h('td', null, h('button', { class: 'btn small', 'aria-label': `Remove ${p.name}`, onclick: () => (players.splice(i, 1), drawRows()) }, '✕')),
        );
      }),
    );
  };
  drawRows();

  const save = () => {
    const cleaned = players.map((p) => ({ ...p, name: p.name.trim() })).filter((p) => p.name);
    if (cleaned.length < 11) return fail('A squad needs at least 11 named players.');
    if (!cleaned.some((p) => p.pos === 'GK')) return fail('A squad needs at least one goalkeeper.');
    const name = (work.name ?? '').trim() || club.name;
    edits[clubBaseId(club)] = { name, short: (work.short ?? club.short).trim().toUpperCase().slice(0, 4) || club.short, players: cleaned };
    saveEdits(edits);
    app.reloadLeagues();
    notice.classList.remove('error');
    notice.textContent = `Saved ${name}.`;
  };
  const fail = (msg: string) => {
    notice.classList.add('error');
    notice.textContent = msg;
  };
  const reset = () => {
    delete edits[clubBaseId(club)];
    saveEdits(edits);
    app.reloadLeagues();
    rerender();
  };
  const exportAll = () => {
    const blob = new Blob([JSON.stringify(loadEdits(), null, 2)], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: 'efootball-squads.json' });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const fileInput = h('input', { type: 'file', accept: 'application/json,.json', style: { display: 'none' } });
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    try {
      const parsed = parseEdits(JSON.parse(await f.text()));
      saveEdits({ ...loadEdits(), ...parsed });
      app.reloadLeagues();
      rerender();
    } catch (err) {
      fail(`Could not import that file: ${(err as Error).message}`);
    }
  });

  const nameIn = h('input', { value: work.name ?? '', maxlength: 40 });
  nameIn.addEventListener('input', () => (work.name = nameIn.value));
  const shortIn = h('input', { value: work.short ?? '', maxlength: 4 });
  shortIn.addEventListener('input', () => (work.short = shortIn.value));
  const edited = !!edits[clubBaseId(club)];

  app.ui.replaceChildren(
    h(
      'div',
      { class: 'screen' },
      h('div', { class: 'row' }, back(app), h('h2', { class: 'screen-title', style: { margin: '0 0 0 8px' } }, 'Team Editor')),
      h('p', { class: 'screen-sub' }, 'Fix transfers, ratings and positions. Changes are saved in this browser; export them to share with friends.'),
      h(
        'div',
        { class: 'panel' },
        h(
          'div',
          { class: 'fields' },
          field('League', select(app.leagues.map((l, i) => ({ value: String(i), label: l.name })), String(sel.league), (v) => editorScreen(app, { league: Number(v), club: 0 }))),
          field('Club', select(builtinLeague.clubs.map((c, i) => ({ value: String(i), label: c.name })), String(sel.club), (v) => editorScreen(app, { league: sel.league, club: Number(v) }))),
          field('Club name', nameIn),
          field('Short name', shortIn),
        ),
        h('p', { style: { color: 'var(--muted)', fontSize: '14px' } }, edited ? 'This club has your edits.' : 'Built-in squad.'),
        h('table', { class: 'squad' }, h('thead', null, h('tr', null, h('th', null, '#'), h('th', null, 'Name'), h('th', null, 'Pos'), h('th', null, 'OVR'), h('th', null, ''))), tbody),
        h(
          'div',
          { class: 'row', style: { marginTop: '12px' } },
          h('button', { class: 'btn small', onclick: () => (players.push({ name: 'New Player', pos: 'CM', ovr: 70 }), drawRows()) }, '+ Add player'),
          h('span', { class: 'spacer' }),
          h('button', { class: 'btn small', onclick: exportAll }, 'Export all edits'),
          h('button', { class: 'btn small', onclick: () => fileInput.click() }, 'Import'),
          fileInput,
          h('button', { class: 'btn small', onclick: reset, disabled: !edited }, 'Reset club'),
          h('button', { class: 'btn primary', onclick: save, id: 'editor-save' }, 'Save'),
        ),
        notice,
      ),
    ),
  );
}

/** Edits are keyed by the built-in club id. */
function clubBaseId(c: ClubData): string {
  return c.id;
}

export function parseEdits(raw: unknown): Edits {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('expected an object of clubs');
  const out: Edits = {};
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== 'object') continue;
    const e = v as Record<string, unknown>;
    const ce: ClubEdit = {};
    if (typeof e.name === 'string') ce.name = e.name.slice(0, 40);
    if (typeof e.short === 'string') ce.short = e.short.slice(0, 4);
    if (Array.isArray(e.players)) {
      const ps = e.players
        .filter((p): p is { name: string; pos: string; ovr: number } => !!p && typeof p.name === 'string' && POSITIONS.includes(p.pos) && Number.isFinite(Number(p.ovr)))
        .map((p) => ({ name: p.name.slice(0, 40), pos: p.pos as Position, ovr: clampOvr(Number(p.ovr)) }));
      if (ps.length >= 11 && ps.some((p) => p.pos === 'GK')) ce.players = ps;
    }
    out[id] = ce;
  }
  return out;
}

/** Re-export for the app shell. */
export { applyEdit };

// ------------------------------------------------------------------ controls

export function controlsPanel(app: AppShell): HTMLElement {
  const notice = h('div', { class: 'notice', role: 'status' });
  const wrap = h('div');
  const draw = () => {
    const col = (dev: 'kb1' | 'kb2') =>
      h(
        'div',
        { class: 'panel' },
        h('h3', null, DEVICE_LABELS[dev]),
        h(
          'div',
          { class: 'keys' },
          ...(Object.keys(ACTION_LABELS) as Action[]).flatMap((a) => [
            h('span', null, ACTION_LABELS[a]),
            h('button', { class: 'kbd-btn', 'data-dev': dev, 'data-action': a, onclick: (ev: Event) => listen(ev.currentTarget as HTMLElement, dev, a) }, app.input.bindings[dev][a].map(keyLabel).join(' / ') || '—'),
          ]),
        ),
      );
    wrap.replaceChildren(
      h('div', { class: 'two-col' }, col('kb1'), col('kb2')),
      h(
        'div',
        { class: 'panel', style: { marginTop: '20px' } },
        h('h3', null, 'Gamepad'),
        h(
          'div',
          { class: 'keys' },
          ...[
            ['Move', 'Left stick / D-pad'],
            ['Pass / Tackle', 'A (Cross)'],
            ['Lob, cross / Slide', 'B (Circle)'],
            ['Shoot / Contain', 'X (Square)'],
            ['Through ball', 'Y (Triangle)'],
            ['Switch player', 'LB (L1)'],
            ['Sprint', 'RT or RB (R2 / R1)'],
            ['Pause', 'Start (Options)'],
          ].flatMap(([a, b]) => [h('span', null, a), h('kbd', null, b)]),
        ),
        h('p', { style: { color: 'var(--muted)', fontSize: '14px', marginBottom: '0' } }, 'Hold a kick button longer for more power. Press a kick button while the ball is on its way to you for a first-time pass or shot.'),
      ),
      h('div', { class: 'actions' }, h('button', { class: 'btn small', onclick: () => (app.input.resetBindings(), draw()) }, 'Reset to defaults')),
      notice,
    );
  };
  const listen = (btn: HTMLElement, dev: 'kb1' | 'kb2', action: Action) => {
    btn.classList.add('listening');
    btn.textContent = 'Press a key…';
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      window.removeEventListener('keydown', onKey, true);
      if (e.code === 'Escape') return draw();
      const b = app.input.bindings;
      let moved = '';
      for (const d of ['kb1', 'kb2'] as const)
        for (const a of Object.keys(b[d]) as Action[]) {
          if (b[d][a].includes(e.code) && !(d === dev && a === action)) {
            b[d][a] = b[d][a].filter((c) => c !== e.code);
            moved = `${keyLabel(e.code)} was removed from ${DEVICE_LABELS[d]} · ${ACTION_LABELS[a]}.`;
          }
        }
      b[dev][action] = [e.code];
      app.input.saveBindings();
      draw();
      notice.textContent = moved;
    };
    window.addEventListener('keydown', onKey, true);
  };
  draw();
  return wrap;
}

export function controlsScreen(app: AppShell, onBack?: () => void): void {
  app.ui.replaceChildren(
    h(
      'div',
      { class: 'screen' },
      h('div', { class: 'row' }, back(app, onBack), h('h2', { class: 'screen-title', style: { margin: '0 0 0 8px' } }, 'Controls')),
      h('p', { class: 'screen-sub' }, 'Click a key to change it. Two keyboards can play on one computer: WASD side and arrow-keys side.'),
      controlsPanel(app),
    ),
  );
}

/** One-line controls reminder shown at kick-off. */
export function controlsHint(input: InputHub, devices: DeviceId[]): string {
  return devices
    .map((d, i) => {
      if (!d.startsWith('kb')) return `P${i + 1} gamepad: A pass · X shoot · Y through · B lob · RT sprint · LB switch`;
      const b = input.bindings[d as 'kb1' | 'kb2'] ?? DEFAULT_BINDINGS.kb1;
      const k = (a: Action) => keyLabel(b[a][0] ?? '?');
      return `P${i + 1}: ${k('up')}${k('left')}${k('down')}${k('right')} move · ${k('pass')} pass · ${k('shoot')} shoot · ${k('through')} through · ${k('lob')} lob · ${k('sprint')} sprint · ${k('switchPlayer')} switch`;
    })
    .join('\n');
}

// ------------------------------------------------------------------ settings

export function settingsScreen(app: AppShell): void {
  const s = app.settings;
  const set = <K extends keyof Settings>(key: K, v: Settings[K]) => {
    s[key] = v;
    app.saveSettings();
  };
  const yesNo = (v: boolean, on: (b: boolean) => void) => select([{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }], v ? 'on' : 'off', (x) => on(x === 'on'));
  app.ui.replaceChildren(
    h(
      'div',
      { class: 'screen' },
      h('div', { class: 'row' }, back(app), h('h2', { class: 'screen-title', style: { margin: '0 0 0 8px' } }, 'Settings')),
      h('p', { class: 'screen-sub' }, 'Auto quality picks a level from your graphics chip. Choose Low on older laptops; the game also lowers resolution by itself if frames drop.'),
      h(
        'div',
        { class: 'panel' },
        h(
          'div',
          { class: 'fields' },
          field(
            'Graphics quality',
            select(
              [
                { value: 'auto', label: 'Auto' },
                { value: 'low', label: 'Low' },
                { value: 'medium', label: 'Medium' },
                { value: 'high', label: 'High' },
              ] as { value: Settings['quality']; label: string }[],
              s.quality,
              (v) => set('quality', v),
            ),
          ),
          field('Sound', yesNo(s.sound, (b) => (set('sound', b), app.setSound(b)))),
          field(
            'Default camera',
            select(
              [
                { value: 'broadcast', label: 'Broadcast' },
                { value: 'close', label: 'Tele (close)' },
                { value: 'wide', label: 'Wide' },
              ] as { value: CameraMode; label: string }[],
              s.camera,
              (v) => set('camera', v),
            ),
          ),
          field('Radar', yesNo(s.radar, (b) => set('radar', b))),
          field('FPS counter', yesNo(s.showFps, (b) => set('showFps', b))),
          field('Default half length', select([2, 3, 4, 5, 6, 8, 10].map((n) => ({ value: String(n), label: `${n} min` })), String(s.halfLength), (v) => set('halfLength', Number(v)))),
          field(
            'Default difficulty',
            select(
              [
                { value: 'amateur', label: 'Amateur' },
                { value: 'pro', label: 'Professional' },
                { value: 'worldclass', label: 'World Class' },
              ] as { value: Difficulty; label: string }[],
              s.difficulty,
              (v) => set('difficulty', v),
            ),
          ),
          field('Default time of day', select([{ value: 'night', label: 'Night' }, { value: 'day', label: 'Day' }] as { value: Settings['timeOfDay']; label: string }[], s.timeOfDay, (v) => set('timeOfDay', v))),
        ),
      ),
    ),
  );
}
