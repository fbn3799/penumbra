// The shadow model, shared by the plugin (writes Figma effects) and the UI (draws the preview).
//
// A layer carries a list of shadows, each built the same way. The shadow starts `elevation` px
// away from the object (how far it floats, so every light shares it) and reaches a light's
// `distance` px further, cast away from that light. It is built from `layers` copies spread
// across that reach. Curves shape the ramps: `distanceCurve` places copy k of n at curve(k / n)
// of the distance, `blurCurve` takes a copy from the light's start softness to its end softness by
// curve(offset / reach), and `opacityCurve` and `colorCurve` take copy k from start to end by
// curve(k / (n − 1)). A curve is a cubic Bézier through four points in the unit square, flat before
// its first point and after its last (see `ease`); a straight line steps evenly.
//
// Strength and color run from start (next to the object) to end (the far end). Copies overlap: the area right behind the object is covered by every copy, the far
// end by the last one only. So each copy's alpha is solved for the overlap to come out at the set
// strength, band by band; the nearest copy draws on top, so its color leads near the object.
// Beside the object, though, the copies show on their own, so no copy may be stronger than the
// ones nearer the object; where even steps would need that, the far copies share the fade (`solve`).
//
// A shadow is cast by one or more lights, each with its own direction, distance and softness and
// the same copies. Linked shadows turn together: they share how many lights there are and where
// each points, and keep their own distance and softness (`applyPatch`). An inner shadow casts
// the same copies inside the object instead.

export const BLEND_MODES = [
  ['NORMAL', 'Normal'],
  ['DARKEN', 'Darken'],
  ['MULTIPLY', 'Multiply'],
  ['LINEAR_BURN', 'Plus darker'],
  ['COLOR_BURN', 'Color burn'],
  ['LIGHTEN', 'Lighten'],
  ['SCREEN', 'Screen'],
  ['LINEAR_DODGE', 'Plus lighter'],
  ['COLOR_DODGE', 'Color dodge'],
  ['OVERLAY', 'Overlay'],
  ['SOFT_LIGHT', 'Soft light'],
  ['HARD_LIGHT', 'Hard light'],
  ['DIFFERENCE', 'Difference'],
  ['EXCLUSION', 'Exclusion'],
  ['HUE', 'Hue'],
  ['SATURATION', 'Saturation'],
  ['COLOR', 'Color'],
  ['LUMINOSITY', 'Luminosity'],
] as const;

export type ShadowBlendMode = (typeof BLEND_MODES)[number][0];

export interface Light {
  angle: number; // degrees the shadow is cast towards, away from the light; 90 is straight down
  distance: number; // px the shadow reaches beyond the elevation gap
  startSoftness: number; // px blur where the shadow starts
  endSoftness: number; // px blur at the far end
}

/** A point in the unit square: across, then up. */
export type CurvePoint = [number, number];
/** A cubic Bézier: its start, two handles and end. The ends sit in the unit square, the end right
 *  of the start; the handles may reach past it on every side, `CURVE_REACH_X` across and
 *  `CURVE_REACH_Y` up and down (see `readHandles`). */
export type Curve = [CurvePoint, CurvePoint, CurvePoint, CurvePoint];

export interface ShadowParams {
  startColor: string; // #rrggbb, next to the object
  endColor: string; // #rrggbb, at the far end
  colorLinked: boolean; // one color throughout: end follows start
  startOpacity: number; // 0–1, strength next to the object
  endOpacity: number; // 0–1, strength at the far end
  elevation: number; // px from the object to where the shadow starts, for every light
  lights: Light[]; // one or more, each casting the same copies its own way
  linked: boolean; // turns with the other linked shadows on the layer
  layers: number; // copies per light; 1 = one solid shadow
  distanceCurve: Curve; // copy k of n sits at curve(k / n) of the distance
  blurCurve: Curve; // how far a copy is from start to end softness, by its share of the reach
  opacityCurve: Curve; // how far copy k of n is from start to end strength, by k / (n − 1)
  colorCurve: Curve; // how far copy k of n is from start to end color, by k / (n − 1)
  blendMode: ShadowBlendMode;
  visible: boolean; // hidden shadows keep their settings but aren't drawn
  inner: boolean; // cast inside the object instead of behind it
}

