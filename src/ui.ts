import type { PluginMessage, SelectionState, UiMessage } from './messages';
import {
  BLEND_MODES,
  CURVE_REACH_X,
  CURVE_REACH_Y,
  DEFAULTS,
  MAX_EFFECTS,
  MAX_LIGHTS,
  MAX_SHADOWS,
  applyPatch,
  computeCopies,
  dropCopies,
  ease,
  innerCopies,
  insertAt,
  normalizeHex,
  readHandles,
  steps,
  toCss,
  type Curve,
  type CurvePoint,
  type Light,
  type ShadowBlendMode,
  type ShadowParams,
} from './shadow';

type NumericKey = 'elevation' | 'layers';
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
  // Labelled by its row, so the field has no label of its own.
  elevation: {
    label: '',
    hint: "How far the object floats: the gap before the shadow starts, in px. It's the object's, so every light shares it. 0 rests on the surface, with a tight contact shadow.",
    unit: 'px', step: 1, snap: 10, perPx: 1, digits: 0,
  },
  layers: {
    label: 'Count',
    hint: 'How many copies build this shadow, per light, up to 32. 1 is one solid shadow. Past 8 copies on a layer, Figma needs a shadow layer for them.',
    unit: '', step: 1, snap: 4, perPx: 1 / 6, digits: 0,
  },
};

const OPACITY: Spec = { label: '', hint: '', unit: '%', step: 1, snap: 10, perPx: 0.5, digits: 0 };

// A light's settings sit in a row under column heads, so their fields have no labels.
const DIRECTION: Spec = {
  label: '',
  hint: 'Where the shadow falls, away from this light. 90° is straight down. Drag the dial, or the light on the preview.',
  unit: '°', step: 1, snap: 15, perPx: 1, digits: 0,
};

const DISTANCE: Spec = {
  label: '',
  hint: "How far this light casts the shadow beyond the elevation gap, in px. On the preview, the further a light sits from the card's center, the longer its shadow.",
  unit: 'px', step: 1, snap: 10, perPx: 1, digits: 0,
};

