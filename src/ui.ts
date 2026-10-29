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

type NumericKey = 'elevation' | 'distance' | 'softness' | 'angle' | 'opacity' | 'layers';

interface Spec {
  label: string;
  min: number; // slider range, in UI units; typed values may go past `max`
  max: number;
  unit: string;
  scale: number; // UI units per param unit (% fields store fractions)
}

const SPECS: Record<NumericKey, Spec> = {
  elevation: { label: 'Elevation', min: 0, max: 128, unit: 'px', scale: 1 },
  distance: { label: 'Distance', min: 0, max: 200, unit: '%', scale: 100 },
  softness: { label: 'Softness', min: 0, max: 300, unit: '%', scale: 100 },
  angle: { label: 'Direction', min: 0, max: 359, unit: '°', scale: 1 },
  opacity: { label: 'Opacity', min: 0, max: 100, unit: '%', scale: 100 },
  layers: { label: 'Shadows', min: 1, max: MAX_LAYERS, unit: '', scale: 1 },
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
let selection: SelectionState = { total: 0, capable: 0, managed: 0, params: null, replaces: 0, styled: 0 };
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

function toUi(key: NumericKey, value: number) {
  return Math.round(value * SPECS[key].scale);
}

function fromUi(key: NumericKey, value: number) {
  return value / SPECS[key].scale;
}

function buildSlider(row: HTMLElement) {
  const key = row.dataset.slider as NumericKey;
  const spec = SPECS[key];
  row.innerHTML = `
    <label>${spec.label}</label>
    <div class="track">${key === 'angle' ? '<div class="dial" id="dial"><div class="needle"></div></div>' : ''}
      <input type="range" min="${spec.min}" max="${spec.max}" step="1" aria-label="${spec.label}">
    </div>
    <div class="field"><input type="text" inputmode="decimal" aria-label="${spec.label} value"><span class="unit">${spec.unit}</span></div>`;
  const range = row.querySelector<HTMLInputElement>('input[type="range"]')!;
  const input = row.querySelector<HTMLInputElement>('.field input')!;
  sliders.set(key, { range, input });

  range.addEventListener('pointerdown', () => (dragging = true));
  range.addEventListener('input', () => set({ [key]: fromUi(key, range.valueAsNumber) }, false));
  range.addEventListener('change', () => set({ [key]: fromUi(key, range.valueAsNumber) }, true));

  const commitTyped = () => {
    const value = parseFloat(input.value);
    if (Number.isFinite(value)) set({ [key]: fromUi(key, value) }, true);
    else render();
  };
  input.addEventListener('change', commitTyped);
  input.addEventListener('focus', () => input.select());
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') input.blur();
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const step = (event.shiftKey ? 10 : 1) * (event.key === 'ArrowUp' ? 1 : -1);
    set({ [key]: fromUi(key, toUi(key, params[key]) + step) }, true);
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
    const value = toUi(key, params[key]);
    range.value = String(value);
    range.style.setProperty('--p', `${Math.min(100, Math.max(0, ((value - spec.min) / (spec.max - spec.min)) * 100))}%`);
    if (document.activeElement !== input) input.value = String(value);
  }
  dial.querySelector<HTMLElement>('.needle')!.style.transform = `rotate(${params.angle}deg)`;

  color.value = params.color;
  $('swatch').style.background = params.color;
  if (document.activeElement !== hex) hex.value = params.color.slice(1).toUpperCase();
  blend.value = params.blendMode;

  const shadow = $('shadow');
  shadow.style.boxShadow = toCss(params);
  shadow.style.mixBlendMode = CSS_BLEND[params.blendMode];

  const layers = computeLayers(params);
  const outer = layers[layers.length - 1];
  $('readout').textContent = `${outer.x}, ${outer.y} · blur ${outer.blur}`;
  $('summary').textContent = `${plural(layers.length, 'drop shadow')} generated`;
  $('layers').innerHTML = layers
    .map((l, i) => `<tr><td>${i + 1}</td><td>${l.x}</td><td>${l.y}</td><td>${l.blur}</td><td>${(l.alpha * 100).toFixed(1)}%</td></tr>`)
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
    hint = 'Changes apply live';
    primary.textContent = 'Remove';
    primary.className = 'danger';
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
    hint = notes.length ? notes.join(', ').replace(/^./, (c) => c.toUpperCase()) : selection.capable ? '' : 'Then add a shadow to it';
    primary.textContent = 'Add shadow';
    primary.className = 'primary';
    primary.disabled = selection.capable === 0;
    more.hidden = true;
  }
  if (selection.managed) primary.disabled = false;

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