export interface ShadowLayer {
  x: number;
  y: number;
  blur: number;
  color: string; // #rrggbb
  alpha: number;
  offset: number; // distance from the object along the angle
  light: number; // index into `lights`
}

export const MAX_LAYERS = 32;
export const MAX_SHADOWS = 16;
// Several lights per shadow were buggy in use; one for now. The model still holds a list.
export const MAX_LIGHTS = 1;
/** Figma keeps 8 drop shadows per layer and drops the rest without an error, and 8 inner
 *  shadows on top of those. */
export const MAX_EFFECTS = 8;
export const STORAGE_VERSION = 7;

export const CURVE_REACH_X = 0.25;
export const CURVE_REACH_Y = 0.5;

/** A straight line: the ramp runs evenly. */
export const LINEAR: Curve = [[0, 0], [0.33, 0.33], [0.67, 0.67], [1, 1]];
/** Gaps that widen towards the far end: what the old default spacing (2×) gave 4 copies. */
export const EASE_IN: Curve = [[0, 0], [0.2, 0.05], [0.7, 0.08], [1, 1]];

export const DEFAULTS: ShadowParams = {
  startColor: '#0f172a',
  endColor: '#0f172a',
  colorLinked: true,
  startOpacity: 0.3,
  endOpacity: 0.05,
  elevation: 2,
  lights: [{ angle: 90, distance: 14, startSoftness: 0, endSoftness: 28 }],
  linked: true,
  layers: 4,
  distanceCurve: EASE_IN,
  blurCurve: LINEAR,
  opacityCurve: LINEAR,
  colorCurve: LINEAR,
  blendMode: 'NORMAL',
  visible: true,
  inner: false,
};

function sanitizeLight(input: unknown): Light {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const fallback = DEFAULTS.lights[0];
  return {
    angle: ((num(raw.angle, fallback.angle) % 360) + 360) % 360,
    distance: clamp(num(raw.distance, fallback.distance), 0, 1000),
    // Before v7 a light had one `softness`: the far end's, from none at the start.
    startSoftness: clamp(num(raw.startSoftness, fallback.startSoftness), 0, 1000),
    endSoftness: clamp(num(raw.endSoftness ?? raw.softness, fallback.endSoftness), 0, 1000),
  };
}

export function sanitize(input: unknown): ShadowParams {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const p = { ...DEFAULTS, ...raw } as ShadowParams;
  // Before v5 a shadow's lights shared one distance and softness; before v4 it had one `angle`.
  let lights = raw.lights;
  if (!Array.isArray(lights) || !lights.length) {
    const angles = Array.isArray(raw.angles) && raw.angles.length ? raw.angles : 'angle' in raw ? [raw.angle] : [DEFAULTS.lights[0].angle];
    lights = angles.map((angle) => ({ angle, distance: raw.distance, softness: raw.softness }));
  }
  const layers = Math.round(clamp(num(p.layers, DEFAULTS.layers), 1, MAX_LAYERS));
  const startColor = normalizeHex(p.startColor) ?? DEFAULTS.startColor;
  const endColor = normalizeHex(p.endColor) ?? DEFAULTS.endColor;
  // Before v6, colors were never linked, gaps grew by a factor (`spacing`), and shadows could
  // merge (`merge`, `edge`), which they now don't.
  const colorLinked = typeof raw.colorLinked === 'boolean' ? raw.colorLinked : startColor === endColor;
  const distanceCurve = toCurve(raw.distanceCurve) ?? ('spacing' in raw ? fromSpacing(num(raw.spacing, 2), layers) : DEFAULTS.distanceCurve);
  return {
    startColor,
    endColor: colorLinked ? startColor : endColor,
    colorLinked,
    startOpacity: clamp(num(p.startOpacity, DEFAULTS.startOpacity), 0, 1),
    endOpacity: clamp(num(p.endOpacity, DEFAULTS.endOpacity), 0, 1),
    elevation: clamp(num(p.elevation, DEFAULTS.elevation), 0, 1000),
    lights: (lights as unknown[]).slice(0, MAX_LIGHTS).map(sanitizeLight),
    linked: typeof p.linked === 'boolean' ? p.linked : DEFAULTS.linked,
    layers,
    distanceCurve,
    blurCurve: toCurve(raw.blurCurve) ?? DEFAULTS.blurCurve,
    opacityCurve: toCurve(raw.opacityCurve) ?? DEFAULTS.opacityCurve,
    colorCurve: toCurve(raw.colorCurve) ?? DEFAULTS.colorCurve,
    blendMode: BLEND_MODES.some(([mode]) => mode === p.blendMode) ? p.blendMode : DEFAULTS.blendMode,
    visible: p.visible !== false,
    inner: p.inner === true,
  };
}