const SOFTNESS: Spec = {
  label: '',
  hint: "Blur of this light's copies where the shadow starts (Start) and at its far end (End), in px. The Blur curve runs between them.",
  unit: 'px', step: 1, snap: 10, perPx: 1, digits: 0,
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

let shadows: ShadowParams[] = [{ ...DEFAULTS }];
let active = 0; // the shadow the controls edit
let clipboard: ShadowParams[] = []; // copied shadows, kept by the plugin across files
let selection: SelectionState = { total: 0, capable: 0, managed: 0, shadows: null, replaces: 0, styled: 0, groupBlocker: null };
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

/** Applies an edit to the active shadow locally (and to the shadows linked to it), and live to
 *  the selection's. Drags stream at frame rate; `commit` closes one undo step (drag released,
 *  value typed). */
function set(patch: Partial<ShadowParams>, commit: boolean) {
  shadows = applyPatch(shadows, active, patch);
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
  const params = { ...current(), visible: true };
  shadows = insertAt(shadows, active + 1, params);
  active++;
  if (selection.managed) send({ type: 'insert', index: active, params });
  remember();
  render();
}

/** Shows or hides a shadow: hidden, it keeps its settings but isn't drawn. */
function toggleShadow(index: number) {
  settle();
  shadows = applyPatch(shadows, index, { visible: !shadows[index].visible });
  if (selection.managed) send({ type: 'update', index, patch: { visible: shadows[index].visible }, commit: true });
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
  field: HTMLElement;
  input: HTMLInputElement;
  spec: Spec;
  get(): number | null;
  off?(): boolean;
}

interface FieldOptions {
  off?(): boolean; // greyed out
  lead?: string; // markup before the label
  trail?: string; // markup after the unit
  auto?(): number; // the field can be Auto (null); drags and arrows start from this
}

const numbers: NumberControl[] = [];
const roundTo = (value: number, step: number) => Math.round(value / step) * step;
const format = (value: number | null, spec: Spec) => (value === null ? 'Auto' : value.toFixed(spec.digits));

/** A number field: type a value, nudge it with the arrow keys (Shift for 10 steps), or drag
 *  sideways anywhere on the field (Shift snaps). A click without a drag starts typing. */
function numberField(field: HTMLElement, spec: Spec, name: string, get: () => number | null, put: (value: number | null, commit: boolean) => void, options: FieldOptions = {}) {
  const shift = spec.snap !== spec.step ? ` Drag sideways to change it, Shift for steps of ${spec.snap}${spec.unit}.` : ' Drag sideways to change it.';
  field.title = spec.hint ? spec.hint + shift : shift.trim();
  field.innerHTML = `${options.lead ?? ''}${spec.label ? `<span class="label">${spec.label}</span>` : ''}<input type="text" inputmode="decimal" aria-label="${name}"><span class="unit">${spec.unit}</span>${options.trail ?? ''}`;
  const input = field.querySelector('input')!;
  numbers.push({ field, input, spec, get, off: options.off });
  const value = () => get() ?? options.auto?.() ?? 0;

  input.addEventListener('focus', () => input.select());
  input.addEventListener('change', () => {
    const text = input.value.trim();
    const number = parseFloat(text);
    if (options.auto && (text === '' || /^a/i.test(text))) put(null, true);
    else if (Number.isFinite(number)) put(number, true);
    else render();
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') input.blur();
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const delta = spec.step * (event.shiftKey ? 10 : 1) * (event.key === 'ArrowUp' ? 1 : -1);
    put(roundTo(value() + delta, spec.step), true);
    input.value = format(get(), spec); // render() leaves the focused field alone
    input.select();
  });

  let start: { x: number; value: number; moved: boolean } | null = null;
  field.addEventListener('pointerdown', (event) => {
    if (document.activeElement === input || (event.target as HTMLElement).closest('.dial')) return;
    event.preventDefault();
    start = { x: event.clientX, value: value(), moved: false };
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
    if (start?.moved) put(value(), true);
    else if (start) input.focus();
    start = null;
  });
  field.addEventListener('pointercancel', () => (start = null));
}

document.querySelectorAll<HTMLElement>('[data-num]').forEach((field) => {
  const key = field.dataset.num as NumericKey;
  const spec = SPECS[key];
  numberField(field, spec, field.dataset.name ?? spec.label, () => current()[key], (value, commit) => set({ [key]: value ?? 0 }, commit));
});

// One row per light: direction (with a dial) and distance; each light's start and end softness
// sit under Opacity. Lights past the first can be removed. They also sit on the preview, where they
// can be dragged (see "Lights on the stage").
const SUN = '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"><circle cx="5" cy="5" r="1.8"/><path d="M5 .7v1.1M5 8.2v1.1M.7 5h1.1M8.2 5h1.1M2 2l.8.8M7.2 7.2l.8.8M2 8l.8-.8M7.2 2.8l.8-.8"/></svg>';
/** A light's badge, on the preview and beside its row: a sun, numbered once there are several. */
const badge = (i: number, count: number) => (count > 1 ? String(i + 1) : SUN);

$('lights').innerHTML = Array.from(
  { length: MAX_LIGHTS },
  (_, i) => `
  <div class="light-row" data-light="${i}">
    <span class="marker"></span>
    <div class="field num scrub" data-part="angle"></div>
    <div class="field num scrub" data-part="distance"></div>
    <button class="remove" title="Remove this light" aria-label="Remove light ${i + 1}">×</button>
  </div>`,
).join('');
const lightRows = Array.from($('lights').querySelectorAll<HTMLElement>('.light-row'));
const dials: HTMLElement[] = [];

function setLight(i: number, patch: Partial<Light>, commit: boolean) {
  set({ lights: current().lights.map((l, k) => (k === i ? { ...l, ...patch } : l)) }, commit);
}

lightRows.forEach((row, i) => {
  const field = (key: keyof Light, spec: Spec, name: string, options?: FieldOptions) =>
    numberField(row.querySelector<HTMLElement>(`[data-part="${key}"]`)!, spec, `Light ${i + 1} ${name}`, () => current().lights[i]?.[key] ?? 0, (value, commit) => setLight(i, { [key]: value ?? 0 }, commit), options);
  field('angle', DIRECTION, 'direction', { lead: '<span class="dial"><span class="needle"></span></span>' });
  field('distance', DISTANCE, 'distance');

  const dial = row.querySelector<HTMLElement>('.dial')!;
  dials.push(dial);
  const aim = (event: PointerEvent, commit: boolean) => {
    const box = dial.getBoundingClientRect();
    const deg = (Math.atan2(event.clientY - box.top - box.height / 2, event.clientX - box.left - box.width / 2) * 180) / Math.PI;
    setLight(i, { angle: event.shiftKey ? Math.round(deg / 15) * 15 : Math.round(deg) }, commit);
  };
  // Drag the dial to aim the light, Shift snaps to 15°.
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
  row.querySelector('.remove')!.addEventListener('click', () => {
    const { lights } = current();
    if (lights.length > 1) set({ lights: lights.filter((_, k) => k !== i) }, true);
  });
});

// Each light's softness, start and end, in a row of its own under Opacity.
$('softness').innerHTML = Array.from(
  { length: MAX_LIGHTS },
  (_, i) => `
  <div class="pair" data-light="${i}">
    <div class="pair-label"><label title="${SOFTNESS.hint}">Softness</label><span class="marker mini"></span></div>
    <div class="field num scrub" data-part="startSoftness"></div>
    <div class="field num scrub" data-part="endSoftness"></div>
  </div>`,
).join('');
const softnessRows = Array.from($('softness').querySelectorAll<HTMLElement>('.pair'));
softnessRows.forEach((row, i) => {
  for (const key of ['startSoftness', 'endSoftness'] as const) {
    numberField(row.querySelector<HTMLElement>(`[data-part="${key}"]`)!, SOFTNESS, `Light ${i + 1} ${key === 'startSoftness' ? 'start' : 'end'} softness`, () => current().lights[i]?.[key] ?? 0, (value, commit) => setLight(i, { [key]: value ?? 0 }, commit), {
      off: key === 'startSoftness' ? () => current().layers === 1 : undefined,
    });
  }
});

$('link').addEventListener('click', () => set({ linked: !current().linked }, true));

const kind = $('kind');
kind.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLElement>('[data-kind]');
  if (button) set({ inner: button.dataset.kind === 'inner' }, true);
});

