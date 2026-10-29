import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULTS,
  MAX_SHADOWS,
  bands,
  computeCopies,
  distribute,
  fromStored,
  hexToRgb,
  looseCopies,
  mixHex,
  normalizeHex,
  sanitize,
  sanitizeList,
  toCss,
  toStored,
  type ShadowLayer,
  type ShadowParams,
} from '../src/shadow';

const p = (patch: Partial<ShadowParams>): ShadowParams => sanitize({ ...DEFAULTS, ...patch });
const copies = (patch: Partial<ShadowParams>) => computeCopies(p(patch)).copies;
const gaps = (ts: number[]) => ts.map((t, i) => t - (i ? ts[i - 1] : 0));
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;
/** How strong band k comes out: copies k…n composited. */
const band = (stack: ShadowLayer[], k: number) => 1 - stack.slice(k).reduce((rest, l) => rest * (1 - l.alpha), 1);

test('one copy is a single solid shadow at the far end, at the start strength and color', () => {
  const [layer, ...rest] = copies({ layers: 1, elevation: 4, distance: 16, softness: 30, startOpacity: 0.4, endOpacity: 0.1, startColor: '#ff0000' });
  assert.equal(rest.length, 0);
  assert.deepEqual(layer, { x: 0, y: 20, blur: 30, color: '#ff0000', alpha: 0.4, offset: 20 });
});

test('elevation is the gap before the shadow starts, distance the reach beyond it', () => {
  const stack = copies({ layers: 5, elevation: 10, distance: 30, spacing: 1 });
  assert.ok(stack.every((l) => l.offset > 10), 'every copy sits past the gap');
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
  assert.deepEqual(copies({ layers: 4, elevation: 8, distance: 8, softness: 32, spacing: 1 }).map((l) => l.blur), [20, 24, 28, 32]);
  assert.deepEqual(copies({ layers: 2, elevation: 0, distance: 0, softness: 10, spacing: 1 }).map((l) => l.blur), [5, 10], 'no reach: blur still spreads');
});

test('as effects, the overlap comes out at start next to the object and end at the far end', () => {
  for (const [layers, start, end] of [[2, 0.3, 0.05], [4, 0.32, 0.1], [7, 0.6, 0], [12, 0.25, 0.25], [4, 1, 0.2]]) {
    const stack = copies({ layers, startOpacity: start, endOpacity: end });
    assert.ok(Math.abs(band(stack, 0) - start) < 0.001, `${layers} copies: near ${band(stack, 0)} ≠ ${start}`);
    assert.ok(Math.abs(band(stack, layers - 1) - end) < 0.001, `${layers} copies: far end`);
    for (let k = 0; k < layers; k++) {
      const expected = start + ((end - start) * k) / (layers - 1);
      assert.ok(Math.abs(band(stack, k) - expected) < 0.001, `band ${k} steps evenly`);
    }
  }
});

test('an even shadow is the last copy alone; a start lighter than the end levels out at the end', () => {
  const even = copies({ layers: 4, startOpacity: 0.3, endOpacity: 0.3 });
  assert.deepEqual(even.map((l) => l.alpha), [0, 0, 0, 0.3]);
  assert.deepEqual(bands(p({ layers: 3, startOpacity: 0.1, endOpacity: 0.4 })), [0.4, 0.4, 0.4]);
});

test('merged: the nearest copy is opaque and the layer carries the start strength', () => {
  const even = computeCopies(p({ merge: true, startOpacity: 0.2, endOpacity: 0.2 }));
  assert.equal(even.opacity, 0.2);
  assert.ok(even.copies.every((l) => l.alpha === 1), 'an even merged shadow is opaque throughout');
  const fading = computeCopies(p({ merge: true, layers: 4, startOpacity: 0.4, endOpacity: 0.1 }));
  assert.equal(fading.opacity, 0.4);
  assert.equal(fading.copies[0].alpha, 1);
  for (let k = 0; k < 4; k++) {
    assert.ok(Math.abs(band(fading.copies, k) * 0.4 - (0.4 - 0.1 * k)) < 0.001, `band ${k} with the layer opacity`);
  }
  assert.equal(computeCopies(p({ merge: false })).opacity, 1);
});

test('color steps from start to end, nearest copy first', () => {
  const stack = copies({ layers: 3, startColor: '#000000', endColor: '#ff0080' });
  assert.deepEqual(stack.map((l) => l.color), ['#000000', '#800040', '#ff0080']);
  assert.equal(mixHex('#102030', '#102030', 0.37), '#102030');
});