/** A curve from storage. Before v7 a curve was its two handles alone, x1, y1, x2, y2, running
 *  from (0, 0) to (1, 1). */
function toCurve(value: unknown): Curve | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  const points: unknown[] = value.every(finite) ? [[0, 0], [value[0], value[1]], [value[2], value[3]], [1, 1]] : value;
  if (!points.every((p) => Array.isArray(p) && p.length === 2 && p.every(finite))) return null;
  const handle = ([x, y]: number[]) => [clamp(x, -CURVE_REACH_X, 1 + CURVE_REACH_X), clamp(y, -CURVE_REACH_Y, 1 + CURVE_REACH_Y)];
  const curve = (points as number[][]).map(([x, y], k) => (k === 1 || k === 2 ? handle([x, y]) : [clamp(x, 0, 1), clamp(y, 0, 1)])) as Curve;
  return curve[3][0] - curve[0][0] >= 0.01 ? curve : null;
}

export function sanitizeList(input: unknown): ShadowParams[] {
  return Array.isArray(input) ? input.slice(0, MAX_SHADOWS).map(sanitize) : [];
}

/** Copies drawn as drop shadows: those of every shown drop shadow. Figma keeps 8 on a layer. */
export function dropCopies(shadows: ShadowParams[]): number {
  return shadows.reduce((n, s) => n + (s.visible && !s.inner ? s.layers * s.lights.length : 0), 0);
}

/** Copies drawn as inner shadows; Figma keeps 8 of them. */
export function innerCopies(shadows: ShadowParams[]): number {
  return shadows.reduce((n, s) => n + (s.visible && s.inner ? s.layers * s.lights.length : 0), 0);
}

/** `s` turned like `lights`: as many lights, each pointing the same way, with `s`'s own distance
 *  and softness (a new light takes its last one's). `removed` is the light `lights` just lost. */
function turnLike(s: ShadowParams, lights: Light[], removed = -1): ShadowParams {
  const own = s.lights.filter((_, k) => k !== removed);
  const last = own[own.length - 1] ?? DEFAULTS.lights[0];
  return { ...s, lights: lights.map((l, k) => ({ ...(own[k] ?? last), angle: l.angle })) };
}

/** Which light `after` lacks, when it has one fewer than `before`. */
function removedLight(before: Light[], after: Light[]): number {
  if (after.length !== before.length - 1) return -1;
  const same = (a: Light, b: Light) => a.angle === b.angle && a.distance === b.distance && a.startSoftness === b.startSoftness && a.endSoftness === b.endSoftness;
  const k = after.findIndex((l, i) => !same(l, before[i]));
  return k < 0 ? before.length - 1 : k;
}

/** Applies `patch` to shadow `index`. Linked shadows turn together: a change to one linked
 *  shadow's lights turns every linked shadow, and a shadow that joins turns like them. */
