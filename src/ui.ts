import type { PluginMessage, SelectionState, UiMessage } from './messages';
import {
  BLEND_MODES,
  DEFAULTS,
  MAX_LAYERS,
  computeLayers,
  normalizeHex,
  sanitize,
  toCss,
  type ShadowBlendMode,
  type ShadowParams,
} from './shadow';

type NumericKey = 'elevation' | 'distance' | 'softness' | 'angle' | 'opacity' | 'layers' | 'spacing';

interface Spec {
  label: string;
  hint: string;
  min: number; // slider range, in slider units; typed values may go past `max`
  max: number;
  unit: string;
  nudge: number; // arrow-key step, in field units
  toRange(value: number): number;
  fromRange(value: number): number;
  toField(value: number): string;
  fromField(value: number): number;
}

const linear = (scale: number) => ({
  toRange: (v: number) => Math.round(v * scale),
  fromRange: (n: number) => n / scale,
  toField: (v: number) => String(Math.round(v * scale)),
  fromField: (n: number) => n / scale,
});

const SPECS: Record<NumericKey, Spec> = {
  elevation: {
    label: 'Elevation',
    hint: 'How far from the object the shadow starts. 0 rests on the surface, with a tight contact shadow.',
    min: 0, max: 64, unit: 'px', nudge: 1, ...linear(1),
  },
  distance: {
    label: 'Distance',
    hint: 'How far the shadow reaches beyond the elevation gap.',
    min: 0, max: 128, unit: 'px', nudge: 1, ...linear(1),
  },
  softness: {
    label: 'Softness',
    hint: 'Blur of the farthest copy. Closer copies are sharper, in step with their offset.',
    min: 0, max: 160, unit: 'px', nudge: 1, ...linear(1),
  },
  angle: {
    label: 'Direction',
    hint: 'Where the shadow falls. 90° is straight down; hold Shift on the dial to snap to 15°.',
    min: 0, max: 359, unit: '°', nudge: 1, ...linear(1),
  },
  opacity: {
    label: 'Opacity',
    hint: 'Strength of the whole shadow.',
    min: 0, max: 100, unit: '%', nudge: 1, ...linear(100),
  },
  layers: {
    label: 'Count',
    hint: 'How many drop shadows build the shadow. 1 is one solid shadow.',
    min: 1, max: MAX_LAYERS, unit: '', nudge: 1, ...linear(1),
  },
  // The slider runs on log2 so 0.5× and 2× sit equally far from even.
  spacing: {
    label: 'Spacing',
    hint: 'Each gap between copies is this many times the one before. 1× is even; above 1× the gaps widen towards the far end, below 1× towards the object.',
    min: -200, max: 200, unit: '×', nudge: 0.1,
    toRange: (v) => Math.round(Math.log2(v) * 100),
    fromRange: (n) => (Math.abs(n) < 6 ? 1 : 2 ** (n / 100)),
    toField: (v) => v.toFixed(2),
    fromField: (n) => n,
  },
};

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

let params: ShadowParams = { ...DEFAULTS };
let selection: SelectionState = { total: 0, capable: 0, managed: 0, params: null, replaces: 0, styled: 0, mergeBlocker: null };
let dragging = false;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function send(message: UiMessage) {
  parent.postMessage({ pluginMessage: message }, '*');
}

// --- Edits -----------------------------------------------------------------------------

let pending: Partial<ShadowParams> | null = null;
let frame = 0;
let rememberTimer: ReturnType<typeof setTimeout> | undefined;

/** Applies an edit locally, and live to the selection's shadows. Drags stream at frame rate;
 *  `commit` closes one undo step (slider released, value typed). */
