import type { PluginMessage, SelectionState, UiMessage } from './messages';
import {
  BLEND_MODES,
  DEFAULTS,
  MAX_EFFECTS,
  MAX_SHADOWS,
  computeCopies,
  looseCopies,
  normalizeHex,
  sanitize,
  toCss,
  type ShadowBlendMode,
  type ShadowParams,
} from './shadow';

type NumericKey = 'elevation' | 'distance' | 'softness' | 'angle' | 'layers' | 'spacing';
type OpacityKey = 'startOpacity' | 'endOpacity';
type ColorKey = 'startColor' | 'endColor';

interface Spec {
  label: string;
  hint: string;
  unit: string;
  step: number; // arrow keys (Shift for 10 steps) and drag precision
  snap: number; // dragging with Shift snaps to this
  perPx: number; // change per pixel dragged
  digits: number; // decimals shown
  drag?(start: number, dx: number): number; // when dragging isn't linear
}

const SPECS: Record<NumericKey, Spec> = {
  elevation: {
    label: 'Elevation',
    hint: 'How far from the object the shadow starts, in px. 0 rests on the surface, with a tight contact shadow.',
    unit: 'px', step: 1, snap: 10, perPx: 1, digits: 0,
  },
  distance: {
    label: 'Distance',
    hint: 'How far the shadow reaches beyond the elevation gap, in px.',
    unit: 'px', step: 1, snap: 10, perPx: 1, digits: 0,
  },
  softness: {
    label: 'Softness',
    hint: 'Blur of the farthest copy, in px. Closer copies are sharper, in step with their offset.',
    unit: 'px', step: 1, snap: 10, perPx: 1, digits: 0,
  },
  angle: {
    label: 'Direction',
    hint: 'Where the shadow falls. 90° is straight down. Drag the dial to aim it.',
    unit: '°', step: 1, snap: 15, perPx: 1, digits: 0,
  },
  layers: {
    label: 'Count',
    hint: 'How many drop shadows build this shadow. 1 is one solid shadow.',
    unit: '', step: 1, snap: 1, perPx: 1 / 8, digits: 0,
  },
  // Dragged on a log scale, so 0.5× and 2× sit equally far from even.
  spacing: {
    label: 'Spacing',
    hint: 'Each gap between copies is this many times the one before. 1× is even; above 1× the gaps widen towards the far end, below 1× towards the object.',
    unit: '×', step: 0.05, snap: 0.25, perPx: 0, digits: 2,
    drag: (start, dx) => start * 2 ** (dx / 100),
  },
};

const OPACITY: Spec = { label: '', hint: '', unit: '%', step: 1, snap: 10, perPx: 0.5, digits: 0 };

// Chromium has no plus-darker, so the preview shows Plus darker as multiply.
const CSS_BLEND: Record<ShadowBlendMode, string> = {
  NORMAL: 'normal',
  DARKEN: 'darken',
  MULTIPLY: 'multiply',
  LINEAR_BURN: 'multiply',
  COLOR_BURN: 'color-burn',
  LIGHTEN: 'lighten',
  SCREEN: 'screen',
  LINEAR_DODGE: 'plus-lighter',
  COLOR_DODGE: 'color-dodge',
  OVERLAY: 'overlay',
  SOFT_LIGHT: 'soft-light',
  HARD_LIGHT: 'hard-light',
  DIFFERENCE: 'difference',
  EXCLUSION: 'exclusion',
  HUE: 'hue',
  SATURATION: 'saturation',
  COLOR: 'color',
  LUMINOSITY: 'luminosity',
};

let shadows: ShadowParams[] = [{ ...DEFAULTS }];
let active = 0; // the shadow the controls edit
let selection: SelectionState = { total: 0, capable: 0, managed: 0, shadows: null, replaces: 0, styled: 0, mergeBlocker: null };
let dragging = false;

const current = () => shadows[active];
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function send(message: UiMessage) {
  parent.postMessage({ pluginMessage: message }, '*');
}

// --- Edits -----------------------------------------------------------------------------

let pending: { index: number; patch: Partial<ShadowParams> } | null = null;
let frame = 0;
let rememberTimer: ReturnType<typeof setTimeout> | undefined;

