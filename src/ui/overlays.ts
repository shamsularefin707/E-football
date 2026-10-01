import type { Game } from '../game';
import type { CameraMode } from '../render/renderer';
import { FORMATION_NAMES, getFormation } from '../sim/formations';
import { Match } from '../sim/match';
import type { TeamId } from '../sim/types';
import { h, posGroup, select } from './dom';
import { minuteLabel } from './hud';

export interface OverlayHost {
  ui: HTMLElement;
  sound: boolean;
  setSound(on: boolean): void;
  resume(): void;
  restart(): void;
  quit(): void;
  controls(onBack: () => void): void;
}

function overlay(host: OverlayHost, modal: HTMLElement): void {
  host.ui.replaceChildren(h('div', { class: 'overlay' }, modal));
  (modal.querySelector('button') as HTMLElement | null)?.focus();
}

function scoreLine(g: Game): HTMLElement {
  const m = g.m;
  return h(
    'div',
    { class: 'final-score' },
    h('div', { class: 'tn r' }, m.cfg.home.name),
    h('div', { class: 'sc' }, `${m.score[0]} - ${m.score[1]}`),
    h('div', { class: 'tn' }, m.cfg.away.name),
  );
}

function scorers(g: Game): HTMLElement {
  const m = g.m;
  const list = (t: TeamId) =>
    m.log
      .filter((x) => x.e.type === 'goal' && x.e.team === t)
      .map((x) => {
        const e = x.e as Extract<typeof x.e, { type: 'goal' }>;
        const ht = m.log.find((y) => y.e.type === 'halftime');
        const half: 1 | 2 = ht && x.tick > ht.tick ? 2 : 1;
        return h('div', null, `${m.players[e.scorer]?.info.shortName ?? '?'}${e.ownGoal ? ' (OG)' : ''} ${minuteLabel(x.clock, half)}`);
      });
  return h('div', { class: 'scorers' }, h('div', { class: 'r' }, ...list(0)), h('div', null, ...list(1)));
}

export function statsTable(m: Match): HTMLElement {
  const [a, b] = m.stats;
  const poss = a.possessionTicks + b.possessionTicks;
  const pa = poss ? Math.round((a.possessionTicks / poss) * 100) : 50;
  const acc = (s: typeof a) => (s.passes ? Math.round((s.passesCompleted / s.passes) * 100) : 0);
  const rows: [string, number, number, string?][] = [
    ['Possession', pa, 100 - pa, '%'],
    ['Shots', a.shots, b.shots],
    ['On target', a.onTarget, b.onTarget],
    ['Passes', a.passes, b.passes],
    ['Pass accuracy', acc(a), acc(b), '%'],
    ['Fouls', a.fouls, b.fouls],
    ['Yellow cards', a.yellow, b.yellow],
    ['Red cards', a.red, b.red],
    ['Corners', a.corners, b.corners],
    ['Offsides', a.offsides, b.offsides],
  ];
  return h(
    'div',
    { class: 'stats' },
    ...rows.map(([label, x, y, unit]) => {
      const share = x + y > 0 ? (x / (x + y)) * 100 : 50;
      return h(
        'div',
        { class: 'stat' },
        h('span', { class: 'v' }, `${x}${unit ?? ''}`),
        h('div', { class: 'bar' }, h('i', { style: { width: `${share}%` } }), h('span', null, label)),
        h('span', { class: 'v' }, `${y}${unit ?? ''}`),
      );
    }),
  );
}