function set(patch: Partial<ShadowParams>, commit: boolean) {
  params = sanitize({ ...params, ...patch });
  const clean: Partial<ShadowParams> = {};
  for (const key of Object.keys(patch) as (keyof ShadowParams)[]) {
    (clean as Record<string, unknown>)[key] = params[key];
  }
  render();

  clearTimeout(rememberTimer);
  rememberTimer = setTimeout(() => send({ type: 'remember', params }), 400);

  if (!selection.managed) return;
  pending = { ...pending, ...clean };
  if (commit) {
    cancelAnimationFrame(frame);
    frame = 0;
    flush(true);
  } else if (!frame) {
    frame = requestAnimationFrame(() => {
      frame = 0;
      flush(false);
    });
  }
}

function flush(commit: boolean) {
  if (pending || commit) send({ type: 'update', patch: pending ?? {}, commit });
  pending = null;
}

// --- Controls --------------------------------------------------------------------------

const sliders = new Map<NumericKey, { range: HTMLInputElement; input: HTMLInputElement }>();

function buildSlider(row: HTMLElement) {
  const key = row.dataset.slider as NumericKey;
  const spec = SPECS[key];
  row.innerHTML = `
    <label title="${spec.hint}">${spec.label}</label>
    <div class="track">${key === 'angle' ? '<div class="dial" id="dial"><div class="needle"></div></div>' : ''}
      <input type="range" min="${spec.min}" max="${spec.max}" step="1" aria-label="${spec.label}">
    </div>
    <div class="field" title="${spec.hint}"><input type="text" inputmode="decimal" aria-label="${spec.label} value"><span class="unit">${spec.unit}</span></div>`;
  const range = row.querySelector<HTMLInputElement>('input[type="range"]')!;
  const input = row.querySelector<HTMLInputElement>('.field input')!;
  sliders.set(key, { range, input });

  range.addEventListener('pointerdown', () => (dragging = true));
  range.addEventListener('input', () => set({ [key]: spec.fromRange(range.valueAsNumber) }, false));
  range.addEventListener('change', () => set({ [key]: spec.fromRange(range.valueAsNumber) }, true));

  input.addEventListener('change', () => {
    const value = parseFloat(input.value);
    if (Number.isFinite(value)) set({ [key]: spec.fromField(value) }, true);
    else render();
  });
  input.addEventListener('focus', () => input.select());
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') input.blur();
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const step = spec.nudge * (event.shiftKey ? 10 : 1) * (event.key === 'ArrowUp' ? 1 : -1);
    set({ [key]: spec.fromField(parseFloat(spec.toField(params[key])) + step) }, true);
  });
}

document.querySelectorAll<HTMLElement>('[data-slider]').forEach(buildSlider);

// Direction dial: drag to aim the shadow, shift snaps to 15°.
const dial = $<HTMLDivElement>('dial');
function aim(event: PointerEvent, commit: boolean) {
  const box = dial.getBoundingClientRect();
  const deg = (Math.atan2(event.clientY - box.top - box.height / 2, event.clientX - box.left - box.width / 2) * 180) / Math.PI;
  const angle = event.shiftKey ? Math.round(deg / 15) * 15 : Math.round(deg);
  set({ angle }, commit);
}
dial.addEventListener('pointerdown', (event) => {
  dragging = true;
  dial.setPointerCapture(event.pointerId);
  aim(event, false);
});
dial.addEventListener('pointermove', (event) => {
  if (dial.hasPointerCapture(event.pointerId)) aim(event, false);
});
dial.addEventListener('pointerup', (event) => aim(event, true));
window.addEventListener('pointerup', () => (dragging = false));

const color = $<HTMLInputElement>('color');
const hex = $<HTMLInputElement>('hex');
color.addEventListener('input', () => set({ color: color.value }, false));
color.addEventListener('change', () => set({ color: color.value }, true));
hex.addEventListener('focus', () => hex.select());
hex.addEventListener('keydown', (event) => event.key === 'Enter' && hex.blur());
hex.addEventListener('change', () => {
  const value = normalizeHex(hex.value);
  if (value) set({ color: value }, true);
  else render();
});

