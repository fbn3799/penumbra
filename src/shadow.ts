// The shadow model, shared by the plugin (writes Figma effects) and the UI (draws the preview).
//
// A layer carries a list of shadows, each built the same way. The shadow starts `elevation` px
// away from the object and reaches `distance` px further, cast towards `angle`. It is built from
// `layers` copies spread across that reach: each gap between copies is `spacing` times the one
// before (1 = even, 2 = every gap doubles, below 1 = the widest gaps sit next to the object).
// Blur grows with a copy's offset, up to `softness` for the farthest one, the way a shadow
// softens the further it falls from what casts it.
//
// Strength and color run from start (next to the object) to end (the far end), one even step
// per copy. Copies overlap: the area next to the object is covered by every copy, the far end
// by the last one only. So each copy's alpha is solved for the overlap to come out at the set
// strength, band by band; the nearest copy draws on top, so its color leads near the object.
//
// Two ways to draw it. As effects on the object, the solved alphas are absolute. Merged, the
// copies go on a shadow layer behind the object: the nearest is opaque so the core fuses into
// one shape, the layer's opacity carries the start strength, and the blend mode applies to the
// layer as a whole.

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

export interface ShadowParams {
  startColor: string; // #rrggbb, next to the object
  endColor: string; // #rrggbb, at the far end
  startOpacity: number; // 0–1, strength next to the object
  endOpacity: number; // 0–1, strength at the far end
  elevation: number; // px from the object to where the shadow starts
  distance: number; // px the shadow reaches beyond that
  softness: number; // px blur of the farthest copy
  angle: number; // degrees the shadow is cast towards; 90 is straight down
  layers: number; // copies; 1 = one solid shadow
  spacing: number; // each gap between copies, relative to the one before
  blendMode: ShadowBlendMode;
  merge: boolean; // draw on its own shadow layer behind the object
}

export interface ShadowLayer {
  x: number;
  y: number;
  blur: number;
  color: string; // #rrggbb
  alpha: number;
  offset: number; // distance from the object along the angle
}

export interface ShadowStack {
  copies: ShadowLayer[]; // nearest first; the nearest draws on top
  opacity: number; // of the merged shadow layer; 1 as effects
}

export const MAX_LAYERS = 12;
export const MAX_SHADOWS = 16;
/** Figma keeps 8 drop shadows per layer and drops the rest without an error. */
export const MAX_EFFECTS = 8;
export const SPACING_RANGE = [0.25, 4] as const;
export const STORAGE_VERSION = 3;

export const DEFAULTS: ShadowParams = {
  startColor: '#0f172a',
  endColor: '#0f172a',
  startOpacity: 0.3,
  endOpacity: 0.05,
  elevation: 2,
  distance: 14,
  softness: 28,
  angle: 90,
  layers: 4,
  spacing: 2,
  blendMode: 'NORMAL',
  merge: false,
};

export function sanitize(input: unknown): ShadowParams {
  const p = { ...DEFAULTS, ...(input && typeof input === 'object' ? input : {}) } as ShadowParams;
  return {
    startColor: normalizeHex(p.startColor) ?? DEFAULTS.startColor,
    endColor: normalizeHex(p.endColor) ?? DEFAULTS.endColor,
    startOpacity: clamp(num(p.startOpacity, DEFAULTS.startOpacity), 0, 1),
    endOpacity: clamp(num(p.endOpacity, DEFAULTS.endOpacity), 0, 1),
    elevation: clamp(num(p.elevation, DEFAULTS.elevation), 0, 1000),
    distance: clamp(num(p.distance, DEFAULTS.distance), 0, 1000),
    softness: clamp(num(p.softness, DEFAULTS.softness), 0, 1000),
    angle: ((num(p.angle, DEFAULTS.angle) % 360) + 360) % 360,
    layers: Math.round(clamp(num(p.layers, DEFAULTS.layers), 1, MAX_LAYERS)),
    spacing: clamp(num(p.spacing, DEFAULTS.spacing), SPACING_RANGE[0], SPACING_RANGE[1]),
    blendMode: BLEND_MODES.some(([mode]) => mode === p.blendMode) ? p.blendMode : DEFAULTS.blendMode,
    merge: p.merge === true,
  };
}