function remember() {
  clearTimeout(rememberTimer);
  rememberTimer = setTimeout(() => send({ type: 'remember', shadows }), 400);
}

/** Applies an edit to the active shadow locally, and live to the selection's. Drags stream at
 *  frame rate; `commit` closes one undo step (slider released, value typed). */
function set(patch: Partial<ShadowParams>, commit: boolean) {
  shadows[active] = sanitize({ ...current(), ...patch });
  const clean: Partial<ShadowParams> = {};
  for (const key of Object.keys(patch) as (keyof ShadowParams)[]) {
    (clean as Record<string, unknown>)[key] = current()[key];
  }
  render();
  remember();

  if (!selection.managed) return;
  if (pending && pending.index !== active) settle();
  pending = { index: active, patch: { ...pending?.patch, ...clean } };
  if (commit) settle();
  else if (!frame) {
    frame = requestAnimationFrame(() => {
      frame = 0;
      flush(false);
    });
  }
}

function flush(commit: boolean) {
  if (pending || commit) send({ type: 'update', index: pending?.index ?? active, patch: pending?.patch ?? {}, commit });
  pending = null;
}

/** Sends what's pending as one finished undo step. */
function settle() {
  if (!pending) return;
  cancelAnimationFrame(frame);
  frame = 0;
  flush(true);
}

function select(index: number) {
  settle();
  active = Math.max(0, Math.min(index, shadows.length - 1));
  render();
}

function insertShadow() {
  if (shadows.length >= MAX_SHADOWS) return;
  settle();
  const params = { ...current() };
  shadows.splice(active + 1, 0, params);
  active++;
  if (selection.managed) send({ type: 'insert', index: active, params });
  remember();
  render();
}

function deleteShadow(index: number) {
  if (shadows.length <= 1) return;
  settle();
  shadows.splice(index, 1);
  if (active > index || active >= shadows.length) active--;
  if (selection.managed) send({ type: 'delete', index });
  remember();
  render();
}

// --- Controls --------------------------------------------------------------------------

interface NumberControl {
  input: HTMLInputElement;
  spec: Spec;
  get(): number;
  off?(): boolean;
}

const numbers: NumberControl[] = [];
const roundTo = (value: number, step: number) => Math.round(value / step) * step;

/** A number field: type a value, nudge it with the arrow keys (Shift for 10 steps), or drag
 *  sideways anywhere on the field (Shift snaps). A click without a drag starts typing. */
function numberField(field: HTMLElement, spec: Spec, name: string, get: () => number, put: (value: number, commit: boolean) => void, off?: () => boolean, lead = '') {
  const shift = spec.snap !== spec.step ? ` Drag sideways to change it, Shift for steps of ${spec.snap}${spec.unit}.` : ' Drag sideways to change it.';
  field.title = spec.hint ? spec.hint + shift : shift.trim();
  field.innerHTML = `${lead}${spec.label ? `<span class="label">${spec.label}</span>` : ''}<input type="text" inputmode="decimal" aria-label="${name}"><span class="unit">${spec.unit}</span>`;
  const input = field.querySelector('input')!;
  numbers.push({ input, spec, get, off });

  input.addEventListener('focus', () => input.select());
  input.addEventListener('change', () => {
    const value = parseFloat(input.value);
    if (Number.isFinite(value)) put(value, true);
    else render();
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') input.blur();
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const delta = spec.step * (event.shiftKey ? 10 : 1) * (event.key === 'ArrowUp' ? 1 : -1);
    put(roundTo(get() + delta, spec.step), true);
    input.value = get().toFixed(spec.digits); // render() leaves the focused field alone
    input.select();
  });

  let start: { x: number; value: number; moved: boolean } | null = null;
  field.addEventListener('pointerdown', (event) => {
    if (document.activeElement === input || (event.target as HTMLElement).closest('.dial')) return;
    event.preventDefault();
    start = { x: event.clientX, value: get(), moved: false };
    dragging = true;
    try {
      field.setPointerCapture(event.pointerId); // keeps the drag going outside the field
    } catch {
      // ignore
    }
  });
  field.addEventListener('pointermove', (event) => {
    if (!start) return;
    const dx = event.clientX - start.x;
    if (!start.moved && Math.abs(dx) < 3) return;
    start.moved = true;
    const raw = spec.drag ? spec.drag(start.value, dx) : start.value + dx * spec.perPx;
    put(roundTo(raw, event.shiftKey ? spec.snap : spec.step), false);
  });
  field.addEventListener('pointerup', () => {
    if (start?.moved) put(get(), true);
    else if (start) input.focus();
    start = null;
  });
  field.addEventListener('pointercancel', () => (start = null));
}