test('angle aims the shadow, 90° falls straight down', () => {
  const at = (angle: number) => copies({ layers: 1, angle, elevation: 0, distance: 10 })[0];
  assert.deepEqual([at(90).x, at(90).y], [0, 10]);
  assert.deepEqual([at(0).x, at(0).y], [10, 0]);
  assert.deepEqual([at(180).x, at(180).y], [-10, 0]);
  assert.deepEqual([at(270).x, at(270).y], [0, -10]);
  assert.ok(!Object.is(at(180).y, -0), 'no negative zero');
});

test('sanitize fills defaults, clamps, wraps the angle, rejects junk', () => {
  assert.deepEqual(sanitize(null), DEFAULTS);
  assert.deepEqual(sanitize('nope'), DEFAULTS);
  const s = sanitize({ startOpacity: 3, endOpacity: -1, elevation: -5, layers: 99.6, angle: -30, startColor: 'ABC', endColor: 'nope', blendMode: 'NOPE', distance: NaN, spacing: 9, merge: 'yes' });
  assert.equal(s.startOpacity, 1);
  assert.equal(s.endOpacity, 0);
  assert.equal(s.elevation, 0);
  assert.equal(s.layers, 12);
  assert.equal(s.angle, 330);
  assert.equal(s.startColor, '#aabbcc');
  assert.equal(s.endColor, DEFAULTS.endColor);
  assert.equal(s.blendMode, 'NORMAL');
  assert.equal(s.distance, DEFAULTS.distance);
  assert.equal(s.spacing, 4);
  assert.equal(s.merge, false);
  assert.deepEqual(sanitizeList('nope'), []);
  assert.equal(sanitizeList(Array(20).fill({})).length, MAX_SHADOWS);
});

test('loose copies count the shadows left as effects, not the merged ones', () => {
  assert.equal(looseCopies([p({ layers: 6 }), p({ layers: 5, merge: true }), p({ layers: 4 })]), 10);
  assert.equal(looseCopies([]), 0);
});

test('stored shadows round-trip; v1 and v2 shadows convert', () => {
  const list = [p({ startColor: '#ff3366', blendMode: 'MULTIPLY', layers: 6, angle: 120, spacing: 0.5, merge: true }), p({ layers: 1, elevation: 0 })];
  assert.deepEqual(fromStored(toStored(list)), list);
  assert.equal(fromStored(toStored([])), null);
  assert.equal(fromStored('{oops'), null);

  // v2 as effects: every copy at the same alpha, so it faded to one copy's alpha.
  const [v2] = fromStored(JSON.stringify({ v: 2, color: '#112233', opacity: 0.3, layers: 4, elevation: 2, distance: 14, softness: 28, spacing: 2, merge: false }))!;
  assert.deepEqual([v2.startColor, v2.endColor, v2.startOpacity], ['#112233', '#112233', 0.3]);
  assert.ok(near(v2.endOpacity, 1 - Math.pow(0.7, 1 / 4)));
  const [merged] = fromStored(JSON.stringify({ v: 2, opacity: 0.25, merge: true }))!;
  assert.deepEqual([merged.startOpacity, merged.endOpacity, merged.merge], [0.25, 0.25, true]);

  const [v1] = fromStored(JSON.stringify({ elevation: 24, distance: 0.5, softness: 1, layers: 4, opacity: 0.3 }))!;
  assert.deepEqual([v1.elevation, v1.distance, v1.softness, v1.spacing, v1.startOpacity], [0, 12, 24, 2, 0.3]);
});

test('colors', () => {
  assert.equal(normalizeHex('#FFF'), '#ffffff');
  assert.equal(normalizeHex('12ab'), null);
  assert.deepEqual(hexToRgb('#ff8000'), { r: 1, g: 128 / 255, b: 0 });
  assert.equal(toCss(p({ layers: 1, startColor: '#000000', startOpacity: 0.5, elevation: 0, distance: 5, softness: 10 })), '0px 5px 10px rgba(0, 0, 0, 0.5)');
  assert.equal(
    toCss(p({ layers: 2, startColor: '#000000', endColor: '#ffffff', startOpacity: 0.5, endOpacity: 0.5, elevation: 0, distance: 4, softness: 0, spacing: 1 })),
    '0px 2px 0px rgba(0, 0, 0, 0), 0px 4px 0px rgba(255, 255, 255, 0.5)',
  );
});