export function sanitizeList(input: unknown): ShadowParams[] {
  return Array.isArray(input) ? input.slice(0, MAX_SHADOWS).map(sanitize) : [];
}

/** Copies drawn as drop shadows of the object itself: those of every shadow that isn't merged. */
export function looseCopies(shadows: ShadowParams[]): number {
  return shadows.reduce((n, s) => n + (s.merge ? 0 : s.layers), 0);
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
  if (stored.v === STORAGE_VERSION) {
    const shadows = sanitizeList(stored.shadows);
    return shadows.length ? shadows : null;
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

/** Where each copy sits across the reach, 0 (the start) to 1 (the far end). The last copy
 *  always sits at the far end; each gap is `spacing` times the previous one. */
export function distribute(layers: number, spacing: number): number[] {
  const out: number[] = [];
  for (let i = 1; i <= layers; i++) {
    out.push(Math.abs(spacing - 1) < 1e-6 ? i / layers : (spacing ** i - 1) / (spacing ** layers - 1));
  }
  return out;
}

/** How far each copy is along the start → end steps: 0 for the nearest, 1 for the farthest. */
function steps(layers: number): number[] {
  return Array.from({ length: layers }, (_, i) => (layers === 1 ? 0 : i / (layers - 1)));
}

/** The strength each band should come out at, nearest first. Band k is where copies k…n
 *  overlap, so it can't be lighter than the band beyond it: a start lighter than the end
 *  levels out at the end. */
export function bands(params: ShadowParams): number[] {
  const out = steps(params.layers).map((u) => lerp(params.startOpacity, params.endOpacity, u));
  for (let k = out.length - 2; k >= 0; k--) out[k] = Math.max(out[k], out[k + 1]);
  return out;
}

/** Each copy's alpha, nearest first, so that copies k…n composite to `target[k]`. */
function solve(target: number[]): number[] {
  return target.map((t, k) => {
    const beyond = k + 1 < target.length ? target[k + 1] : 0;
    return beyond >= 1 - 1e-9 ? 1 : (t - beyond) / (1 - beyond);
  });
}

export function computeCopies(params: ShadowParams): ShadowStack {
  const p = sanitize(params);
  const reach = p.elevation + p.distance;
  const rad = (p.angle * Math.PI) / 180;
  const target = bands(p);
  // Merged, the layer carries the strongest band and the copies the rest relative to it, so
  // the nearest copy is opaque and an even shadow is opaque throughout.
  const opacity = p.merge ? target[0] : 1;
  const alphas = p.merge ? solve(target.map((t) => (opacity > 0 ? t / opacity : 1))) : solve(target);
  const u = steps(p.layers);
  const copies = distribute(p.layers, p.spacing).map((t, i) => {
    const offset = p.elevation + p.distance * t;
    return {
      x: round(Math.cos(rad) * offset, 2),
      y: round(Math.sin(rad) * offset, 2),
      blur: round(p.softness * (reach > 0 ? offset / reach : t), 2),
      color: mixHex(p.startColor, p.endColor, u[i]),
      alpha: round(alphas[i], 4),
      offset: round(offset, 2),
    };
  });
  return { copies, opacity: round(opacity, 4) };
}

/** CSS box-shadow for the preview; the first shadow in CSS draws on top, like the nearest copy.
 *  Merged shadows also need the element's opacity set to the stack's. */
export function toCss(params: ShadowParams): string {
  return computeCopies(params)
    .copies.map((l) => {
      const { r, g, b } = hexToRgb(l.color);
      const rgb = [r, g, b].map((c) => Math.round(c * 255)).join(', ');
      return `${l.x}px ${l.y}px ${l.blur}px rgba(${rgb}, ${l.alpha})`;
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