document.querySelectorAll<HTMLElement>('[data-num]').forEach((field) => {
  const key = field.dataset.num as NumericKey;
  const spec = SPECS[key];
  const dial = key === 'angle' ? '<span class="dial" id="dial"><span class="needle"></span></span>' : '';
  numberField(field, spec, spec.label, () => current()[key], (value, commit) => set({ [key]: value }, commit), undefined, dial);
});

document.querySelectorAll<HTMLElement>('[data-opacity]').forEach((field) => {
  const key = field.dataset.opacity as OpacityKey;
  numberField(
    field,
    OPACITY,
    key === 'startOpacity' ? 'Start opacity' : 'End opacity',
    () => current()[key] * 100,
    (value, commit) => set({ [key]: value / 100 }, commit),
    key === 'endOpacity' ? () => current().layers === 1 : undefined,
  );
});

const colorFields = new Map<ColorKey, { field: HTMLElement; picker: HTMLInputElement; swatch: HTMLElement; hex: HTMLInputElement }>();

function buildColor(field: HTMLElement) {
  const key = field.dataset.color as ColorKey;
  const label = key === 'startColor' ? 'Start color' : 'End color';
  field.innerHTML = `<span class="swatch"><input type="color" aria-label="${label}"></span><input type="text" spellcheck="false" maxlength="7" aria-label="${label}, hex">`;
  const picker = field.querySelector<HTMLInputElement>('input[type="color"]')!;
  const hex = field.querySelector<HTMLInputElement>('input[type="text"]')!;
  colorFields.set(key, { field, picker, swatch: field.querySelector('.swatch')!, hex });

  picker.addEventListener('input', () => set({ [key]: picker.value }, false));
  picker.addEventListener('change', () => set({ [key]: picker.value }, true));
  hex.addEventListener('focus', () => hex.select());
  hex.addEventListener('keydown', (event) => event.key === 'Enter' && hex.blur());
  hex.addEventListener('change', () => {
    const value = normalizeHex(hex.value);
    if (value) set({ [key]: value }, true);
    else render();
  });
}

document.querySelectorAll<HTMLElement>('[data-color]').forEach(buildColor);

// Direction dial: drag to aim the shadow, Shift snaps to 15°.
const dial = $<HTMLSpanElement>('dial');
function aim(event: PointerEvent, commit: boolean) {
  const box = dial.getBoundingClientRect();
  const deg = (Math.atan2(event.clientY - box.top - box.height / 2, event.clientX - box.left - box.width / 2) * 180) / Math.PI;
  const angle = event.shiftKey ? Math.round(deg / 15) * 15 : Math.round(deg);
  set({ angle }, commit);
}
dial.addEventListener('pointerdown', (event) => {
  dragging = true;
  try {
    dial.setPointerCapture(event.pointerId);
  } catch {
    // ignore
  }
  aim(event, false);
});
dial.addEventListener('pointermove', (event) => {
  if (dial.hasPointerCapture(event.pointerId)) aim(event, false);
});
dial.addEventListener('pointerup', (event) => aim(event, true));
window.addEventListener('pointerup', () => (dragging = false));

const blend = $<HTMLSelectElement>('blend');
blend.innerHTML = BLEND_MODES.map(([mode, name]) => `<option value="${mode}">${name}</option>`).join('');
blend.addEventListener('change', () => set({ blendMode: blend.value as ShadowBlendMode }, true));

const merge = $<HTMLInputElement>('merge');
merge.addEventListener('change', () => set({ merge: merge.checked }, true));

