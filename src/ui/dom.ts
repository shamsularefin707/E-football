type Child = Node | string | number | null | undefined | false | Child[];
type Attrs = Record<string, string | number | boolean | null | undefined | EventListener | Partial<CSSStyleDeclaration>>;

/** Tiny element builder: h('button', { class: 'btn', onclick: fn }, 'Text'). Strings are inserted as text, never HTML. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'value' && 'value' in el) (el as HTMLInputElement).value = String(v);
      else if (k === 'checked' && 'checked' in el) (el as HTMLInputElement).checked = !!v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}

function append(el: Node, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
}

export function select<T extends string>(options: { value: T; label: string }[], value: T, onChange: (v: T) => void, attrs: Attrs = {}): HTMLSelectElement {
  const s = h('select', attrs, ...options.map((o) => h('option', { value: o.value, selected: o.value === value }, o.label)));
  s.value = value;
  s.addEventListener('change', () => onChange(s.value as T));
  return s;
}

export function field(label: string, control: HTMLElement): HTMLElement {
  const id = control.id || `f-${Math.random().toString(36).slice(2, 8)}`;
  control.id = id;
  return h('div', { class: 'field' }, h('label', { for: id }, label), control);
}

export function kitSwatch(k: { shirt: string; shorts: string; socks: string }): HTMLElement {
  return h('span', { class: 'kit', 'aria-hidden': 'true' }, h('i', { style: { background: k.shirt } }), h('i', { style: { background: k.shorts } }), h('i', { style: { background: k.socks } }));
}

export function posGroup(pos: string): 'GK' | 'DEF' | 'MID' | 'ATT' {
  if (pos === 'GK') return 'GK';
  if (['CB', 'LB', 'RB', 'LWB', 'RWB'].includes(pos)) return 'DEF';
  if (['CDM', 'CM', 'CAM', 'LM', 'RM'].includes(pos)) return 'MID';
  return 'ATT';
}

export function starsText(n: number): string {
  const full = Math.floor(n);
  return '★'.repeat(full) + (n - full >= 0.5 ? '½' : '') + '☆'.repeat(Math.max(0, 5 - Math.ceil(n)));
}