export function applyPatch(shadows: ShadowParams[], index: number, patch: Partial<ShadowParams>): ShadowParams[] {
  if (index < 0 || index >= shadows.length) return shadows;
  const before = shadows[index];
  let after = sanitize({ ...before, ...patch });
  const shared = shadows.find((s, i) => i !== index && s.linked);
  if (after.linked && !before.linked && shared && !('lights' in patch)) after = turnLike(after, shared.lights);
  const removed = removedLight(before.lights, after.lights);
  return shadows.map((s, i) => (i === index ? after : after.linked && s.linked ? turnLike(s, after.lights, removed) : s));
}

/** Inserts a shadow at `index`; a linked one turns like the layer's linked shadows. */
export function insertAt(shadows: ShadowParams[], index: number, params: ShadowParams): ShadowParams[] {
  let shadow = sanitize(params);
  const shared = shadows.find((s) => s.linked);
  if (shadow.linked && shared) shadow = turnLike(shadow, shared.lights);
  const next = [...shadows];
  next.splice(Math.max(0, Math.min(index, next.length)), 0, shadow);
  return next;
}

/** A layer's shadows as stored on it, versioned so older shadows stay editable. */
export function toStored(shadows: ShadowParams[]): string {
  return JSON.stringify({ v: STORAGE_VERSION, shadows });
}

export function fromStored(raw: string): ShadowParams[] | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const stored = data as Record<string, unknown>;
  if (typeof stored.v === 'number' && stored.v >= 3 && stored.v <= STORAGE_VERSION) {
    const shadows = sanitizeList(stored.shadows);
    if (!shadows.length) return null;
    // v3 had no links: shadows already cast the same way start out linked.
    if (stored.v === 3) {
      const same = shadows.every((s) => s.lights[0].angle === shadows[0].lights[0].angle);
      return shadows.map((s) => ({ ...s, linked: same }));
    }
    return shadows;
  }
  return [fromV2(stored.v === 2 ? stored : fromV1(stored))];
}

// v1: elevation was an overall size, distance and softness were fractions of it, and the copies
// grew quadratically (closest to a spacing of 2).
function fromV1(stored: Record<string, unknown>): Record<string, unknown> {
  const size = num(stored.elevation, 24);
  return {
    ...stored,
    elevation: 0,
    distance: size * num(stored.distance, 0.5),
    softness: size * num(stored.softness, 1),
    spacing: 2,
  };
}

// v2: one color and one opacity per layer. As effects, every copy had the same alpha, so the
// shadow ran from the full opacity next to the object to one copy's alpha at the far end.
function fromV2(stored: Record<string, unknown>): ShadowParams {
  const opacity = clamp(num(stored.opacity, 0.3), 0, 1);
  const layers = Math.round(clamp(num(stored.layers, DEFAULTS.layers), 1, MAX_LAYERS));
  const flat = stored.merge === true || layers === 1;
  return sanitize({
    ...stored,
    startColor: stored.color,
    endColor: stored.color,
    startOpacity: opacity,
    endOpacity: flat ? opacity : 1 - Math.pow(1 - opacity, 1 / layers),
  });
}

/** The coordinate at parameter u on a cubic Bézier from p0 through p1 and p2 to p3. */
function bezier(p0: number, p1: number, p2: number, p3: number, u: number): number {
  const m = 1 - u;
  return m * m * m * p0 + 3 * m * m * u * p1 + 3 * m * u * u * p2 + u * u * u * p3;
}