$('add-shadow').addEventListener('click', insertShadow);
$('shadows').addEventListener('click', (event) => {
  const target = event.target as HTMLElement;
  const remove = target.closest<HTMLElement>('[data-remove]');
  if (remove) deleteShadow(Number(remove.dataset.remove));
  else {
    const row = target.closest<HTMLElement>('.shadow-row');
    if (row) select(Number(row.dataset.index));
  }
});

$('primary').addEventListener('click', () => {
  settle();
  if (selection.managed) send({ type: 'remove' });
  else send({ type: 'add', shadows });
});
$('more').addEventListener('click', () => send({ type: 'add', shadows }));

// --- Render ----------------------------------------------------------------------------

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

const previews: HTMLDivElement[] = [];

/** One element per shadow under the card. Like in Figma, shadows left as effects draw above
 *  the merged layers, and within each kind the first shadow draws on top. */
function renderPreview() {
  const stage = $('stage');
  const card = stage.querySelector('.card')!;
  while (previews.length < shadows.length) previews.push(document.createElement('div'));
  previews.splice(shadows.length).forEach((el) => el.remove());
  const order = [...shadows.keys()].reverse().sort((a, b) => Number(shadows[b].merge) - Number(shadows[a].merge));
  order.forEach((index, i) => {
    const params = shadows[index];
    const el = previews[i];
    el.className = 'shadow';
    el.style.boxShadow = toCss(params);
    el.style.mixBlendMode = CSS_BLEND[params.blendMode];
    el.style.opacity = String(computeCopies(params).opacity);
    stage.insertBefore(el, card);
  });
}

function renderList() {
  $('shadows').innerHTML = shadows
    .map(
      (s, i) => `
      <div class="shadow-row${i === active ? ' active' : ''}" data-index="${i}">
        <span class="chip" style="background: linear-gradient(135deg, ${s.startColor}, ${s.endColor})"></span>
        <span class="name">Shadow ${i + 1}</span>
        <span class="meta">${s.layers}× · ${Math.round(s.elevation + s.distance)} px${s.merge ? ' · merged' : ''}</span>
        <button class="icon" data-remove="${i}" title="Remove this shadow" aria-label="Remove shadow ${i + 1}"${shadows.length === 1 ? ' disabled' : ''}>−</button>
      </div>`,
    )
    .join('');
  $<HTMLButtonElement>('add-shadow').disabled = shadows.length >= MAX_SHADOWS;
}

/** Figma keeps 8 drop shadows per layer; the rest go on a layer below, if the object can have one. */
function effectsNote(): string {
  const extra = looseCopies(shadows) - MAX_EFFECTS;
  if (extra <= 0) return '';
  if (selection.mergeBlocker) {
    return `Figma keeps ${MAX_EFFECTS} drop shadows per layer and this one can't be grouped with more, so the bottom ${extra === 1 ? 'copy is' : `${extra} copies are`} left out.`;
  }
  return `Figma keeps ${MAX_EFFECTS} drop shadows per layer. The other ${extra === 1 ? 'copy goes' : `${extra} copies go`} on a layer below, grouped with the object.`;
}

function toneNote(p: ShadowParams): string {
  if (p.layers === 1) return 'One copy: only Start applies.';
  if (p.startOpacity < p.endOpacity - 0.005) return "Start can't be lighter than End: every copy covers the area next to the object, so it levels out at End.";
  if (!p.merge && Math.abs(p.startOpacity - p.endOpacity) < 0.005) return 'Even strength as effects is the farthest copy alone. Merge keeps every copy.';
  return '';
}

