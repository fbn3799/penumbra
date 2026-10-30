import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULTS,
  CURVE_REACH_X,
  CURVE_REACH_Y,
  EASE_IN,
  LINEAR,
  MAX_LAYERS,
  MAX_LIGHTS,
  MAX_SHADOWS,
  applyPatch,
  bands,
  computeCopies,
  dropCopies,
  ease,
  fromSpacing,
  fromStored,
  hexToRgb,
  innerCopies,
  insertAt,
  mixHex,
  normalizeHex,
  readHandles,
  sanitize,
  sanitizeList,
  toCss,
  toStored,
  type Curve,
  type Light,
  type ShadowLayer,
  type ShadowParams,
} from '../src/shadow';

/** Settings with one distance and end softness for every light (no start softness), as they were
 *  before v5. Colors are linked when they're the same, as sanitize reads a shadow without the flag. */
type Flat = Partial<ShadowParams> & { distance?: number; softness?: number; angles?: number[] };
const { colorLinked: _, ...BASE } = DEFAULTS;
const p = ({ distance = 14, softness = 28, angles = [90], ...patch }: Flat): ShadowParams =>
  sanitize({ ...BASE, lights: angles.map((angle) => ({ angle, distance, startSoftness: 0, endSoftness: softness })), ...patch });
/** A light as written before v7 reads back as this one. */
const light = (angle: number, distance: number, softness: number): Light => ({ angle, distance, startSoftness: 0, endSoftness: softness });
/** A curve from (0, 0) to (1, 1) through two handles. */
const handles = (x1: number, y1: number, x2: number, y2: number): Curve => [[0, 0], [x1, y1], [x2, y2], [1, 1]];
const copies = (patch: Flat) => computeCopies(p(patch));
const angles = (s: ShadowParams) => s.lights.map((l) => l.angle);
const gaps = (ts: number[]) => ts.map((t, i) => t - (i ? ts[i - 1] : 0));
const shares = (curve: Curve, n: number) => Array.from({ length: n }, (_, k) => ease(curve, (k + 1) / n));
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;
/** How strong band k comes out: copies k…n composited. */
const band = (stack: ShadowLayer[], k: number) => 1 - stack.slice(k).reduce((rest, l) => rest * (1 - l.alpha), 1);

test('one copy is a single solid shadow at the far end, at the start strength and color', () => {
  const [layer, ...rest] = copies({ layers: 1, elevation: 4, distance: 16, softness: 30, startOpacity: 0.4, endOpacity: 0.1, startColor: '#ff0000' });
  assert.equal(rest.length, 0);
  assert.deepEqual(layer, { x: 0, y: 20, blur: 30, color: '#ff0000', alpha: 0.4, offset: 20, light: 0 });
});

test('elevation is the gap before the shadow starts, distance the reach beyond it', () => {
  const stack = copies({ layers: 5, elevation: 10, distance: 30, distanceCurve: LINEAR });
  assert.ok(stack.every((l) => l.offset > 10), 'every copy sits past the gap');
  assert.deepEqual(stack.map((l) => l.offset), [16, 22, 28, 34, 40]);
});

test('the distance curve places the copies; a straight line spaces them evenly', () => {
  assert.deepEqual(gaps(shares(LINEAR, 4)).map((g) => +g.toFixed(9)), [0.25, 0.25, 0.25, 0.25]);
  assert.deepEqual([ease(EASE_IN, 0), ease(EASE_IN, 1)].map((v) => +v.toFixed(9)), [0, 1], 'from 0 to 1');
  const widening = gaps(shares(EASE_IN, 4));
  widening.slice(1).forEach((g, i) => assert.ok(g > widening[i], 'the default widens towards the far end'));
  for (const curve of [LINEAR, EASE_IN, handles(0, 1, 0, 1), handles(1, 0, 1, 0)]) assert.ok(near(shares(curve, 6)[5], 1, 1e-6), 'last copy at the far end');
});

