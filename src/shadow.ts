// The shadow model, shared by the plugin (writes Figma effects) and the UI (draws the preview).
//
// An object floats `elevation` px above the surface. The light decides how far the shadow is
// thrown (`distance`, a fraction of elevation) and how diffuse it is (`softness`, also a
// fraction of elevation). With one layer that is a single solid shadow. With more, the stack
// grows quadratically from a tight contact shadow to the full throw, and each layer's alpha is
// chosen so the stack composites to exactly `opacity` — it reads as one shadow, not a pile.

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
  opacity: number; // 0–1, strength of the whole stack
  elevation: number; // px above the surface
  distance: number; // offset as a fraction of elevation
  softness: number; // blur as a fraction of elevation
  angle: number; // degrees the shadow is cast towards; 90 is straight down
  layers: number; // 1 = one solid shadow
  blendMode: ShadowBlendMode;
}

export interface ShadowLayer {
  x: number;
  y: number;
  blur: number;
  alpha: number;
}

export const MAX_LAYERS = 12;

export const DEFAULTS: ShadowParams = {
  color: '#0f172a',
  opacity: 0.32,
  elevation: 24,
  distance: 0.5,
  softness: 1,
  angle: 90,
  layers: 4,
  blendMode: 'NORMAL',
};

export function sanitize(input: unknown): ShadowParams {
  const p = { ...DEFAULTS, ...(input && typeof input === 'object' ? input : {}) } as ShadowParams;
  return {
    color: normalizeHex(p.color) ?? DEFAULTS.color,
    opacity: clamp(num(p.opacity, DEFAULTS.opacity), 0, 1),
    elevation: clamp(num(p.elevation, DEFAULTS.elevation), 0, 1000),
    distance: clamp(num(p.distance, DEFAULTS.distance), 0, 10),
    softness: clamp(num(p.softness, DEFAULTS.softness), 0, 10),
    angle: ((num(p.angle, DEFAULTS.angle) % 360) + 360) % 360,
    layers: Math.round(clamp(num(p.layers, DEFAULTS.layers), 1, MAX_LAYERS)),
    blendMode: BLEND_MODES.some(([mode]) => mode === p.blendMode) ? p.blendMode : DEFAULTS.blendMode,
  };
}

export function computeLayers(params: ShadowParams): ShadowLayer[] {
  const p = sanitize(params);
  const offset = p.elevation * p.distance;
  const blur = p.elevation * p.softness;
  const rad = (p.angle * Math.PI) / 180;
  const alpha = 1 - Math.pow(1 - p.opacity, 1 / p.layers);
  const layers: ShadowLayer[] = [];
  for (let i = 1; i <= p.layers; i++) {
    const k = (i / p.layers) ** 2;
    layers.push({
      x: round(Math.cos(rad) * offset * k, 2),
      y: round(Math.sin(rad) * offset * k, 2),
      blur: round(blur * k, 2),
      alpha: round(alpha, 4),
    });
  }
  return layers;
}

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