function render() {
  const p = current();
  for (const { input, spec, get, off } of numbers) {
    if (document.activeElement !== input) input.value = get().toFixed(spec.digits);
    input.parentElement!.classList.toggle('off', off?.() ?? false);
  }
  dial.querySelector<HTMLElement>('.needle')!.style.transform = `rotate(${p.angle}deg)`;

  for (const [key, { field, picker, swatch, hex }] of colorFields) {
    picker.value = p[key];
    swatch.style.background = p[key];
    if (document.activeElement !== hex) hex.value = p[key].slice(1).toUpperCase();
    field.classList.toggle('off', key === 'endColor' && p.layers === 1);
  }
  $('tone-note').textContent = toneNote(p);
  blend.value = p.blendMode;

  const blocked = selection.mergeBlocker && !p.merge ? selection.mergeBlocker : null;
  merge.checked = p.merge;
  merge.disabled = blocked !== null;
  $('merge-note').textContent = blocked ?? '';

  renderList();
  $('effects-note').textContent = effectsNote();
  renderPreview();

  const { copies, opacity } = computeCopies(p);
  const outer = copies[copies.length - 1];
  $('readout').textContent = `${outer.x}, ${outer.y} · blur ${outer.blur}`;

  const reach = p.elevation + p.distance;
  const at = (offset: number) => `${reach > 0 ? (offset / reach) * 100 : 0}%`;
  $('strip').innerHTML =
    `<div class="gap" style="width:${at(p.elevation)}"></div>` +
    copies.map((l) => `<div class="tick" style="left:${at(l.offset)}; background:${l.color}"></div>`).join('');

  $('summary').textContent = p.merge
    ? `${plural(copies.length, 'drop shadow')} on a layer at ${Math.round(opacity * 100)}%`
    : `${plural(copies.length, 'drop shadow')} generated`;
  $('layers').innerHTML = copies
    .map(
      (l, i) =>
        `<tr><td><span class="dot" style="background:${l.color}"></span>${i + 1}</td><td>${l.x}</td><td>${l.y}</td><td>${l.blur}</td><td>${(l.alpha * 100).toFixed(1)}%</td></tr>`,
    )
    .join('');

  renderFooter();
  fit();
}

// The window follows the content's height, so the panel doesn't scroll (up to the plugin's
// limit, see code.ts).
let sentHeight = 0;
let fitQueued = false;
function fit() {
  if (fitQueued) return;
  fitQueued = true;
  queueMicrotask(() => {
    fitQueued = false;
    const height = Math.ceil($('content').offsetHeight + document.querySelector('footer')!.offsetHeight);
    if (height === sentHeight) return;
    sentHeight = height;
    send({ type: 'resize', height });
  });
}
$('details').addEventListener('toggle', fit);

function renderFooter() {
  const status = $('status');
  const primary = $<HTMLButtonElement>('primary');
  const more = $<HTMLButtonElement>('more');
  const unmanaged = selection.capable - selection.managed;
  const anyMerged = shadows.some((s) => s.merge);
  const layered = anyMerged || looseCopies(shadows) > MAX_EFFECTS;
  let title: string;
  let hint = '';

  if (selection.managed) {
    title = `Editing ${plural(selection.managed, 'layer')}`;
    hint = anyMerged ? 'Merged · changes apply live' : 'Changes apply live';
    primary.textContent = 'Remove';
    primary.className = 'danger';
    primary.disabled = false;
    more.hidden = unmanaged === 0;
    more.textContent = `Add to ${unmanaged} more`;
  } else {
    title = selection.capable
      ? `${plural(selection.capable, 'layer')} selected`
      : selection.total
        ? "Selection can't have effects"
        : 'Select a layer';
    const notes: string[] = [];
    if (selection.replaces) notes.push(`replaces ${plural(selection.replaces, 'drop shadow')}`);
    if (selection.styled) notes.push('detaches effect style');
    if (layered && selection.capable && !selection.mergeBlocker) notes.push('groups it with a shadow layer');
    hint = notes.length ? notes.join(', ').replace(/^./, (c) => c.toUpperCase()) : selection.capable ? '' : 'Then add a shadow to it';
    primary.textContent = shadows.length > 1 ? `Add ${shadows.length} shadows` : 'Add shadow';
    primary.className = 'primary';
    primary.disabled = selection.capable === 0;
    more.hidden = true;
  }

  status.classList.toggle('live', selection.managed > 0);
  status.querySelector('strong')!.textContent = title;
  status.querySelector('small')!.textContent = hint;
}

window.addEventListener('message', (event: MessageEvent) => {
  const message = event.data && (event.data.pluginMessage as PluginMessage | undefined);
  if (!message) return;
  if (message.type === 'init') {
    if (message.last) shadows = message.last;
  } else if (message.type === 'selection') {
    selection = message;
    if (message.shadows && !dragging) shadows = message.shadows;
  }
  active = Math.min(active, shadows.length - 1);
  render();
});

render();
send({ type: 'ready' });
