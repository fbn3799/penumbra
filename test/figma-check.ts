// Runs the plugin's real node code inside a Figma file (via the Figma MCP's use_figma) and
// reports what it built. Build with `npm run figma-check`, then run the printed script.
import { clearShadows, readShadows, rematchSelection, resolve, writeShadows } from '../src/nodes';
import { LINEAR, sanitize, type ShadowParams } from '../src/shadow';

function autoLayout(name: string, mode: 'HORIZONTAL' | 'VERTICAL'): FrameNode {
  const frame = figma.createFrame();
  frame.name = name;
  frame.layoutMode = mode;
  frame.primaryAxisSizingMode = 'AUTO';
  frame.counterAxisSizingMode = 'AUTO';
  frame.itemSpacing = 24;
  return frame;
}

function card(parent: BaseNode & ChildrenMixin, name: string, x: number, y: number, w = 160, h = 104): FrameNode {
  const frame = figma.createFrame();
  frame.name = name;
  parent.appendChild(frame);
  frame.resize(w, h);
  frame.x = x;
  frame.y = y;
  frame.cornerRadius = 16;
  frame.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
  return frame;
}

/** A shadow from flat settings, which every light shares (sanitize reads them as a pre-v5 shadow). */
const s = (patch: Partial<ShadowParams> & { distance?: number; softness?: number; angles?: number[] }) => sanitize(patch);
/** Whether the plugin would rewrite this object's shadow layer now. */
function rematchSelectionOf(node: SceneNode): boolean {
  figma.currentPage.selection = [node];
  return rematchSelection();
}
const role = (n: BaseNode) => n.getSharedPluginData('penumbra', 'role');
const drops = (node: BlendMixin) => node.effects.filter((e): e is DropShadowEffect => e.type === 'DROP_SHADOW');
const origin = (node: SceneNode) => [Math.round(node.absoluteTransform[0][2]), Math.round(node.absoluteTransform[1][2])];
const layersOf = (group: BaseNode | null): SceneNode[] =>
  group && group.type === 'GROUP' ? group.children.filter((c) => role(c) === 'shadow').reverse() : [];
const partsOf = (layer: SceneNode): GroupNode[] =>
  'children' in layer ? (layer.children.filter((c) => role(c) === 'part') as GroupNode[]).reverse() : [];
/** A layer's drop shadows, bottom first, as one list. */
const layerDrops = (layer: SceneNode) => [...partsOf(layer)].reverse().flatMap(drops);
const hex = ({ r, g, b }: RGB) => '#' + [r, g, b].map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('');
const ys = (list: DropShadowEffect[]) => list.map((e) => Math.round(e.offset.y));
const look = (node: SceneNode & BlendMixin) => ({
  parent: node.parent!.type,
  objectDrops: drops(node).length,
  layers: layersOf(node.parent).map((l) => [l.type, l.name, partsOf(l).map((p) => p.name)]),
});

// Hard copies make the bands visible.
const hard = { elevation: 0, distance: 48, softness: 4, layers: 4, distanceCurve: LINEAR, angles: [60] };
const fade = { startOpacity: 0.5, endOpacity: 0.08, startColor: '#1d4ed8', endColor: '#c026d3' };
const contact = s({ elevation: 0, distance: 2, softness: 4, layers: 2, startOpacity: 0.25, endOpacity: 0.15 });
const ambient = s({ elevation: 4, distance: 28, softness: 48, layers: 4, startOpacity: 0.22, endOpacity: 0.03, startColor: '#334155', endColor: '#64748b' });
// Twelve hard copies 4 px apart, straight down: offsets 4, 8, … 48.
const twelve = { elevation: 0, distance: 48, softness: 2, layers: 12, distanceCurve: LINEAR, angles: [90], startOpacity: 0.6, endOpacity: 0.05 };

