// The shadow model, shared by the plugin (writes Figma effects) and the UI (draws the preview).
//
// The shadow starts `elevation` px away from the object and reaches `distance` px further,
// cast towards `angle`. It is built from `layers` copies spread across that reach: each gap
// between copies is `spacing` times the one before (1 = even, 2 = every gap doubles, below 1 =
// the widest gaps sit next to the object). Blur grows with a copy's offset, up to `softness`
// for the farthest one, the way a shadow softens the further it falls from what casts it.
//
// Two ways to draw it. As effects on the object, each copy's alpha is solved so the stack
// composites to exactly `opacity`. Merged, the copies are drawn opaque on a shadow layer behind
// the object, so they fuse into one shape, and `opacity` and `blendMode` apply to that layer.

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
  color: string; // #rrggbb
  opacity: number; // 0–1, strength of the whole shadow
  elevation: number; // px from the object to where the shadow starts
  distance: number; // px the shadow reaches beyond that
  softness: number; // px blur of the farthest copy
  angle: number; // degrees the shadow is cast towards; 90 is straight down
  layers: number; // copies; 1 = one solid shadow
  spacing: number; // each gap between copies, relative to the one before
  blendMode: ShadowBlendMode;
  merge: boolean; // draw on one shadow layer behind the object
}

export interface ShadowLayer {
  x: number;
  y: number;
  blur: number;
  alpha: number;
  offset: number; // distance from the object along the angle
}

export const MAX_LAYERS = 12;
export const SPACING_RANGE = [0.25, 4] as const;
export const STORAGE_VERSION = 2;

export const DEFAULTS: ShadowParams = {
  color: '#0f172a',
  opacity: 0.3,
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
    color: normalizeHex(p.color) ?? DEFAULTS.color,
    opacity: clamp(num(p.opacity, DEFAULTS.opacity), 0, 1),
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

/** Settings as stored on a layer, versioned so older shadows stay editable. */
export function toStored(params: ShadowParams): string {
  return JSON.stringify({ v: STORAGE_VERSION, ...params });
}

export function fromStored(raw: string): ShadowParams | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const stored = data as Record<string, unknown>;
  if (stored.v === STORAGE_VERSION) return sanitize(stored);
  // v1: elevation was an overall size, distance and softness were fractions of it, and the
  // copies grew quadratically (closest to a spacing of 2).
  const size = num(stored.elevation, 24);
  return sanitize({
    ...stored,
    elevation: 0,
    distance: size * num(stored.distance, 0.5),
    softness: size * num(stored.softness, 1),
    spacing: 2,
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

export function computeLayers(params: ShadowParams): ShadowLayer[] {
  const p = sanitize(params);
  const reach = p.elevation + p.distance;
  const rad = (p.angle * Math.PI) / 180;
  const alpha = p.merge ? 1 : 1 - Math.pow(1 - p.opacity, 1 / p.layers);
  return distribute(p.layers, p.spacing).map((t) => {
    const offset = p.elevation + p.distance * t;
    return {
      x: round(Math.cos(rad) * offset, 2),
      y: round(Math.sin(rad) * offset, 2),
      blur: round(p.softness * (reach > 0 ? offset / reach : t), 2),
      alpha: round(alpha, 4),
      offset: round(offset, 2),
    };
  });
}

/** CSS box-shadow for the preview. Merged shadows also need the element's opacity set. */
export function toCss(params: ShadowParams): string {
  const { r, g, b } = hexToRgb(params.color);
  const rgb = [r, g, b].map((c) => Math.round(c * 255)).join(', ');
  return computeLayers(params)
    .map((l) => `${l.x}px ${l.y}px ${l.blur}px rgba(${rgb}, ${l.alpha})`)
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
  const n = parseInt((normalizeHex(hex) ?? DEFAULTS.color).slice(1), 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
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