/** The parameter where x reaches `x`. With the handles between the ends, x only runs one way. */
function paramAt(x0: number, x1: number, x2: number, x3: number, x: number): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 32; i++) {
    const mid = (lo + hi) / 2;
    if (bezier(x0, x1, x2, x3, mid) < x) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** The curve as it's read, so it never runs backwards across: a handle that reaches past the far
 *  end is shortened along its own line to end there, keeping its direction; one that points back
 *  past its own end is held upright at it. */
export function readHandles([p0, p1, p2, p3]: Curve): Curve {
  const read = ([ex, ey]: CurvePoint, [hx, hy]: CurvePoint, far: number): CurvePoint => {
    const ahead = Math.sign(far - ex);
    if ((hx - far) * ahead > 0) {
      const t = (far - ex) / (hx - ex);
      return [far, ey + (hy - ey) * t];
    }
    return (hx - ex) * ahead < 0 ? [ex, hy] : [hx, hy];
  };
  return [p0, read(p0, p1, p3[0]), read(p3, p2, p0[0]), p3];
}

/** The curve's value at `x` (0–1): flat before its start and after its end, the Bézier between,
 *  which can overshoot 0–1 where its handles do. Exact at the ends and on a straight line, so the
 *  farthest copy gets the full distance. */
export function ease(curve: Curve, x: number): number {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = readHandles(curve);
  if (x <= x0) return y0;
  if (x >= x3) return y3;
  const straight = [[x1, y1], [x2, y2]].every(([hx, hy]) => Math.abs((hy - y0) * (x3 - x0) - (y3 - y0) * (hx - x0)) < 1e-9);
  if (straight) return y0 + ((y3 - y0) * (x - x0)) / (x3 - x0);
  return bezier(y0, y1, y2, y3, paramAt(x0, x1, x2, x3, x));
}

/** The curve closest to the old `spacing` (each gap that many times the one before) over `layers`
 *  copies: for each pair of x handles on a 0.1 grid, the y handles by least squares. */
export function fromSpacing(spacing: number, layers: number): Curve {
  const s = clamp(spacing, 0.25, 4);
  const n = Math.max(2, layers);
  if (Math.abs(s - 1) < 1e-6) return LINEAR;
  const target = (t: number) => (s ** (n * t) - 1) / (s ** n - 1);
  const samples = Array.from({ length: 19 }, (_, i) => (i + 1) / 20);
  let best: Curve = LINEAR;
  let least = Infinity;
  for (let i = 0; i <= 10; i++) {
    for (let j = 0; j <= 10; j++) {
      const [x1, x2] = [i / 10, j / 10];
      const rows = samples.map((t) => {
        const u = paramAt(0, x1, x2, 1, t);
        return [3 * (1 - u) * (1 - u) * u, 3 * (1 - u) * u * u, target(t) - u * u * u];
      });
      const sum = (f: (row: number[]) => number) => rows.reduce((n, row) => n + f(row), 0);
      const [aa, ab, bb, ar, br] = [sum(([a]) => a * a), sum(([a, b]) => a * b), sum(([, b]) => b * b), sum(([a, , r]) => a * r), sum(([, b, r]) => b * r)];
      const det = aa * bb - ab * ab;
      if (Math.abs(det) < 1e-12) continue;
      const y1 = clamp((ar * bb - br * ab) / det, 0, 1);
      const y2 = clamp((br * aa - ar * ab) / det, 0, 1);
      const error = sum(([a, b, r]) => (a * y1 + b * y2 - r) ** 2);
      if (error < least) {
        least = error;
        best = [[0, 0], [x1, round(y1, 2)], [x2, round(y2, 2)], [1, 1]];
      }
    }
  }
  return best;
}

/** Where each copy sits from start to end, across the opacity and color curves: 0 for the nearest,
 *  1 for the farthest. */
export function steps(layers: number): number[] {
  return Array.from({ length: layers }, (_, i) => (layers === 1 ? 0 : i / (layers - 1)));
}

/** The strength each band should come out at, nearest first, along the opacity curve. Band k is
 *  where copies k…n overlap, so it can't be lighter than the band beyond it: a start lighter than
 *  the end levels out at the end. */
export function bands(params: ShadowParams): number[] {
  const out = steps(params.layers).map((u) => clamp(lerp(params.startOpacity, params.endOpacity, ease(params.opacityCurve, u)), 0, 1));
  for (let k = out.length - 2; k >= 0; k--) out[k] = Math.max(out[k], out[k + 1]);
  return out;
}

/** Each copy's alpha, nearest first, so that copies k…n composite to `target[k]`, and no copy is
 *  stronger than the ones before it. In −ln(1 − alpha), which adds up where copies overlap, each
 *  copy is the step between two bands. Where a step outward is bigger than the one before it
 *  (an End stronger than one step's worth), those steps are pooled into their average, as often
 *  as needed (pool adjacent violators). The total stays, so the start strength is kept and the
 *  far end comes out lighter. */
function solve(target: number[]): number[] {
  const depth = target.map((t) => -Math.log(1 - clamp(t, 0, 0.9999)));
  const steps = depth.map((d, k) => d - (k + 1 < depth.length ? depth[k + 1] : 0));
  const pools: { sum: number; count: number }[] = [];
  for (const step of steps) {
    pools.push({ sum: step, count: 1 });
    while (pools.length > 1) {
      const [a, b] = pools.slice(-2);
      if (a.sum / a.count >= b.sum / b.count - 1e-12) break;
      pools.pop();
      a.sum += b.sum;
      a.count += b.count;
    }
  }
  return pools.flatMap(({ sum, count }) => Array<number>(count).fill(1 - Math.exp(-sum / count)));
}

/** Every copy, light by light, each nearest first; the nearest draws on top. */
export function computeCopies(params: ShadowParams): ShadowLayer[] {
  const p = sanitize(params);
  const alphas = solve(bands(p));
  const u = steps(p.layers);
  const along = Array.from({ length: p.layers }, (_, k) => ease(p.distanceCurve, (k + 1) / p.layers));
  return p.lights.flatMap(({ angle, distance, startSoftness, endSoftness }, light) => {
    const rad = (angle * Math.PI) / 180;
    const reach = p.elevation + distance;
    return along.map((t, i) => {
      const offset = Math.max(0, p.elevation + distance * t);
      return {
        x: round(Math.cos(rad) * offset, 2),
        y: round(Math.sin(rad) * offset, 2),
        blur: round(Math.max(0, lerp(startSoftness, endSoftness, ease(p.blurCurve, reach > 0 ? offset / reach : (i + 1) / p.layers))), 2),
        color: mixHex(p.startColor, p.endColor, clamp(ease(p.colorCurve, u[i]), 0, 1)),
        alpha: round(alphas[i], 4),
        offset: round(offset, 2),
        light,
      };
    });
  });
}

/** CSS box-shadow for the preview; the first shadow in CSS draws on top, like the nearest copy. */
export function toCss(params: ShadowParams): string {
  const inset = params.inner ? 'inset ' : '';
  return computeCopies(params)
    .slice()
    .sort((a, b) => a.offset - b.offset)
    .map((l) => {
      const { r, g, b } = hexToRgb(l.color);
      const rgb = [r, g, b].map((c) => Math.round(c * 255)).join(', ');
      return `${inset}${l.x}px ${l.y}px ${l.blur}px rgba(${rgb}, ${l.alpha})`;
    })
    .join(', ');
}

/** Accepts `#abc`, `abc`, `#aabbcc` or `aabbcc`; returns lowercase `#aabbcc` or null. */
export function normalizeHex(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  let hex = value.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(hex)) hex = hex.replace(/./g, '$&$&');
  return /^[0-9a-f]{6}$/i.test(hex) ? `#${hex.toLowerCase()}` : null;
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const n = parseInt((normalizeHex(hex) ?? DEFAULTS.startColor).slice(1), 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

/** The color `t` of the way from `a` to `b`. */
export function mixHex(a: string, b: string, t: number): string {
  const from = hexToRgb(a);
  const to = hexToRgb(b);
  const channel = (x: number, y: number) => Math.round(lerp(x, y, t) * 255).toString(16).padStart(2, '0');
  return `#${channel(from.r, to.r)}${channel(from.g, to.g)}${channel(from.b, to.b)}`;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f + 0; // + 0 turns -0 into 0
}