test('a curve can start and end anywhere, and runs flat beyond its ends', () => {
  const late: Curve = [[0.2, 0.1], [0.4, 0.3], [0.6, 0.5], [0.8, 0.7]];
  assert.deepEqual([0, 0.1, 0.2, 0.5, 0.8, 0.9, 1].map((x) => +ease(late, x).toFixed(6)), [0.1, 0.1, 0.1, 0.4, 0.7, 0.7, 0.7], 'straight between its ends, flat beyond');
  const bent: Curve = [[0.2, 0.1], [0.3, 0.9], [0.5, 0.9], [0.8, 0.7]];
  assert.ok(ease(bent, 0.5) > 0.7, 'bends towards its handles');
  const over: Curve = [[0, 0], [0.4, 1.35], [0.6, 1.35], [1, 1]];
  assert.ok(ease(over, 0.6) > 1, 'handles past the square overshoot it');
  // Across, a handle past the far end is read along its own line; one behind its own end, upright.
  const xs = [0.1, 0.3, 0.5, 0.7, 0.9];
  const same = (a: Curve, b: Curve) => xs.every((x) => near(ease(a, x), ease(b, x), 1e-9));
  assert.ok(same([[0, 0], [1.25, 0.625], [0.67, 0.67], [1, 1]], [[0, 0], [1, 0.5], [0.67, 0.67], [1, 1]]), 'past the far end: shortened, same direction');
  assert.ok(same([[0, 0], [0.33, 0.33], [-0.25, 0.375], [1, 1]], [[0, 0], [0.33, 0.33], [0, 0.5], [1, 1]]), 'the end handle past the start, too');
  assert.ok(same([[0, 0], [-0.2, 0.8], [0.67, 0.67], [1, 1]], [[0, 0], [0, 0.8], [0.67, 0.67], [1, 1]]), 'behind its own end: upright');
  assert.deepEqual(readHandles([[0, 0], [1.25, 0.625], [1.2, 0.4], [1, 1]]), [[0, 0], [1, 0.5], [1, 0.4], [1, 1]]);
  // An overshooting curve never puts a copy behind the object or below no blur.
  const under = computeCopies(p({ layers: 4, elevation: 0, distanceCurve: [[0, 0], [0.4, -0.35], [0.6, -0.35], [1, 1]], blurCurve: [[0, 0], [0.4, -0.35], [0.6, -0.35], [1, 1]] }));
  assert.ok(under.every((l) => l.offset >= 0 && l.blur >= 0), JSON.stringify(under.map((l) => [l.offset, l.blur])));
  // Stored before v7: the two handles alone.
  assert.deepEqual(sanitize({ distanceCurve: [0.2, 0.05, 0.7, 0.08] }).distanceCurve, EASE_IN);
  assert.deepEqual(sanitize({ blurCurve: [[0.9, 0], [0.5, 0.5], [0.5, 0.5], [0.5, 1]] }).blurCurve, LINEAR, 'an end left of its start: the default');
});

test("old spacing becomes the curve closest to it", () => {
  // The old default, 2× over 4 copies, put them at 1/15, 3/15, 7/15 and the far end.
  shares(fromSpacing(2, 4), 4).forEach((t, k) => assert.ok(Math.abs(t - (2 ** (k + 1) - 1) / 15) < 0.005, `copy ${k + 1}`));
  shares(EASE_IN, 4).forEach((t, k) => assert.ok(Math.abs(t - (2 ** (k + 1) - 1) / 15) < 0.005, 'the default matches it'));
  assert.deepEqual(fromSpacing(1, 6), LINEAR);
  const halving = gaps(shares(fromSpacing(0.5, 4), 4));
  assert.ok(halving[0] > halving[3], 'below 1×, the widest gaps sit next to the object');
});