export async function run() {
  for (const old of figma.currentPage.children.filter((n) => n.name === 'Penumbra check' || n.name === 'Order test')) old.remove();
  const board = figma.createFrame();
  board.name = 'Penumbra check';
  figma.currentPage.appendChild(board);
  board.resize(1040, 900);
  board.x = 100;
  board.y = 100;
  board.fills = [{ type: 'SOLID', color: { r: 0.93, g: 0.94, b: 0.95 } }];

  // Start → end as effects: blue next to the object, fading to faint magenta.
  const a = card(board, 'Gradient', 40, 40);
  writeShadows(a, [s({ ...hard, ...fade })], true);
  const gradient = drops(a).map((e) => [hex(e.color), +e.color.a.toFixed(3), e.offset.y]);

  // Two shadows: the first (contact) draws on top, so its copies come last.
  const c = card(board, 'Two shadows', 290, 40);
  writeShadows(c, [contact, ambient], true);
  const two = drops(c).map((e) => [e.offset.y, e.radius, +e.color.a.toFixed(3)]);

  // Twelve copies: all of them on one layer below, in parts of 8 and 4, none left on the object.
  const d = card(board, 'Twelve', 540, 40);
  writeShadows(d, [s({ ...twelve, ...fade })], true);
  const wrapper = d.parent as GroupNode;
  const dLayer = layersOf(wrapper)[0];
  const overflow = {
    ...look(d),
    wrapper: [wrapper.type, wrapper.name, wrapper.children.map((n) => n.name)],
    layer: [dLayer.name, (dLayer as GroupNode).opacity, (dLayer as GroupNode).blendMode, dLayer.locked],
    drops: ys(layerDrops(dLayer)),
    resolves: [resolve(wrapper)?.id === d.id, resolve(dLayer)?.id === d.id, resolve(partsOf(dLayer)[0])?.id === d.id],
  };

  // Two shadows of 6: all 12 on the layer, the first shadow's on top.
  const h = card(board, '6 + 6', 790, 40);
  writeShadows(h, [s({ ...twelve, layers: 6, distance: 24, startColor: '#1d4ed8', endColor: '#1d4ed8' }), s({ ...twelve, layers: 6, startColor: '#c026d3', endColor: '#c026d3' })], true);
  const sixAndSix = { objectDrops: drops(h).length, layer: layersOf(h.parent).map((l) => layerDrops(l).map((e) => [hex(e.color), Math.round(e.offset.y)])) };

  // Thirty-two copies: four parts of 8.
  const t = card(board, 'Thirty-two', 40, 260);
  writeShadows(t, [s({ ...twelve, layers: 32, distance: 64 })], true);
  const thirtyTwo = look(t);

  // Back to 8: the layer and the group go, the copies return to the object.
  const j = card(board, 'Back to 8', 290, 260, 120, 80);
  writeShadows(j, [s({ ...twelve })], true);
  const grouped = j.parent!.type;
  writeShadows(j, [s({ ...twelve, layers: 8 })], true);
  const backTo8 = { grouped, after: look(j) };

  // Inside auto layout the group takes the card's slot; nothing should move.
  const row = autoLayout('Row', 'HORIZONTAL');
  board.appendChild(row);
  row.x = 460;
  row.y = 270;
  row.fills = [];
  const cards = [0, 1, 2].map((i) => card(row, `Row ${i}`, 0, 0, 100, 80));
  const before = cards.map(origin);
  writeShadows(cards[1], [s({ ...twelve })], true);
  const layout = { before, after: cards.map(origin), middleParent: cards[1].parent!.type };

  // Can't be grouped: Figma's cap applies, the bottom copies are left out and the note says so.
  const tight = autoLayout('Tight', 'VERTICAL');
  board.appendChild(tight);
  tight.x = 40;
  tight.y = 440;
  tight.fills = [];
  tight.resize(200, 80);
  tight.counterAxisSizingMode = 'FIXED';
  const k = card(tight, 'Fills, 12', 0, 0, 120, 60);
  k.layoutSizingHorizontal = 'FILL';
  const kResult = writeShadows(k, [s({ ...twelve })], true);
  const capped = { note: kResult.note, drops: ys(drops(k)), parent: k.parent!.type };

  // Resized: the silhouettes are copied again on a rematching write.
  const e = card(board, 'Resized', 290, 440);
  writeShadows(e, [s({ ...twelve })], true);
  e.resize(200, 104);
  writeShadows(e, readShadows(e)!, true);
  const rematch = partsOf(layersOf(e.parent)[0]).map((part) => {
    const silhouette = part.children.find((n) => 'isMask' in n && n.isMask)!;
    return [silhouette.width, silhouette.height];
  });

  // Left from earlier versions: copies split between object and layer, a hard outline's frame, and
  // a merged shadow whose copies now fit on the object. Selecting each rewrites it.
  const v1 = card(board, 'Old split', 540, 470, 120, 80);
  writeShadows(v1, [s({ ...twelve })], true);
  v1.effects = layerDrops(layersOf(v1.parent)[0]).slice(-8);
  const splitFixed = { rewrote: rematchSelectionOf(v1), ...look(v1) };
  const v4Outline = card(board, 'Old outline', 700, 470, 120, 80);
  writeShadows(v4Outline, [s({ ...twelve })], true);
  const outline = figma.createFrame();
  (v4Outline.parent as GroupNode).insertChild(0, outline);
  outline.setSharedPluginData('penumbra', 'role', 'shadow');
  const outlineFixed = { rewrote: rematchSelectionOf(v4Outline), ...look(v4Outline) };
  const v4Merged = card(board, 'Old merged', 860, 470, 120, 80);
  writeShadows(v4Merged, [s({ ...twelve })], true);
  v4Merged.setSharedPluginData('penumbra', 'shadow', JSON.stringify({ v: 5, shadows: [{ ...contact, merge: true, edge: null, spacing: 2 }] }));
  const mergedFixed = { rewrote: rematchSelectionOf(v4Merged), ...look(v4Merged), keepsMerge: Object.keys(readShadows(v4Merged)![0]).includes('merge') };

  // Text casts its own glyph silhouette, here with a color gradient.
  await figma.loadFontAsync({ family: 'Inter', style: 'Bold' });
  const text = figma.createText();
  board.appendChild(text);
  text.fontName = { family: 'Inter', style: 'Bold' };
  text.fontSize = 56;
  text.characters = 'Penumbra';
  text.x = 40;
  text.y = 620;
  text.fills = [{ type: 'SOLID', color: { r: 0.1, g: 0.1, b: 0.12 } }];
  writeShadows(text, [s({ elevation: 2, distance: 22, softness: 12, layers: 6, startOpacity: 0.6, endOpacity: 0.1, startColor: '#f97316', endColor: '#7c3aed', angles: [45] })], true);

  // A v2 shadow (one color, one opacity) reads back as one shadow.
  const v2 = card(board, 'v2', 420, 630, 120, 80);
  v2.setSharedPluginData('penumbra', 'shadow', JSON.stringify({ v: 2, color: '#112233', opacity: 0.3, elevation: 2, distance: 14, softness: 28, angle: 90, layers: 4, spacing: 2, blendMode: 'NORMAL', merge: false }));
  const converted = readShadows(v2);

  // Twelve copies, then removed: back where it started.
  const f = card(board, 'Round trip', 600, 630, 120, 80);
  writeShadows(f, [s({ ...twelve })], true);
  clearShadows(f);
  const roundTrip = { parent: f.parent!.type, drops: drops(f).length, stored: readShadows(f), groupsLeft: board.findAll((n) => n.type === 'GROUP' && n.name === 'Round trip').length };

  // Curves: a straight distance curve spaces 4 copies evenly; a blur curve that stays low keeps
  // the near ones sharp. Linked colors: the end follows the start.
  const g = card(board, 'Curves', 780, 640, 120, 80);
  writeShadows(g, [s({ elevation: 0, distance: 40, softness: 20, layers: 4, distanceCurve: LINEAR, blurCurve: [[0, 0], [1, 0], [1, 0], [1, 1]], startColor: '#ff0000', endColor: '#0000ff', colorLinked: true })], true);
  const curves = { ys: ys(drops(g)), blur: drops(g).map((x) => x.radius), colors: [...new Set(drops(g).map((x) => hex(x.color)))] };

  // --- Inner shadows, lights, hiding ---
  const board2 = figma.createFrame();
  board2.name = 'Penumbra check';
  figma.currentPage.appendChild(board2);
  board2.resize(1040, 700);
  board2.x = 100;
  board2.y = 1060;
  board2.fills = [{ type: 'SOLID', color: { r: 0.93, g: 0.94, b: 0.95 } }];
  const inners = (node: BlendMixin) => node.effects.filter((x): x is InnerShadowEffect => x.type === 'INNER_SHADOW');

  // Inner: the user's own inner shadow stays through edits and removal; Penumbra's are replaced.
  const n = card(board2, 'Inner', 40, 40);
  const own: InnerShadowEffect = { type: 'INNER_SHADOW', color: { r: 1, g: 1, b: 1, a: 0.8 }, offset: { x: 0, y: 1 }, radius: 0, spread: 0, visible: true, blendMode: 'NORMAL' };
  n.effects = [own];
  writeShadows(n, [s({ inner: true, layers: 4, elevation: 0, distance: 10, softness: 12, startOpacity: 0.35, endOpacity: 0.05 }), contact], true);
  const firstWrite = { inner: inners(n).length, drops: drops(n).length };
  writeShadows(n, readShadows(n)!.map((x, i) => (i === 0 ? { ...x, layers: 3, lights: [{ ...x.lights[0], angle: 120 }] } : x)), true);
  const edited = { inner: inners(n).map((x) => [x.radius, +x.color.a.toFixed(2)]), drops: drops(n).length };
  clearShadows(n);
  const innerCleared = { inner: inners(n).map((x) => [x.radius, +x.color.a.toFixed(2)]), drops: drops(n).length };
  writeShadows(n, [s({ inner: true, layers: 4, elevation: 0, distance: 10, softness: 12, startOpacity: 0.35, endOpacity: 0.05 })], true);
  // Two inner shadows of 8: all 16 on two faint copies above the card, the first shadow's on top;
  // the hand-made inner shadow stays on the card. Hiding one brings the other back onto the card.
  const o = card(board2, 'Inner, 8 + 8', 290, 40);
  o.fills = [{ type: 'SOLID', color: { r: 0.12, g: 0.12, b: 0.16 } }];
  o.effects = [own];
  writeShadows(o, [s({ inner: true, layers: 8, elevation: 0, distance: 24, softness: 8, startOpacity: 0.9, endOpacity: 0.2, startColor: '#ef4444', endColor: '#ef4444', angles: [45] }), s({ inner: true, layers: 8, elevation: 0, distance: 24, softness: 8, startOpacity: 0.9, endOpacity: 0.2, startColor: '#3b82f6', endColor: '#3b82f6', angles: [225] })], true);
  const innerLayer = () => (o.parent as GroupNode).children.find((c) => role(c) === 'inner') as GroupNode | undefined;
  const parts = () => [...(innerLayer()?.children ?? [])].reverse() as FrameNode[];
  const stacked = {
    parent: o.parent!.type,
    order: (o.parent as GroupNode).children.map((c) => c.name),
    parts: parts().map((p) => [p.name, inners(p).length, hex(inners(p)[inners(p).length - 1].color)]),
    faint: parts().map((p) => (p.fills as Paint[]).map((paint) => +(paint.opacity ?? 1).toFixed(4))),
    onCard: inners(o).map((x) => [x.radius, +x.color.a.toFixed(2)]),
  };
  writeShadows(o, readShadows(o)!.map((x, i) => (i === 1 ? { ...x, visible: false } : x)), true);
  const oneHidden = { parent: o.parent!.type, onCard: inners(o).length, layer: !!(o.parent && o.parent.type === 'GROUP') };
  writeShadows(o, readShadows(o)!.map((x) => ({ ...x, visible: true })), true);
  const twelveInner = card(board2, 'Inner, 12', 540, 40);
  const innerTwelve = { note: writeShadows(twelveInner, [s({ inner: true, layers: 12, distance: 24 })], true).note, parent: twelveInner.parent!.type, onCard: inners(twelveInner).length };

  // Hidden shadows keep their settings and draw nothing: hiding the 12-copy one ungroups the
  // card, hiding both leaves no drop shadows, showing them brings everything back.
  const hv = card(board2, 'Hide and show', 790, 40, 120, 80);
  writeShadows(hv, [s({ ...twelve }), contact], true);
  const state = () => ({ ...look(hv), stored: readShadows(hv)!.map((x) => x.visible) });
  const shown = state();
  writeShadows(hv, readShadows(hv)!.map((x, i) => (i === 0 ? { ...x, visible: false } : x)), true);
  const firstHidden = state();
  writeShadows(hv, readShadows(hv)!.map((x) => ({ ...x, visible: false })), true);
  const allHidden = state();
  writeShadows(hv, readShadows(hv)!.map((x) => ({ ...x, visible: true })), true);
  const hideShow = { shown, firstHidden, allHidden, back: state() };

  // A long shadow from 100% to 60% over 12 copies, a phone at a third of its size: no copy may be
  // stronger than the ones nearer the object, so the far end fades instead of standing out.
  const phone = card(board2, 'Fading far end', 60, 180, 224, 487);
  phone.cornerRadius = 40;
  phone.fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  writeShadows(phone, [sanitize({ elevation: 0, layers: 12, startOpacity: 1, endOpacity: 0.6, startColor: '#57004f', endColor: '#005157', colorLinked: false, distanceCurve: [[0, 0], [0.33, 0.1], [0.67, 0.4], [1, 1]], blurCurve: [[0, 0], [0.33, 0.1], [0.67, 0.4], [1, 1]], lights: [{ angle: 37, distance: 264, startSoftness: 0, endSoftness: 50 }] })], true);
  const fading = layerDrops(layersOf(phone.parent)[0]).map((x) => +x.color.a.toFixed(3));

  // use_figma's inline screenshot; not part of the plugin API typings
  await (board2 as FrameNode & { screenshot(opts: { scale: number }): Promise<unknown> }).screenshot({ scale: 1 });
  return {
    boardId: board.id,
    board2Id: board2.id,
    gradient, two, overflow, sixAndSix, thirtyTwo, backTo8, layout, capped, rematch,
    v04: { splitFixed, outlineFixed, mergedFixed },
    converted, roundTrip, curves,
    inner: { firstWrite, edited, innerCleared, stacked, oneHidden, innerTwelve },
    hideShow, fading,
  };
}