export function pauseMenu(host: OverlayHost, g: Game): void {
  const reopen = () => pauseMenu(host, g);
  overlay(
    host,
    h(
      'div',
      { class: 'modal', role: 'dialog', 'aria-label': 'Paused' },
      h('h2', { class: 'screen-title' }, 'Paused'),
      scoreLine(g),
      h(
        'div',
        { class: 'menu-list' },
        h('button', { class: 'btn primary', id: 'resume', onclick: () => host.resume() }, 'Resume'),
        h('button', { class: 'btn', onclick: () => teamManagement(host, g, reopen) }, 'Team management'),
        h('button', { class: 'btn', onclick: () => statsModal(host, g, reopen) }, 'Match stats'),
        h('button', { class: 'btn', onclick: () => host.controls(reopen) }, 'Controls'),
        h(
          'div',
          { class: 'row' },
          h('span', { style: { color: 'var(--muted)', minWidth: '90px' } }, 'Camera'),
          select(
            [
              { value: 'broadcast', label: 'Broadcast' },
              { value: 'close', label: 'Tele (close)' },
              { value: 'wide', label: 'Wide' },
            ] as { value: CameraMode; label: string }[],
            g.renderer.cameraMode,
            (v) => g.setCamera(v),
          ),
          h('span', { style: { color: 'var(--muted)', minWidth: '60px', marginLeft: '12px' } }, 'Sound'),
          select([{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }], host.sound ? 'on' : 'off', (v) => host.setSound(v === 'on')),
        ),
        h('button', { class: 'btn', onclick: () => host.restart() }, 'Restart match'),
        h('button', { class: 'btn', id: 'quit', onclick: () => host.quit() }, 'Quit to main menu'),
      ),
    ),
  );
}

function statsModal(host: OverlayHost, g: Game, onBack: () => void): void {
  overlay(host, h('div', { class: 'modal' }, h('h2', { class: 'screen-title' }, 'Match stats'), scoreLine(g), scorers(g), statsTable(g.m), h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: onBack }, 'Back'))));
}

export function halfTime(host: OverlayHost, g: Game, onContinue: () => void): void {
  const reopen = () => halfTime(host, g, onContinue);
  overlay(
    host,
    h(
      'div',
      { class: 'modal', role: 'dialog', 'aria-label': 'Half time' },
      h('h2', { class: 'screen-title' }, 'Half time'),
      scoreLine(g),
      scorers(g),
      statsTable(g.m),
      h(
        'div',
        { class: 'actions' },
        h('button', { class: 'btn', onclick: () => teamManagement(host, g, reopen) }, 'Team management'),
        h('button', { class: 'btn primary', id: 'continue', onclick: onContinue }, 'Second half ›'),
      ),
    ),
  );
}

export function fullTime(host: OverlayHost, g: Game, onRematch: () => void): void {
  overlay(
    host,
    h(
      'div',
      { class: 'modal', role: 'dialog', 'aria-label': 'Full time' },
      h('h2', { class: 'screen-title' }, 'Full time'),
      scoreLine(g),
      scorers(g),
      statsTable(g.m),
      h('div', { class: 'actions' }, h('button', { class: 'btn', id: 'to-menu', onclick: () => host.quit() }, 'Main menu'), h('button', { class: 'btn primary', id: 'rematch', onclick: onRematch }, 'Rematch')),
    ),
  );
}