test('blur runs from start to end softness, in step with offset', () => {
  assert.deepEqual(copies({ layers: 4, elevation: 8, distance: 8, softness: 32, distanceCurve: LINEAR }).map((l) => l.blur), [20, 24, 28, 32]);
  assert.deepEqual(copies({ layers: 2, elevation: 0, distance: 0, softness: 10, distanceCurve: LINEAR }).map((l) => l.blur), [5, 10], 'no reach: blur still spreads');
  // A blur curve that stays low keeps the near copies sharp; the farthest still gets the softness.
  const sharp = copies({ layers: 4, elevation: 8, distance: 8, softness: 32, distanceCurve: LINEAR, blurCurve: handles(1, 0, 1, 0) }).map((l) => l.blur);
  assert.ok(sharp.slice(0, 3).every((b, i) => b < [20, 24, 28][i]) && sharp[3] === 32, `${sharp}`);
  // From 10 px at the object to 30 at the far end.
  const ramp = computeCopies(p({ layers: 4, elevation: 0, distanceCurve: LINEAR, lights: [{ angle: 90, distance: 40, startSoftness: 10, endSoftness: 30 }] }));
  assert.deepEqual(ramp.map((l) => l.blur), [15, 20, 25, 30]);
});

test('the overlap comes out at start next to the object and end at the far end', () => {
  for (const [layers, start, end] of [[2, 0.3, 0.05], [4, 0.32, 0.05], [7, 0.6, 0], [4, 1, 0.2]]) {
    const stack = copies({ layers, startOpacity: start, endOpacity: end });
    assert.ok(Math.abs(band(stack, 0) - start) < 0.001, `${layers} copies: near ${band(stack, 0)} ≠ ${start}`);
    assert.ok(Math.abs(band(stack, layers - 1) - end) < 0.001, `${layers} copies: far end`);
    for (let k = 0; k < layers; k++) {
      const expected = start + ((end - start) * k) / (layers - 1);
      assert.ok(Math.abs(band(stack, k) - expected) < 0.001, `band ${k} steps evenly`);
    }
  }
});

test('no copy is stronger than the ones nearer the object; the far copies share the fade instead', () => {
  for (const [layers, start, end] of [[12, 1, 0.6], [4, 0.3, 0.3], [12, 0.25, 0.25], [6, 0.8, 0.5], [4, 0.32, 0.1]]) {
    const stack = copies({ layers, startOpacity: start, endOpacity: end });
    stack.slice(1).forEach((l, k) => assert.ok(l.alpha <= stack[k].alpha + 1e-9, `${layers} copies, ${start}→${end}: copy ${k + 2} stronger than ${k + 1}`));
    assert.ok(Math.abs(band(stack, 0) - start) < 0.001, 'start kept');
    assert.ok(stack[layers - 1].alpha < end, 'the far end comes out lighter');
    for (let k = 1; k < layers; k++) assert.ok(band(stack, k) < band(stack, k - 1), 'fades outward');
  }
  // 100 → 60 over 12: the three nearest copies step evenly, the far 8 share the rest.
  const yours = copies({ layers: 12, startOpacity: 1, endOpacity: 0.6 }).map((l) => +l.alpha.toFixed(3));
  assert.deepEqual(yours.slice(1, 4), [0.5, 0.333, 0.25]);
  assert.ok(yours.slice(4).every((a) => a === yours[4]), `${yours}`);
  assert.deepEqual(bands(p({ layers: 3, startOpacity: 0.1, endOpacity: 0.4 })), [0.4, 0.4, 0.4], 'a start lighter than the end levels out at the end');
});

