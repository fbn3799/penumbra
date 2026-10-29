import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULTS,
  computeLayers,
  distribute,
  fromStored,
  hexToRgb,
  normalizeHex,
  sanitize,
  toCss,
  toStored,
  type ShadowParams,
} from '../src/shadow';

const p = (patch: Partial<ShadowParams>): ShadowParams => sanitize({ ...DEFAULTS, ...patch });
const gaps = (ts: number[]) => ts.map((t, i) => t - (i ? ts[i - 1] : 0));
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;

test('one copy is a single solid shadow at the far end', () => {
  const [layer, ...rest] = computeLayers(p({ layers: 1, elevation: 4, distance: 16, softness: 30, opacity: 0.4 }));
  assert.equal(rest.length, 0);
  assert.deepEqual(layer, { x: 0, y: 20, blur: 30, alpha: 0.4, offset: 20 });
});

test('elevation is the gap before the shadow starts, distance the reach beyond it', () => {
  const stack = computeLayers(p({ layers: 5, elevation: 10, distance: 30, spacing: 1 }));
  assert.ok(stack.every((l) => l.offset > 10), 'every copy sits past the gap');
  assert.equal(stack[stack.length - 1].offset, 40);
  assert.deepEqual(stack.map((l) => l.offset), [16, 22, 28, 34, 40]);
});

test('spacing: 1 is even, above 1 widens towards the end, below 1 towards the object', () => {
  assert.deepEqual(gaps(distribute(4, 1)), [0.25, 0.25, 0.25, 0.25]);
  const doubling = gaps(distribute(4, 2));
  doubling.slice(1).forEach((g, i) => assert.ok(near(g / doubling[i], 2), 'each gap doubles'));
  const halving = gaps(distribute(4, 0.5));
  halving.slice(1).forEach((g, i) => assert.ok(near(g / halving[i], 0.5), 'each gap halves'));
  assert.ok(halving[3] < halving[2], 'last gap is not the widest');
  for (const s of [0.25, 0.5, 1, 1.5, 4]) assert.ok(near(distribute(6, s)[5], 1), 'last copy at the far end');
});

test('blur grows with offset, up to softness for the farthest copy', () => {
  const stack = computeLayers(p({ layers: 4, elevation: 8, distance: 8, softness: 32, spacing: 1 }));
  assert.deepEqual(stack.map((l) => l.blur), [20, 24, 28, 32]);
  const resting = computeLayers(p({ layers: 2, elevation: 0, distance: 0, softness: 10, spacing: 1 }));
  assert.deepEqual(resting.map((l) => l.blur), [5, 10], 'no reach: blur still spreads');
});

test('as effects, the stack composites to the requested opacity', () => {
  for (const layers of [2, 4, 7, 12]) {
    const stack = computeLayers(p({ layers, opacity: 0.32 }));
    const combined = 1 - stack.reduce((rest, l) => rest * (1 - l.alpha), 1);
    assert.ok(Math.abs(combined - 0.32) < 0.002, `${layers} layers → ${combined}`);
  }
});

test('merged copies are opaque; opacity moves to the layer', () => {
  assert.ok(computeLayers(p({ merge: true, opacity: 0.2 })).every((l) => l.alpha === 1));
});

test('angle aims the shadow, 90° falls straight down', () => {
  const at = (angle: number) => computeLayers(p({ layers: 1, angle, elevation: 0, distance: 10 }))[0];
  assert.deepEqual([at(90).x, at(90).y], [0, 10]);
  assert.deepEqual([at(0).x, at(0).y], [10, 0]);
  assert.deepEqual([at(180).x, at(180).y], [-10, 0]);
  assert.deepEqual([at(270).x, at(270).y], [0, -10]);
  assert.ok(!Object.is(at(180).y, -0), 'no negative zero');
});

test('sanitize fills defaults, clamps, wraps the angle, rejects junk', () => {
  assert.deepEqual(sanitize(null), DEFAULTS);
  assert.deepEqual(sanitize('nope'), DEFAULTS);
  const s = sanitize({ opacity: 3, elevation: -5, layers: 99.6, angle: -30, color: 'ABC', blendMode: 'NOPE', distance: NaN, spacing: 9, merge: 'yes' });
  assert.equal(s.opacity, 1);
  assert.equal(s.elevation, 0);
  assert.equal(s.layers, 12);
  assert.equal(s.angle, 330);
  assert.equal(s.color, '#aabbcc');
  assert.equal(s.blendMode, 'NORMAL');
  assert.equal(s.distance, DEFAULTS.distance);
  assert.equal(s.spacing, 4);
  assert.equal(s.merge, false);
});

test('stored settings round-trip, and v1 shadows convert to the same reach', () => {
  const params = p({ color: '#ff3366', blendMode: 'MULTIPLY', layers: 6, angle: 120, spacing: 0.5, merge: true });
  assert.deepEqual(fromStored(toStored(params)), params);
  const v1 = fromStored(JSON.stringify({ elevation: 24, distance: 0.5, softness: 1, layers: 4, opacity: 0.3 }))!;
  assert.deepEqual([v1.elevation, v1.distance, v1.softness, v1.spacing], [0, 12, 24, 2]);
  assert.equal(fromStored('{oops'), null);
});

test('colors', () => {
  assert.equal(normalizeHex('#FFF'), '#ffffff');
  assert.equal(normalizeHex('12ab'), null);
  assert.deepEqual(hexToRgb('#ff8000'), { r: 1, g: 128 / 255, b: 0 });
  assert.equal(toCss(p({ layers: 1, color: '#000000', opacity: 0.5, elevation: 0, distance: 5, softness: 10 })), '0px 5px 10px rgba(0, 0, 0, 0.5)');
});
