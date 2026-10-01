import { emptyInput, type ControllerInput } from '../sim/types';

export type DeviceId = 'kb1' | 'kb2' | 'pad0' | 'pad1' | 'pad2' | 'pad3';

export const DEVICE_LABELS: Record<DeviceId, string> = {
  kb1: 'Keyboard (WASD)',
  kb2: 'Keyboard (Arrows)',
  pad0: 'Gamepad 1',
  pad1: 'Gamepad 2',
  pad2: 'Gamepad 3',
  pad3: 'Gamepad 4',
};

export type Action = 'up' | 'down' | 'left' | 'right' | 'pass' | 'shoot' | 'through' | 'lob' | 'sprint' | 'switchPlayer';

export const ACTION_LABELS: Record<Action, string> = {
  up: 'Move up',
  down: 'Move down',
  left: 'Move left',
  right: 'Move right',
  pass: 'Pass / Tackle',
  shoot: 'Shoot / Contain',
  through: 'Through ball',
  lob: 'Lob, cross / Slide',
  sprint: 'Sprint',
  switchPlayer: 'Switch player',
};

export type KeyBindings = Record<Action, string[]>;

export const DEFAULT_BINDINGS: Record<'kb1' | 'kb2', KeyBindings> = {
  kb1: {
    up: ['KeyW'],
    down: ['KeyS'],
    left: ['KeyA'],
    right: ['KeyD'],
    pass: ['KeyJ'],
    shoot: ['KeyK'],
    through: ['KeyL'],
    lob: ['KeyI'],
    sprint: ['ShiftLeft'],
    switchPlayer: ['Space'],
  },
  kb2: {
    up: ['ArrowUp'],
    down: ['ArrowDown'],
    left: ['ArrowLeft'],
    right: ['ArrowRight'],
    pass: ['Numpad1', 'Comma'],
    shoot: ['Numpad2', 'Period'],
    through: ['Numpad3', 'Slash'],
    lob: ['Numpad5', 'Semicolon'],
    sprint: ['Numpad0', 'ShiftRight'],
    switchPlayer: ['NumpadEnter', 'Enter'],
  },
};

const STORAGE_KEY = 'efootball.bindings.v1';

function loadBindings(): Record<'kb1' | 'kb2', KeyBindings> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { kb1: { ...DEFAULT_BINDINGS.kb1, ...parsed.kb1 }, kb2: { ...DEFAULT_BINDINGS.kb2, ...parsed.kb2 } };
    }
  } catch {
    /* storage unavailable: use defaults */
  }
  return structuredClone(DEFAULT_BINDINGS);
}

/** Keyboard and gamepad state, read once per frame. */
export class InputHub {
  private down = new Set<string>();
  bindings = loadBindings();
  /** Keys pressed since the last `consumePresses`, for menus and pause. */
  private pressed: string[] = [];
  private padPrev: boolean[][] = [[], [], [], []];

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (!e.repeat) this.pressed.push(e.code);
      this.down.add(e.code);
      // Stop the page scrolling or buttons activating while playing.
      if (this.capture && (e.code.startsWith('Arrow') || e.code === 'Space' || e.code === 'Enter' || e.code === 'Slash')) e.preventDefault();
    });
    target.addEventListener('keyup', (e) => this.down.delete(e.code));
    target.addEventListener('blur', () => this.down.clear());
  }

  /** While a match is running, swallow keys that would scroll the page. */
  capture = false;

  saveBindings(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.bindings));
    } catch {
      /* ignore */
    }
  }

  resetBindings(): void {
    this.bindings = structuredClone(DEFAULT_BINDINGS);
    this.saveBindings();
  }

  consumePresses(): string[] {
    const p = this.pressed;
    this.pressed = [];
    return p;
  }

  isDown(code: string): boolean {
    return this.down.has(code);
  }

  pads(): (Gamepad | null)[] {
    const raw = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    const out: (Gamepad | null)[] = [null, null, null, null];
    let k = 0;
    for (const g of raw) {
      if (g && g.connected && k < 4) out[k++] = g;
    }
    return out;
  }

  connectedPads(): number {
    return this.pads().filter(Boolean).length;
  }

  read(device: DeviceId): ControllerInput {
    if (device === 'kb1' || device === 'kb2') return this.readKeyboard(this.bindings[device]);
    return this.readPad(Number(device.slice(3)));
  }

  private readKeyboard(b: KeyBindings): ControllerInput {
    const on = (a: Action) => b[a].some((k) => this.down.has(k));
    let x = (on('right') ? 1 : 0) - (on('left') ? 1 : 0);
    let y = (on('up') ? 1 : 0) - (on('down') ? 1 : 0);
    const l = Math.hypot(x, y);
    if (l > 1) {
      x /= l;
      y /= l;
    }
    return {
      moveX: x,
      moveY: y,
      sprint: on('sprint'),
      pass: on('pass'),
      shoot: on('shoot'),
      through: on('through'),
      lob: on('lob'),
      switchPlayer: on('switchPlayer'),
    };
  }

  private readPad(i: number): ControllerInput {
    const g = this.pads()[i];
    if (!g) return emptyInput();
    const btn = (n: number) => !!g.buttons[n] && (g.buttons[n].pressed || g.buttons[n].value > 0.4);
    let x = g.axes[0] ?? 0;
    let y = -(g.axes[1] ?? 0);
    if (Math.hypot(x, y) < 0.2) {
      x = 0;
      y = 0;
    }
    if (btn(15)) x = 1;
    if (btn(14)) x = -1;
    if (btn(12)) y = 1;
    if (btn(13)) y = -1;
    const l = Math.hypot(x, y);
    if (l > 1) {
      x /= l;
      y /= l;
    }
    return {
      moveX: x,
      moveY: y,
      pass: btn(0),
      lob: btn(1),
      shoot: btn(2),
      through: btn(3),
      switchPlayer: btn(4),
      sprint: btn(7) || btn(5),
    };
  }

  /** Edge-detected gamepad Start / Back presses (for pause). */
  padMenuPresses(): { start: boolean; a: boolean; b: boolean }[] {
    return this.pads().map((g, i) => {
      if (!g) return { start: false, a: false, b: false };
      const now = [9, 0, 1].map((n) => !!g.buttons[n]?.pressed);
      const prev = this.padPrev[i];
      this.padPrev[i] = now;
      return { start: now[0] && !prev[0], a: now[1] && !prev[1], b: now[2] && !prev[2] };
    });
  }
}

export function keyLabel(code: string): string {
  return code
    .replace(/^Key/, '')
    .replace(/^Digit/, '')
    .replace(/^Numpad/, 'Num ')
    .replace('ShiftLeft', 'L-Shift')
    .replace('ShiftRight', 'R-Shift')
    .replace('ArrowUp', '↑')
    .replace('ArrowDown', '↓')
    .replace('ArrowLeft', '←')
    .replace('ArrowRight', '→')
    .replace('Comma', ',')
    .replace('Period', '.')
    .replace('Slash', '/')
    .replace('Semicolon', ';');
}