/** Formation, swaps and substitutions for the teams humans control. */
export function teamManagement(host: OverlayHost, g: Game, onBack: () => void, team?: TeamId): void {
  const m = g.m;
  const humanTeams = ([0, 1] as TeamId[]).filter((t) => m.teamHasHuman(t));
  const t: TeamId = team ?? humanTeams[0] ?? 0;
  const setup = t === 0 ? m.cfg.home : m.cfg.away;
  const draw = () => teamManagement(host, g, onBack, t);
  let selected: { kind: 'xi' | 'bench'; i: number } | null = null;
  const notice = h('div', { class: 'notice', role: 'status' });

  const slots = getFormation(setup.formation);
  const xiRows = m.players
    .filter((p) => p.team === t)
    .map((p) => {
      const tr = h(
        'tr',
        { class: p.sentOff ? '' : 'clickable', 'data-slot': p.slot },
        h('td', null, h('span', { class: `pos ${posGroup(slots[p.slot].role)}` }, slots[p.slot].role)),
        h('td', null, p.info.name, p.yellow ? ' 🟨' : '', p.sentOff ? ' 🟥' : ''),
        h('td', null, p.info.position),
        h('td', null, p.info.overall),
        h('td', null, h('span', { class: 'stam', title: `${Math.round(p.stamina * 100)}%` }, h('i', { style: { width: `${Math.round(p.stamina * 100)}%` } }))),
      );
      if (!p.sentOff) tr.addEventListener('click', () => pick({ kind: 'xi', i: p.slot }, tr));
      return tr;
    });
  const benchRows = setup.bench.map((b, i) => {
    const tr = h('tr', { class: 'clickable', 'data-bench': i, 'data-pos': b.position }, h('td', null, h('span', { class: `pos ${posGroup(b.position)}` }, 'SUB')), h('td', null, b.name), h('td', null, b.position), h('td', null, b.overall), h('td', null, ''));
    tr.addEventListener('click', () => pick({ kind: 'bench', i }, tr));
    return tr;
  });

  let selRow: HTMLElement | null = null;
  function pick(s: { kind: 'xi' | 'bench'; i: number }, tr: HTMLElement) {
    if (!selected) {
      selected = s;
      selRow = tr;
      tr.classList.add('sel');
      notice.textContent = s.kind === 'xi' ? 'Pick a team-mate to swap places, or a substitute to bring on.' : 'Pick the player to take off.';
      return;
    }
    const a = selected;
    selected = null;
    selRow?.classList.remove('sel');
    if (a.kind === s.kind && a.i === s.i) {
      notice.textContent = '';
      return;
    }
    if (a.kind === 'bench' && s.kind === 'bench') {
      notice.textContent = 'Pick one substitute and one player on the pitch.';
      return;
    }
    if (a.kind === 'xi' && s.kind === 'xi') {
      if (a.i === 0 || s.i === 0) {
        notice.textContent = 'The goalkeeper can only be replaced by a substitute keeper.';
        return;
      }
      m.swapSlots(t, a.i, s.i);
      g.renderer.recolor();
      return draw();
    }
    const slot = a.kind === 'xi' ? a.i : s.i;
    const benchIdx = a.kind === 'bench' ? a.i : s.i;
    const incoming = setup.bench[benchIdx];
    if (m.subsUsed[t] >= Match.MAX_SUBS) {
      notice.textContent = `All ${Match.MAX_SUBS} substitutions used.`;
      return;
    }
    if ((slot === 0) !== (incoming.position === 'GK')) {
      notice.textContent = slot === 0 ? 'Only a goalkeeper can go in goal.' : 'Keepers can only replace the goalkeeper.';
      return;
    }
    if (!m.substitute(t, slot, incoming)) {
      notice.textContent = 'That substitution is not allowed.';
      return;
    }
    g.renderer.recolor();
    draw();
  }

  overlay(
    host,
    h(
      'div',
      { class: 'modal wide', role: 'dialog', 'aria-label': 'Team management' },
      h('h2', { class: 'screen-title' }, 'Team management'),
      humanTeams.length > 1
        ? h(
            'div',
            { class: 'tabs', style: { marginBottom: '12px' } },
            ...humanTeams.map((x) => h('button', { class: 'tab', 'aria-pressed': String(x === t), onclick: () => teamManagement(host, g, onBack, x) }, x === 0 ? m.cfg.home.name : m.cfg.away.name)),
          )
        : null,
      h(
        'div',
        { class: 'row' },
        h('span', { class: 'team-name', style: { fontSize: '26px' } }, setup.name),
        h('span', { class: 'spacer' }),
        h('span', { style: { color: 'var(--muted)' } }, 'Formation'),
        select(
          FORMATION_NAMES.map((f) => ({ value: f, label: f })),
          setup.formation,
          (v) => {
            m.setFormation(t, v);
            draw();
          },
        ),
        h('span', { style: { color: 'var(--muted)' } }, `Subs ${m.subsUsed[t]}/${Match.MAX_SUBS}`),
      ),
      h(
        'table',
        { class: 'squad', style: { marginTop: '12px' } },
        h('thead', null, h('tr', null, h('th', null, 'Role'), h('th', null, 'Name'), h('th', null, 'Pos'), h('th', null, 'OVR'), h('th', null, 'Stamina'))),
        h('tbody', null, ...xiRows),
        h('tbody', null, h('tr', null, h('th', { colspan: 5, style: { paddingTop: '16px' } }, 'Substitutes')), ...benchRows),
      ),
      notice,
      h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: onBack }, 'Done')),
    ),
  );
}
