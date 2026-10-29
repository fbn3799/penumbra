import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULTS, computeLayers, hexToRgb, normalizeHex, sanitize, toCss, type ShadowParams } from '../src/shadow';

const p = (patch: Partial<ShadowParams>): ShadowParams => sanitize({ ...DEFAULTS, ...patch });

test('one layer is a single solid shadow with the exact settings', () => {
  const [layer, ...rest] = computeLayers(p({ layers: 1, elevation: 20, distance: 0.5, softness: 1.5, opacity: 0.4 }));
  assert.equal(rest.length, 0);
  assert.deepEqual(layer, { x: 0, y: 10, blur: 30, alpha: 0.4 });
});

test('a stack composites to the requested opacity', () => {
  for (const layers of [2, 4, 7, 12]) {
    const stack = computeLayers(p({ layers, opacity: 0.32 }));
    const combined = 1 - stack.reduce((rest, l) => rest * (1 - l.alpha), 1);
    assert.ok(Math.abs(combined - 0.32) < 0.002, `${layers} layers → ${combined}`);
  }
});

test('layers grow from contact to full throw', () => {
  const stack = computeLayers(p({ layers: 4, elevation: 32, distance: 0.5, softness: 1 }));
  assert.deepEqual(stack.map((l) => l.y), [1, 4, 9, 16]);
  assert.deepEqual(stack.map((l) => l.blur), [2, 8, 18, 32]);
});

test('angle aims the shadow, 90° falls straight down', () => {
  const at = (angle: number) => computeLayers(p({ layers: 1, angle, elevation: 10, distance: 1 }))[0];
  assert.deepEqual([at(90).x, at(90).y], [0, 10]);
  assert.deepEqual([at(0).x, at(0).y], [10, 0]);
  assert.deepEqual([at(180).x, at(180).y], [-10, 0]);
  assert.deepEqual([at(270).x, at(270).y], [0, -10]);
  assert.ok(!Object.is(at(180).y, -0), 'no negative zero');
});

test('elevation zero rests on the surface', () => {
  for (const l of computeLayers(p({ elevation: 0 }))) assert.deepEqual([l.x, l.y, l.blur], [0, 0, 0]);
});

test('sanitize fills defaults, clamps, wraps the angle, rejects junk', () => {
  assert.deepEqual(sanitize(null), DEFAULTS);
  assert.deepEqual(sanitize('nope'), DEFAULTS);
  const s = sanitize({ opacity: 3, elevation: -5, layers: 99.6, angle: -30, color: 'ABC', blendMode: 'NOPE', distance: NaN });
  assert.equal(s.opacity, 1);
  assert.equal(s.elevation, 0);
  assert.equal(s.layers, 12);
  assert.equal(s.angle, 330);
  assert.equal(s.color, '#aabbcc');
  assert.equal(s.blendMode, 'NORMAL');
  assert.equal(s.distance, DEFAULTS.distance);
});

test('stored settings round-trip through JSON', () => {
  const params = p({ color: '#ff3366', blendMode: 'MULTIPLY', layers: 6, angle: 120 });
  assert.deepEqual(sanitize(JSON.parse(JSON.stringify(params))), params);
});

test('colors', () => {
  assert.equal(normalizeHex('#FFF'), '#ffffff');
  assert.equal(normalizeHex('12ab'), null);
  assert.deepEqual(hexToRgb('#ff8000'), { r: 1, g: 128 / 255, b: 0 });
  assert.equal(toCss(p({ layers: 1, color: '#000000', opacity: 0.5, elevation: 10 })), '0px 5px 10px rgba(0, 0, 0, 0.5)');
});