test('opacity and color curves shape the steps from start to end', () => {
  const flat: Flat = { layers: 5, startOpacity: 0.4, endOpacity: 0.1, startColor: '#000000', endColor: '#ff0000' };
  const even = bands(p(flat));
  assert.deepEqual(even.map((t) => +t.toFixed(3)), [0.4, 0.325, 0.25, 0.175, 0.1], 'a straight curve steps evenly');
  // A curve that stays low keeps the copies near the start for longer.
  const late = handles(1, 0, 1, 0);
  const held = bands(p({ ...flat, opacityCurve: late }));
  assert.ok(held[2] > even[2] && held[0] === 0.4 && Math.abs(held[4] - 0.1) < 1e-9, `${held}`);
  const colors = computeCopies(p({ ...flat, colorCurve: late })).map((l) => l.color);
  assert.deepEqual([colors[0], colors[4]], ['#000000', '#ff0000'], 'the ends keep their colors');
  assert.ok(parseInt(colors[2].slice(1, 3), 16) < 0x80, `${colors[2]} stays nearer the start`);
  // Past the square, strength stays within 0–100% and colors within start and end.
  const wild = computeCopies(p({ ...flat, opacityCurve: handles(0.3, 1.5, 0.7, -0.5), colorCurve: handles(0.3, 1.5, 0.7, -0.5) }));
  assert.ok(wild.every((l) => l.alpha >= 0 && l.alpha <= 1 && /^#[0-9a-f]{6}$/.test(l.color)), JSON.stringify(wild.map((l) => [l.alpha, l.color])));
});

test('color steps from start to end, nearest copy first', () => {
  const stack = copies({ layers: 3, startColor: '#000000', endColor: '#ff0080' });
  assert.deepEqual(stack.map((l) => l.color), ['#000000', '#800040', '#ff0080']);
  assert.equal(mixHex('#102030', '#102030', 0.37), '#102030');
});

test('angle aims the shadow, 90° falls straight down', () => {
  const at = (angle: number) => copies({ layers: 1, angles: [angle], elevation: 0, distance: 10 })[0];
  assert.deepEqual([at(90).x, at(90).y], [0, 10]);
  assert.deepEqual([at(0).x, at(0).y], [10, 0]);
  assert.deepEqual([at(180).x, at(180).y], [-10, 0]);
  assert.deepEqual([at(270).x, at(270).y], [0, -10]);
  assert.ok(!Object.is(at(180).y, -0), 'no negative zero');
});

test('sanitize fills defaults, clamps, wraps the angle, rejects junk', () => {
  assert.deepEqual(sanitize(null), DEFAULTS);
  assert.deepEqual(sanitize('nope'), DEFAULTS);
  const junk = [{ angle: -30, distance: -5, softness: 2000 }, { angle: 400 }, { angle: 'x', distance: NaN }, 'nope', { angle: 20 }];
  const s = sanitize({ startOpacity: 3, endOpacity: -1, elevation: -5, layers: 99.6, lights: junk, startColor: 'ABC', endColor: 'nope', blendMode: 'NOPE', distanceCurve: [2, -1, 0.5, 0.5], blurCurve: [1, 2] });
  assert.equal(s.startOpacity, 1);
  assert.equal(s.endOpacity, 0);
  assert.equal(s.elevation, 0);
  assert.equal(s.layers, MAX_LAYERS);
  assert.deepEqual(s.distanceCurve, handles(1 + CURVE_REACH_X, -CURVE_REACH_Y, 0.5, 0.5), 'handles may reach past the unit square on every side, no further');
  assert.deepEqual(sanitize({ blurCurve: [[-1, 2], [0.5, 2], [0.5, -2], [3, -1]] }).blurCurve, [[0, 1], [0.5, 1 + CURVE_REACH_Y], [0.5, -CURVE_REACH_Y], [1, 0]], 'ends stay in it');
  assert.deepEqual(s.blurCurve, LINEAR, 'junk to the default');
  assert.deepEqual(angles(s), [330], 'wrapped; one light for now');
  assert.equal(s.lights.length, MAX_LIGHTS);
  assert.deepEqual([s.lights[0].distance, s.lights[0].endSoftness], [0, 1000], 'clamped');
  assert.deepEqual(sanitize({ lights: [{ angle: 'x', distance: NaN }] }).lights[0], DEFAULTS.lights[0], 'junk to the defaults');
  assert.deepEqual(sanitize({ lights: [] }).lights, DEFAULTS.lights);
  // Before v5: one distance and softness for every light; before v4, one angle.
  assert.deepEqual(sanitize({ angles: [10, 200], distance: 30, softness: 5 }).lights, [light(10, 30, 5)], 'several lights keep the first');
  assert.deepEqual(sanitize({ angle: 45 }).lights, [{ ...DEFAULTS.lights[0], angle: 45 }], 'a v3 angle becomes one light');
  assert.equal(s.startColor, '#aabbcc');
  assert.equal(s.endColor, DEFAULTS.endColor);
  assert.equal(s.colorLinked, false, 'two colors: not linked');
  assert.equal(s.blendMode, 'NORMAL');
  assert.deepEqual(sanitize({ colorLinked: true, startColor: '#ff0000', endColor: '#0000ff' }).endColor, '#ff0000', 'linked: the end takes the start color');
  assert.equal(sanitize({ startColor: '#123456', endColor: '#123456' }).colorLinked, true, 'one color: linked');
  assert.deepEqual([s.visible, sanitize({ visible: false }).visible], [true, false], 'shown unless hidden');
  assert.deepEqual(sanitizeList('nope'), []);
  assert.equal(sanitizeList(Array(20).fill({})).length, MAX_SHADOWS);
});

test('drop copies count every shown drop shadow', () => {
  assert.equal(dropCopies([p({ layers: 6 }), p({ layers: 4 })]), 10);
  assert.equal(dropCopies([]), 0);
  assert.equal(dropCopies([p({ layers: 3 }), p({ layers: 4, inner: true })]), 3, 'inner shadows apart');
  assert.equal(innerCopies([p({ layers: 3, inner: true }), p({ layers: 4 })]), 3);
  assert.equal(dropCopies([p({ layers: 6, visible: false }), p({ layers: 4 })]), 4, 'hidden shadows draw nothing');
  assert.equal(innerCopies([p({ layers: 6, inner: true, visible: false })]), 0);
});

test('stored shadows round-trip; v1 and v2 shadows convert', () => {
  const list = [
    p({ startColor: '#ff3366', endColor: '#112233', blendMode: 'MULTIPLY', layers: 20, angles: [120, 60], distanceCurve: [[0.1, 0.2], [0.1, 0.6], [0.3, 0.9], [0.9, 1]], blurCurve: EASE_IN }),
    p({ layers: 1, elevation: 0, linked: false, inner: true, visible: false }),
  ];
  assert.deepEqual(fromStored(toStored(list)), list);
  assert.equal(fromStored(toStored([])), null);
  assert.equal(fromStored('{oops'), null);

  // v2 as effects: every copy at the same alpha, so it faded to one copy's alpha.
  const [v2] = fromStored(JSON.stringify({ v: 2, color: '#112233', opacity: 0.3, layers: 4, elevation: 2, distance: 14, softness: 28, spacing: 2, merge: false }))!;
  assert.deepEqual([v2.startColor, v2.endColor, v2.startOpacity], ['#112233', '#112233', 0.3]);
  assert.ok(near(v2.endOpacity, 1 - Math.pow(0.7, 1 / 4)));
  const [merged] = fromStored(JSON.stringify({ v: 2, opacity: 0.25, merge: true }))!;
  assert.deepEqual([merged.startOpacity, merged.endOpacity], [0.25, 0.25]);

  // v3: one angle per shadow, no links. Shadows cast the same way start out linked.
  const v3 = (list: number[]) => JSON.stringify({ v: 3, shadows: list.map((angle) => ({ ...DEFAULTS, lights: undefined, angle })) });
  assert.deepEqual(fromStored(v3([60, 60]))!.map((s) => [angles(s), s.linked]), [[[60], true], [[60], true]]);
  assert.deepEqual(fromStored(v3([60, 90]))!.map((s) => [angles(s), s.linked]), [[[60], false], [[90], false]]);

  // v4: the lights shared the shadow's distance and softness.
  const v4 = JSON.stringify({ v: 4, shadows: [{ ...DEFAULTS, lights: undefined, angles: [45, 135], distance: 417, softness: 142, linked: false }] });
  assert.deepEqual(fromStored(v4)![0].lights, [light(45, 417, 142)], 'the first light, for now');
  assert.equal(fromStored(v4)![0].linked, false);

  // v5: spacing and merge. Spacing becomes a curve; merged shadows become plain ones.
  const v5 = JSON.stringify({ v: 5, shadows: [{ ...DEFAULTS, distanceCurve: undefined, blurCurve: undefined, colorLinked: undefined, spacing: 2, layers: 4, merge: true, edge: 0 }] });
  const [old] = fromStored(v5)!;
  assert.deepEqual(old.distanceCurve, fromSpacing(2, 4));
  assert.deepEqual([old.blurCurve, old.colorLinked, 'merge' in old, 'edge' in old], [LINEAR, true, false, false]);

  const [v1] = fromStored(JSON.stringify({ elevation: 24, distance: 0.5, softness: 1, layers: 4, opacity: 0.3 }))!;
  assert.deepEqual([v1.elevation, v1.lights[0].distance, v1.lights[0].endSoftness, v1.distanceCurve, v1.startOpacity], [0, 12, 24, fromSpacing(2, 4), 0.3]);
});

test('the light sets distance and softness; elevation is the object\'s', () => {
  const stack = copies({ layers: 2, elevation: 2, distanceCurve: LINEAR, lights: [light(0, 30, 12)] });
  assert.deepEqual(stack.map((l) => [l.light, l.x, l.y, l.blur]), [[0, 17, 0, 6.38], [0, 32, 0, 12]]);
});

test('linked shadows turn together and keep their own distance and softness', () => {
  const lit = (angle: number, distance: number) => [light(angle, distance, distance * 2)];
  const list = [p({ lights: lit(90, 10) }), p({ lights: lit(90, 100) }), p({ lights: lit(10, 5), linked: false })];
  const turned = applyPatch(list, 1, { lights: lit(45, 120) });
  assert.deepEqual(turned.map(angles), [[45], [45], [10]], 'turning one linked shadow turns them all');
  assert.deepEqual(turned.map((s) => s.lights[0].distance), [10, 120, 5], 'each keeps its own distance');
  const own = applyPatch(turned, 2, { lights: lit(20, 5) });
  assert.deepEqual(own.map(angles), [[45], [45], [20]], 'an unlinked shadow turns alone');
  const joined = applyPatch(own, 2, { linked: true });
  assert.deepEqual(joined[2].lights, [light(45, 5, 10)], 'a shadow that joins turns like the rest');
  const left = applyPatch(joined, 0, { linked: false, lights: lit(0, 10) });
  assert.deepEqual(left.map(angles), [[0], [45], [45]], 'leaving and turning in one edit leaves the rest');
  assert.equal(applyPatch(list, 5, { layers: 2 }), list, 'out of range: unchanged');
  assert.deepEqual(angles(insertAt(turned, 1, p({ angles: [300] }))[1]), [45], 'a linked new shadow turns like the rest');
  assert.deepEqual(angles(insertAt(turned, 9, p({ angles: [300], linked: false }))[3]), [300]);
});

test('colors', () => {
  assert.equal(normalizeHex('#FFF'), '#ffffff');
  assert.equal(normalizeHex('12ab'), null);
  assert.deepEqual(hexToRgb('#ff8000'), { r: 1, g: 128 / 255, b: 0 });
  assert.equal(toCss(p({ layers: 1, startColor: '#000000', startOpacity: 0.5, elevation: 0, distance: 5, softness: 10 })), '0px 5px 10px rgba(0, 0, 0, 0.5)');
  assert.equal(
    toCss(p({ layers: 2, startColor: '#000000', endColor: '#ffffff', startOpacity: 0.5, endOpacity: 0.5, elevation: 0, distance: 4, softness: 0, distanceCurve: LINEAR })),
    '0px 2px 0px rgba(0, 0, 0, 0.2929), 0px 4px 0px rgba(255, 255, 255, 0.2929)',
  );
});