const blend = $<HTMLSelectElement>('blend');
blend.innerHTML = BLEND_MODES.map(([mode, name]) => `<option value="${mode}">${name}</option>`).join('');
blend.addEventListener('change', () => set({ blendMode: blend.value as ShadowBlendMode }, true));

const merge = $<HTMLInputElement>('merge');
merge.addEventListener('change', () => set({ merge: merge.checked }, true));

$('primary').addEventListener('click', () => {
  if (selection.managed) send({ type: 'remove' });
  else send({ type: 'add', params });
});
$('more').addEventListener('click', () => send({ type: 'add', params }));

// --- Render ----------------------------------------------------------------------------

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function render() {
  for (const [key, { range, input }] of sliders) {
    const spec = SPECS[key];
    const value = spec.toRange(params[key]);
    range.value = String(value);
    range.style.setProperty('--p', `${Math.min(100, Math.max(0, ((value - spec.min) / (spec.max - spec.min)) * 100))}%`);
    if (document.activeElement !== input) input.value = spec.toField(params[key]);
  }
  dial.querySelector<HTMLElement>('.needle')!.style.transform = `rotate(${params.angle}deg)`;

  color.value = params.color;
  $('swatch').style.background = params.color;
  if (document.activeElement !== hex) hex.value = params.color.slice(1).toUpperCase();
  blend.value = params.blendMode;

  const blocked = selection.mergeBlocker && !params.merge ? selection.mergeBlocker : null;
  merge.checked = params.merge;
  merge.disabled = blocked !== null;
  $('merge-note').textContent = blocked ?? (params.merge ? 'One shadow layer, grouped with the object' : 'Copies stay separate drop shadows');

  const layers = computeLayers(params);
  const shadow = $('shadow');
  shadow.style.boxShadow = toCss(params);
  shadow.style.mixBlendMode = CSS_BLEND[params.blendMode];
  shadow.style.opacity = params.merge ? String(params.opacity) : '1';

  const outer = layers[layers.length - 1];
  $('readout').textContent = `${outer.x}, ${outer.y} · blur ${outer.blur}`;

  const reach = params.elevation + params.distance;
  const at = (offset: number) => `${reach > 0 ? (offset / reach) * 100 : 0}%`;
  $('strip').innerHTML =
    `<div class="gap" style="width:${at(params.elevation)}"></div>` +
    layers.map((l) => `<div class="tick" style="left:${at(l.offset)}"></div>`).join('');

  $('summary').textContent = params.merge
    ? `${plural(layers.length, 'drop shadow')}, merged at ${Math.round(params.opacity * 100)}%`
    : `${plural(layers.length, 'drop shadow')} generated`;
  $('layers').innerHTML = layers
    .map((l, i) => {
      const alpha = params.merge ? 'solid' : `${(l.alpha * 100).toFixed(1)}%`;
      return `<tr><td>${i + 1}</td><td>${l.x}</td><td>${l.y}</td><td>${l.blur}</td><td>${alpha}</td></tr>`;
    })
    .join('');

  renderFooter();
}

function renderFooter() {
  const status = $('status');
  const primary = $<HTMLButtonElement>('primary');
  const more = $<HTMLButtonElement>('more');
  const unmanaged = selection.capable - selection.managed;
  let title: string;
  let hint = '';

  if (selection.managed) {
    title = `Editing ${plural(selection.managed, 'shadow')}`;
    hint = params.merge ? 'Merged · changes apply live' : 'Changes apply live';
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
    if (params.merge && selection.capable) notes.push('groups it with a shadow layer');
    hint = notes.length ? notes.join(', ').replace(/^./, (c) => c.toUpperCase()) : selection.capable ? '' : 'Then add a shadow to it';
    primary.textContent = 'Add shadow';
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
    if (message.last) params = message.last;
  } else if (message.type === 'selection') {
    selection = message;
    if (message.params && !dragging) params = message.params;
  }
  render();
});

render();
send({ type: 'ready' });