document.querySelectorAll<HTMLElement>('[data-opacity]').forEach((field) => {
  const key = field.dataset.opacity as OpacityKey;
  numberField(
    field,
    OPACITY,
    key === 'startOpacity' ? 'Start opacity' : 'End opacity',
    () => current()[key] * 100,
    (value, commit) => set({ [key]: (value ?? 0) / 100 }, commit),
    { off: key === 'endOpacity' ? () => current().layers === 1 : undefined },
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

  picker.addEventListener('input', () => setColor(key, picker.value, false));
  picker.addEventListener('change', () => setColor(key, picker.value, true));
  hex.addEventListener('focus', () => hex.select());
  hex.addEventListener('keydown', (event) => event.key === 'Enter' && hex.blur());
  hex.addEventListener('change', () => {
    const value = normalizeHex(hex.value);
    if (value) setColor(key, value, true);
    else render();
  });
}

/** Linked, start and end are one color, whichever field sets it. */
function setColor(key: ColorKey, value: string, commit: boolean) {
  set(current().colorLinked ? { startColor: value, endColor: value } : { [key]: value }, commit);
}

document.querySelectorAll<HTMLElement>('[data-color]').forEach(buildColor);
$('link-colors').addEventListener('click', () => {
  const { colorLinked, startColor } = current();
  set(colorLinked ? { colorLinked: false } : { colorLinked: true, endColor: startColor }, true);
});

window.addEventListener('pointerup', () => (dragging = false));

const blend = $<HTMLSelectElement>('blend');
blend.innerHTML = BLEND_MODES.map(([mode, name]) => `<option value="${mode}">${name}</option>`).join('');
blend.addEventListener('change', () => set({ blendMode: blend.value as ShadowBlendMode }, true));

$('add-shadow').addEventListener('click', insertShadow);
$('shadows').addEventListener('click', (event) => {
  const target = event.target as HTMLElement;
  const remove = target.closest<HTMLElement>('[data-remove]');
  const toggle = target.closest<HTMLElement>('[data-toggle]');
  if (remove) deleteShadow(Number(remove.dataset.remove));
  else if (toggle) toggleShadow(Number(toggle.dataset.toggle));
  else {
    const row = target.closest<HTMLElement>('.shadow-row');
    if (row) select(Number(row.dataset.index));
  }
});

// Copy keeps the panel's shadows; Paste puts them on every selected layer, replacing what's there,
// or into the panel when nothing is selected, ready for Add.
$('copy').addEventListener('click', () => {
  settle();
  clipboard = shadows.map((s) => ({ ...s, lights: s.lights.map((l) => ({ ...l })) }));
  send({ type: 'copy', shadows: clipboard });
  render();
});
$('paste').addEventListener('click', () => {
  if (!clipboard.length) return;
  settle();
  shadows = clipboard.map((s) => ({ ...s, lights: s.lights.map((l) => ({ ...l })) }));
  active = 0;
  if (selection.capable) send({ type: 'paste', shadows });
  remember();
  render();
});

$('primary').addEventListener('click', () => {
  settle();
  if (selection.managed) send({ type: 'remove' });
  else send({ type: 'add', shadows });
});
$('more').addEventListener('click', () => send({ type: 'add', shadows }));

// --- Curves ------------------------------------------------------------------------------
//
// One canvas shows the ramp the select picks, each a cubic Bézier through four points: its start
// and end, in the unit square (the lighter area), and two handles, which may reach past it on every
// side. Before the start and after the end the curve runs flat. A handle past the far end, or
// behind its own, is drawn where it was put but read along its line (`readHandles`), so the curve
// shown is the curve applied. Dots mark the copies (see CURVES for what each ramp's axes mean).
//
// A press near a point grabs it, and the drag follows the pointer from there; an end takes its
// handle along. Shift lays a handle flat or upright from its end, and snaps an end to tenths. A
// double-click on a handle straightens the curve between its ends; on an end, it puts that end
// back in its corner.

type CurveKey = 'distanceCurve' | 'blurCurve' | 'opacityCurve' | 'colorCurve';

const CURVES: Record<CurveKey, { across: string; hint: string; x: (copy: number, p: ShadowParams, offset: number) => number }> = {
  distanceCurve: {
    across: 'by copy',
    hint: 'Where the copies sit. Across: copy 1 to the last. Up: their share of the distance.',
    x: (k, p) => (k + 1) / p.layers,
  },
  blurCurve: {
    across: 'by distance',
    hint: 'How soft the copies get. Across: how far a copy sits, from the object to the far end. Up: how far it is from start to end softness.',
    x: (k, p, offset) => {
      const reach = p.elevation + p.lights[0].distance;
      return reach > 0 ? offset / reach : (k + 1) / p.layers;
    },
  },
  opacityCurve: {
    across: 'by copy',
    hint: 'How strength runs from Start to End. Across: the nearest copy to the farthest. Up: how far it is from start to end opacity.',
    x: (k, p) => steps(p.layers)[k],
  },
  colorCurve: {
    across: 'by copy',
    hint: 'How color runs from Start to End. Across: the nearest copy to the farthest. Up: how far it is from start to end color.',
    x: (k, p) => steps(p.layers)[k],
  },
};
const CURVE_HANDLING = ' Drag a point to bend the curve; an end takes its handle along. Shift lays a handle flat or upright, and snaps an end to tenths. Double-click a handle to straighten the curve, an end to put it back in its corner.';
const CURVE_PAD = 8; // px around the area the points can reach
const CURVE_GRAB = 14; // px from a point that a press still grabs it
const MIN_SPAN = 0.05; // the end stays at least this far right of the start
const CORNER: Record<0 | 3, CurvePoint> = { 0: [0, 0], 3: [1, 1] };
const clampTo = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const hundredths = (v: number) => Math.round(v * 100) / 100;

/** The same ends, with the handles at thirds of the straight line between them. */
function straighten([a, , , d]: Curve): Curve {
  const at = (t: number): CurvePoint => [a[0] + (d[0] - a[0]) * t, a[1] + (d[1] - a[1]) * t];
  return [a, at(1 / 3), at(2 / 3), d];
}

/** Curve units to px in an editor and back: from −reach to 1 + reach each way, y upwards. */
function curveFrame(svg: SVGSVGElement) {
  const w = (svg.clientWidth || 280) - 2 * CURVE_PAD;
  const h = (svg.clientHeight || 148) - 2 * CURVE_PAD;
  const [across, up] = [1 + 2 * CURVE_REACH_X, 1 + 2 * CURVE_REACH_Y];
  return {
    X: (x: number) => CURVE_PAD + ((x + CURVE_REACH_X) / across) * w,
    Y: (y: number) => CURVE_PAD + ((1 + CURVE_REACH_Y - y) / up) * h,
    x: (px: number) => ((px - CURVE_PAD) / w) * across - CURVE_REACH_X,
    y: (py: number) => 1 + CURVE_REACH_Y - ((py - CURVE_PAD) / h) * up,
  };
}

interface CurveEditor {
  key: CurveKey;
  svg: SVGSVGElement;
  hot: number | null; // the point under the pointer or held, drawn larger
}

const curves: CurveEditor[] = Array.from(document.querySelectorAll<SVGSVGElement>('svg.curve-canvas'), (svg) => {
  const editor: CurveEditor = { key: 'distanceCurve', svg, hot: null };
  const local = (event: MouseEvent) => {
    const box = svg.getBoundingClientRect();
    return { px: event.clientX - box.left, py: event.clientY - box.top };
  };
  /** The point within reach of the pointer, the nearest if several, or null. */
  const pick = (event: MouseEvent): 0 | 1 | 2 | 3 | null => {
    const f = curveFrame(svg);
    const { px, py } = local(event);
    let best: number | null = null;
    let least = CURVE_GRAB;
    current()[editor.key].forEach(([x, y], k) => {
      const away = Math.hypot(f.X(x) - px, f.Y(y) - py);
      if (away <= least) {
        least = away;
        best = k;
      }
    });
    return best as 0 | 1 | 2 | 3 | null;
  };
  const heat = (k: number | null) => {
    svg.classList.toggle('near', k !== null);
    if (editor.hot === k) return;
    editor.hot = k;
    renderCurves(current());
  };

  let grab: { index: 0 | 1 | 2 | 3; px: number; py: number; curve: Curve; moved: boolean } | null = null;
  svg.addEventListener('pointerdown', (event) => {
    const index = pick(event);
    if (index === null) return;
    grab = { index, ...local(event), curve: current()[editor.key], moved: false };
    dragging = true;
    svg.classList.add('held');
    heat(index);
    try {
      svg.setPointerCapture(event.pointerId);
    } catch {
      // ignore
    }
  });
  svg.addEventListener('pointermove', (event) => {
    if (!grab) return heat(pick(event));
    const f = curveFrame(svg);
    const { px, py } = local(event);
    const c = grab.curve.map((point) => [...point]) as Curve;
    const [ox, oy] = c[grab.index];
    let x = ox + f.x(px) - f.x(grab.px);
    let y = oy + f.y(py) - f.y(grab.py);
    if (grab.index === 0 || grab.index === 3) {
      if (event.shiftKey) [x, y] = [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
      x = grab.index === 0 ? clampTo(x, 0, c[3][0] - MIN_SPAN) : clampTo(x, c[0][0] + MIN_SPAN, 1);
      y = clampTo(y, 0, 1);
      const h = grab.index === 0 ? 1 : 2;
      c[h] = [hundredths(clampTo(c[h][0] + x - ox, -CURVE_REACH_X, 1 + CURVE_REACH_X)), hundredths(clampTo(c[h][1] + y - oy, -CURVE_REACH_Y, 1 + CURVE_REACH_Y))];
    } else {
      x = clampTo(x, -CURVE_REACH_X, 1 + CURVE_REACH_X);
      y = clampTo(y, -CURVE_REACH_Y, 1 + CURVE_REACH_Y);
      if (event.shiftKey) {
        // Flat or upright from its end, whichever the handle is nearer on screen.
        const [ex, ey] = c[grab.index === 1 ? 0 : 3];
        if (Math.abs(f.X(x) - f.X(ex)) >= Math.abs(f.Y(y) - f.Y(ey))) y = ey;
        else x = ex;
      }
    }
    c[grab.index] = [hundredths(x), hundredths(y)];
    grab.moved = true;
    set({ [editor.key]: c }, false);
  });
  const release = () => {
    if (grab?.moved) set({ [editor.key]: current()[editor.key] }, true); // closes the drag's undo step
    grab = null;
    svg.classList.remove('held');
  };
  svg.addEventListener('pointerup', release);
  svg.addEventListener('pointercancel', release);
  svg.addEventListener('pointerleave', () => !grab && heat(null));
  svg.addEventListener('dblclick', (event) => {
    const index = pick(event);
    if (index === null) return;
    const c = current()[editor.key];
    if (index === 1 || index === 2) set({ [editor.key]: straighten(c) }, true);
    else set({ [editor.key]: c.map((point, k) => (k === index ? CORNER[index] : point)) as Curve }, true);
  });
  return editor;
});

const curvePick = $<HTMLSelectElement>('curve-pick');
curvePick.addEventListener('change', () => {
  for (const editor of curves) Object.assign(editor, { key: curvePick.value as CurveKey, hot: null });
  render();
});

function renderCurves(p: ShadowParams) {
  const first = computeCopies(p).filter((c) => c.light === 0);
  for (const { key, svg, hot } of curves) {
    const f = curveFrame(svg);
    const X = (x: number) => f.X(x).toFixed(1);
    const Y = (y: number) => f.Y(y).toFixed(1);
    const points = p[key];
    const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = points;
    const [, [cx1, cy1], [cx2, cy2]] = readHandles(points); // the curve as it's applied
    const dots = first.map((c, k) => {
      const x = CURVES[key].x(k, p, c.offset);
      return `<circle class="dot" cx="${X(x)}" cy="${Y(ease(points, x))}" r="2.4" fill="${c.color}"/>`;
    });
    const point = ([x, y]: CurvePoint, k: number) =>
      `<circle class="${k === hot ? 'hot' : k === 0 || k === 3 ? 'end-point' : 'handle-point'}" cx="${X(x)}" cy="${Y(y)}" r="${k === hot ? 5.5 : 4.5}"/>`;
    // What runs across, in the room above the square, under everything else.
    const caption = `<text class="caption sub" x="${(svg.clientWidth || 280) - CURVE_PAD - 1}" y="12" text-anchor="end">${CURVES[key].across}</text>`;
    svg.parentElement!.title = CURVES[key].hint + CURVE_HANDLING;
    svg.innerHTML =
      caption +
      `<rect class="square" x="${X(0)}" y="${Y(1)}" width="${(f.X(1) - f.X(0)).toFixed(1)}" height="${(f.Y(0) - f.Y(1)).toFixed(1)}" rx="2"/>` +
      `<line class="diagonal" x1="${X(0)}" y1="${Y(0)}" x2="${X(1)}" y2="${Y(1)}"/>` +
      `<line class="arm" x1="${X(x0)}" y1="${Y(y0)}" x2="${X(x1)}" y2="${Y(y1)}"/>` +
      `<line class="arm" x1="${X(x3)}" y1="${Y(y3)}" x2="${X(x2)}" y2="${Y(y2)}"/>` +
      `<path class="curve" d="M ${X(0)} ${Y(y0)} L ${X(x0)} ${Y(y0)} C ${X(cx1)} ${Y(cy1)} ${X(cx2)} ${Y(cy2)} ${X(x3)} ${Y(y3)} L ${X(1)} ${Y(y3)}"/>` +
      dots.join('') +
      points.map(point).join('');
  }
}

// --- Lights on the stage -------------------------------------------------------------
//
// The selected shadow's light sits on the preview, opposite its shadow, and may sit over the card.
// Its distance from the card's center sets the shadow's, the same in every direction: 0 px at the
// center, 1000 px on a circle as high as the stage, on a log scale so short shadows get room too.
// Drag the light to move it; Shift snaps its direction to 15°, Alt moves it slower.

const LIGHT_MARGIN = 10; // px a light keeps from the stage's edge
const KNEE = 10; // px; below it the scale is close to even
const FARTHEST = 1000; // px, at the stage's edge

const stage = $('stage');

/** How far a light can go from the center, in px: the radius of the circle where 1000 px sits. */
const span = () => Math.min(stage.clientWidth, stage.clientHeight) / 2 - LIGHT_MARGIN;

/** Where a light sits, from the stage's center. */
function lightPoint({ angle, distance }: Light) {
  const rad = ((angle + 180) * Math.PI) / 180;
  const r = (Math.log(1 + distance / KNEE) / Math.log(1 + FARTHEST / KNEE)) * span();
  return { x: Math.cos(rad) * r, y: Math.sin(rad) * r };
}

/** The light at a point from the stage's center, clamped to the circle. At the center it keeps
 *  its direction. */
function lightAt(x: number, y: number, snap: boolean): Partial<Light> {
  const u = Math.min(1, Math.hypot(x, y) / span());
  const distance = Math.round(KNEE * ((1 + FARTHEST / KNEE) ** u - 1));
  if (Math.hypot(x, y) < 1) return { distance };
  const deg = (Math.atan2(y, x) * 180) / Math.PI + 180;
  return { angle: (snap ? Math.round(deg / 15) * 15 : Math.round(deg)) % 360, distance };
}

// Kept across renders, so a drag holds on to its handle.
const handles = Array.from({ length: MAX_LIGHTS }, (_, i) => {
  const handle = document.createElement('div');
  handle.className = 'handle';
  $('handles').appendChild(handle);
  // The drag follows the pointer's movement, not its position, so grabbing a handle off-center
  // doesn't make it jump; Alt re-anchors it at a quarter of the speed.
  let drag: { x: number; y: number; from: { x: number; y: number }; slow: boolean; moved: boolean } | null = null;
  const point = (event: PointerEvent) => {
    const scale = drag!.slow ? 0.25 : 1;
    return { x: drag!.from.x + (event.clientX - drag!.x) * scale, y: drag!.from.y + (event.clientY - drag!.y) * scale };
  };
  handle.addEventListener('pointerdown', (event) => {
    const light = current().lights[i];
    if (!light) return;
    event.preventDefault();
    drag = { x: event.clientX, y: event.clientY, from: lightPoint(light), slow: event.altKey, moved: false };
    dragging = true;
    handle.classList.add('held');
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {
      // ignore
    }
  });
  handle.addEventListener('pointermove', (event) => {
    if (!drag) return;
    if (event.altKey !== drag.slow) drag = { ...drag, x: event.clientX, y: event.clientY, from: point(event), slow: event.altKey };
    let { x, y } = point(event);
    // Past the circle the light stays on it, and comes back as soon as the pointer turns.
    const out = Math.hypot(x, y) / span();
    if (out > 1) {
      x /= out;
      y /= out;
      drag = { ...drag, x: event.clientX, y: event.clientY, from: { x, y } };
    }
    drag.moved = true;
    setLight(i, lightAt(x, y, event.shiftKey), false);
  });
  const release = () => {
    if (drag?.moved) setLight(i, {}, true); // closes the drag's undo step
    drag = null;
    handle.classList.remove('held');
  };
  handle.addEventListener('pointerup', release);
  handle.addEventListener('pointercancel', release);
  return handle;
});

function renderLights(p: ShadowParams) {
  const cx = stage.clientWidth / 2;
  const cy = stage.clientHeight / 2;
  let rays = '';
  handles.forEach((handle, i) => {
    const light = p.lights[i];
    handle.hidden = !light;
    if (!light) return;
    const { x, y } = lightPoint(light);
    handle.style.left = `${cx + x}px`;
    handle.style.top = `${cy + y}px`;
    const mark = badge(i, p.lights.length);
    if (handle.dataset.mark !== mark) {
      handle.dataset.mark = mark;
      handle.innerHTML = mark;
    }
    handle.title = `${p.lights.length > 1 ? `Light ${i + 1}` : 'The light'}: drag it to move it. The further from the card's center, the longer the shadow. Shift snaps the direction to 15°, Alt moves it slower.`;
    rays += `<line x1="${cx}" y1="${cy}" x2="${cx + x}" y2="${cy + y}"/>`;
  });
  $('rays').innerHTML = rays;
}

// --- Render ----------------------------------------------------------------------------

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function shadowElement(p: ShadowParams): HTMLElement {
  const el = document.createElement('div');
  el.className = 'shadow';
  el.style.boxShadow = toCss(p);
  el.style.mixBlendMode = CSS_BLEND[p.blendMode];
  return el;
}

/** Like in Figma: drop shadows, the card, then inner shadows on it; within each, the first shadow
 *  draws on top. */
function renderPreview() {
  const order = [...shadows.keys()].reverse().filter((i) => shadows[i].visible);
  $('under').replaceChildren(...order.filter((i) => !shadows[i].inner).map((i) => shadowElement(shadows[i])));
  $('over').replaceChildren(...order.filter((i) => shadows[i].inner).map((i) => shadowElement(shadows[i])));
}

const EYE = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M1.5 7S3.5 3.2 7 3.2 12.5 7 12.5 7 10.5 10.8 7 10.8 1.5 7 1.5 7z"/><circle cx="7" cy="7" r="1.7"/></svg>';
const EYE_CLOSED = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"><path d="M1.8 6.2S3.7 9 7 9s5.2-2.8 5.2-2.8M3.6 8.1l-1 1.3M7 9v1.6M10.4 8.1l1 1.3"/></svg>';
const LINK = '<svg width="10" height="10" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M6 8a2.5 2.5 0 0 0 3.5 0l2-2A2.5 2.5 0 0 0 8 2.5l-.7.7"/><path d="M8 6a2.5 2.5 0 0 0-3.5 0l-2 2A2.5 2.5 0 0 0 6 11.5l.7-.7"/></svg>';

function describe(s: ShadowParams): string {
  const parts = [`${s.layers}×`, `${Math.round(s.elevation + Math.max(...s.lights.map((l) => l.distance)))} px`];
  if (s.lights.length > 1) parts.push(`${s.lights.length} lights`);
  if (s.inner) parts.push('inner');
  return parts.join(' · ');
}

function renderList() {
  $('shadows').innerHTML = shadows
    .map(
      (s, i) => `
      <div class="shadow-row${i === active ? ' active' : ''}${s.visible ? '' : ' hidden'}" data-index="${i}">
        <span class="chip" style="background: linear-gradient(135deg, ${s.startColor}, ${s.endColor})"></span>
        <span class="name">Shadow ${i + 1}</span>
        ${s.linked && shadows.filter((x) => x.linked).length > 1 ? `<span class="linked" title="Shares its light with the other linked shadows">${LINK}</span>` : ''}
        <span class="meta">${describe(s)}</span>
        <button class="icon eye" data-toggle="${i}" title="${s.visible ? 'Hide this shadow. It keeps its settings.' : 'Show this shadow'}" aria-label="${s.visible ? 'Hide' : 'Show'} shadow ${i + 1}" aria-pressed="${!s.visible}">${s.visible ? EYE : EYE_CLOSED}</button>
        <button class="icon" data-remove="${i}" title="Remove this shadow" aria-label="Remove shadow ${i + 1}"${shadows.length === 1 ? ' disabled' : ''}>−</button>
      </div>`,
    )
    .join('');
  $<HTMLButtonElement>('add-shadow').disabled = shadows.length >= MAX_SHADOWS;
  const paste = $<HTMLButtonElement>('paste');
  const copied = clipboard.length === 1 ? 'the copied shadow' : `the ${clipboard.length} copied shadows`;
  paste.disabled = clipboard.length === 0;
  paste.title = !clipboard.length
    ? 'Paste: copy shadows first.'
    : selection.capable
      ? `Paste ${copied} onto the selection, replacing its shadows.`
      : `Paste ${copied} into the panel; Add puts them on a layer.`;
}

function render() {
  const p = current();
  for (const { field, input, spec, get, off } of numbers) {
    const value = get();
    if (document.activeElement !== input) input.value = format(value, spec);
    field.classList.toggle('off', off?.() ?? false);
    field.classList.toggle('auto', value === null);
  }
  lightRows.forEach((row, i) => {
    row.hidden = i >= p.lights.length;
    const marker = row.querySelector<HTMLElement>('.marker')!;
    const mark = badge(i, p.lights.length);
    if (marker.dataset.mark !== mark) {
      marker.dataset.mark = mark;
      marker.innerHTML = mark;
    }
    row.querySelector<HTMLElement>('.remove')!.hidden = p.lights.length === 1;
    dials[i].querySelector<HTMLElement>('.needle')!.style.transform = `rotate(${p.lights[i]?.angle ?? 0}deg)`;
  });
  softnessRows.forEach((row, i) => {
    row.hidden = i >= p.lights.length;
    const marker = row.querySelector<HTMLElement>('.marker')!;
    marker.hidden = p.lights.length === 1;
    marker.textContent = String(i + 1);
  });

  const link = $<HTMLButtonElement>('link');
  link.classList.toggle('on', p.linked);
  link.setAttribute('aria-pressed', String(p.linked));
  link.title = p.linked
    ? "Linked: this shadow turns with every other linked shadow on the layer. They share their lights' directions; distance and softness stay each shadow's own. Click to give it lights of its own."
    : 'Own lights. Click to link it: it turns like the other linked shadows.';
  kind.querySelectorAll<HTMLElement>('[data-kind]').forEach((b) => b.classList.toggle('on', (b.dataset.kind === 'inner') === p.inner));

  for (const [key, { field, picker, swatch, hex }] of colorFields) {
    picker.value = p[key];
    swatch.style.background = p[key];
    if (document.activeElement !== hex) hex.value = p[key].slice(1).toUpperCase();
    field.classList.toggle('off', key === 'endColor' && p.layers === 1);
  }
  const linkColors = $<HTMLButtonElement>('link-colors');
  linkColors.classList.toggle('on', p.colorLinked);
  linkColors.setAttribute('aria-pressed', String(p.colorLinked));
  linkColors.title = p.colorLinked
    ? 'Linked: one color from start to end; either field sets it. Click to give the far end a color of its own.'
    : 'Start and end have their own colors. Click to link them: the end takes the start color.';
  blend.value = p.blendMode;

  renderList();
  renderPreview();
  renderLights(p);
  renderCurves(p);

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

function renderFooter() {
  const status = $('status');
  const primary = $<HTMLButtonElement>('primary');
  const more = $<HTMLButtonElement>('more');
  const unmanaged = selection.capable - selection.managed;
  const layered = dropCopies(shadows) > MAX_EFFECTS;
  let title: string;
  let hint = '';

  if (selection.managed) {
    title = `Editing ${plural(selection.managed, 'layer')}`;
    hint = 'Changes apply live';
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
    if (layered && selection.capable && !selection.groupBlocker) notes.push('groups it with a shadow layer');
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
    clipboard = message.clipboard ?? [];
  } else if (message.type === 'selection') {
    selection = message;
    if (message.shadows && !dragging) shadows = message.shadows;
  }
  active = Math.min(active, shadows.length - 1);
  render();
});

render();
send({ type: 'ready' });
