// Runs the plugin's real node code inside a Figma file (via the Figma MCP's use_figma) and
// reports what it built. Build with `npm run figma-check`, then run the printed script.
import { clearShadows, readShadows, resolve, writeShadows, type ShadowNode } from '../src/nodes';
import { sanitize, type ShadowParams } from '../src/shadow';

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

const s = (patch: Partial<ShadowParams>) => sanitize(patch);
const role = (n: BaseNode) => n.getSharedPluginData('penumbra', 'role');
const drops = (node: BlendMixin) => node.effects.filter((e): e is DropShadowEffect => e.type === 'DROP_SHADOW');
const origin = (node: SceneNode) => [Math.round(node.absoluteTransform[0][2]), Math.round(node.absoluteTransform[1][2])];
const layersOf = (group: BaseNode | null): GroupNode[] =>
  group && group.type === 'GROUP' ? (group.children.filter((c) => role(c) === 'shadow') as GroupNode[]).reverse() : [];
const partsOf = (layer: GroupNode): GroupNode[] => (layer.children.filter((c) => role(c) === 'part') as GroupNode[]).reverse();
/** A layer's drop shadows, bottom first, as one list. */
const layerDrops = (layer: GroupNode) => [...partsOf(layer)].reverse().flatMap(drops);
const hex = ({ r, g, b }: RGB) => '#' + [r, g, b].map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('');
const ys = (list: DropShadowEffect[]) => list.map((e) => Math.round(e.offset.y));

// Hard copies make the bands visible.
const hard = { elevation: 0, distance: 48, softness: 4, layers: 4, spacing: 1, angle: 60 };
const fade = { startOpacity: 0.5, endOpacity: 0.08, startColor: '#1d4ed8', endColor: '#c026d3' };
const contact = s({ elevation: 0, distance: 2, softness: 4, layers: 2, startOpacity: 0.25, endOpacity: 0.15 });
const ambient = s({ elevation: 4, distance: 28, softness: 48, layers: 4, startOpacity: 0.22, endOpacity: 0.03, startColor: '#334155', endColor: '#64748b' });
// Twelve hard copies 4 px apart, straight down: offsets 4, 8, … 48.
const twelve = { elevation: 0, distance: 48, softness: 2, layers: 12, spacing: 1, angle: 90, startOpacity: 0.6, endOpacity: 0.05 };

export async function run() {
  for (const old of figma.currentPage.children.filter((n) => n.name === 'Penumbra check' || n.name === 'Order test')) old.remove();
  const board = figma.createFrame();
  board.name = 'Penumbra check';
  figma.currentPage.appendChild(board);
  board.resize(1040, 900);
  board.x = 100;
  board.y = 100;
  board.fills = [{ type: 'SOLID', color: { r: 0.93, g: 0.94, b: 0.95 } }];

  // Start → end, as effects and merged: blue next to the object, fading to faint magenta.
  const a = card(board, 'Gradient, effects', 40, 40);
  writeShadows(a, [s({ ...hard, ...fade })], true);
  const b = card(board, 'Gradient, merged', 290, 40);
  const bNote = writeShadows(b, [s({ ...hard, ...fade, merge: true })], true).note;
  if (bNote) return { failed: 'merge', note: bNote };
  const bLayer = layersOf(b.parent)[0];
  const bPart = partsOf(bLayer)[0];
  const gradient = {
    effects: drops(a).map((e) => [hex(e.color), +e.color.a.toFixed(3), e.offset.y]),
    merged: {
      opacity: bLayer.opacity,
      layerEffects: bLayer.effects.length,
      parts: partsOf(bLayer).map((p) => p.name),
      fill: hex(((bPart.children.find((c) => c.type === 'RECTANGLE') as RectangleNode).fills as SolidPaint[])[0].color),
      drops: layerDrops(bLayer).map((e) => [hex(e.color), +e.color.a.toFixed(3)]),
    },
  };

  // Two shadows as effects: the first (contact) draws on top, so its copies come last.
  const c = card(board, 'Two shadows, effects', 540, 40);
  writeShadows(c, [contact, ambient], true);
  const two = drops(c).map((e) => [e.offset.y, e.radius, +e.color.a.toFixed(3)]);

  // Mixed: two merged shadows on their own layers, a third left as effects on the object.
  const d = card(board, 'Mixed', 790, 40);
  writeShadows(d, [s({ ...contact, merge: true }), s({ ...ambient, merge: true }), s({ layers: 1, elevation: 0, distance: 1, softness: 0, startOpacity: 0.1 })], true);
  const wrapper = d.parent as GroupNode;
  const mixed = {
    wrapper: [wrapper.type, wrapper.name, wrapper.children.map((n) => n.name)],
    layers: layersOf(wrapper).map((l) => [l.name, l.opacity, l.locked, partsOf(l).length, layerDrops(l).length]),
    objectDrops: drops(d).length,
    resolves: [resolve(wrapper)?.id === d.id, resolve(layersOf(wrapper)[0])?.id === d.id, resolve(partsOf(layersOf(wrapper)[0])[0])?.id === d.id],
    stored: readShadows(d)!.map((x) => x.merge),
  };

  // Drop the first merged shadow: one layer is reused, the other removed.
  const list = readShadows(d)!;
  writeShadows(d, list.slice(1), true);
  const dropped = { children: wrapper.children.map((n) => n.name), objectDrops: drops(d).length };

  // Resizing leaves the silhouettes stale until a rematching write; the 12-copy one has two parts.
  const e = card(board, 'Resized', 40, 260);
  writeShadows(e, [s({ ...contact, merge: true }), s({ ...ambient, ...twelve, merge: true })], true);
  e.resize(200, 104);
  writeShadows(e, readShadows(e)!, true);
  const rematch = layersOf(e.parent).map((l) =>
    partsOf(l).map((part) => {
      const silhouette = part.children.find((n) => 'isMask' in n && n.isMask)!;
      return [silhouette.width, silhouette.height];
    }),
  );

  // Inside auto layout the group takes the card's slot; nothing should move.
  const row = autoLayout('Row', 'HORIZONTAL');
  board.appendChild(row);
  row.x = 300;
  row.y = 270;
  row.fills = [];
  const cards = [0, 1, 2].map((i) => card(row, `Row ${i}`, 0, 0, 100, 80));
  const before = cards.map(origin);
  writeShadows(cards[1], [s({ ...contact, merge: true }), s({ ...ambient, merge: true })], true);
  const layout = { before, after: cards.map(origin), middleParent: cards[1].parent!.type };

  // A card that fills its auto layout can't be grouped: every shadow falls back to effects.
  const column = autoLayout('Column', 'VERTICAL');
  board.appendChild(column);
  column.x = 760;
  column.y = 270;
  column.fills = [];
  column.resize(220, 80);
  column.counterAxisSizingMode = 'FIXED';
  const filler = card(column, 'Filler', 0, 0, 120, 60);
  filler.layoutSizingHorizontal = 'FILL';
  const refused = writeShadows(filler, [s({ ...contact, merge: true }), ambient], true);
  const fill = { note: refused.note, merge: readShadows(filler)!.map((x) => x.merge), drops: drops(filler).length, parent: filler.parent!.type };

  // Text casts its own glyph silhouette, here with a color gradient.
  await figma.loadFontAsync({ family: 'Inter', style: 'Bold' });
  const text = figma.createText();
  board.appendChild(text);
  text.fontName = { family: 'Inter', style: 'Bold' };
  text.fontSize = 56;
  text.characters = 'Penumbra';
  text.x = 40;
  text.y = 460;
  text.fills = [{ type: 'SOLID', color: { r: 0.1, g: 0.1, b: 0.12 } }];
  writeShadows(text, [s({ merge: true, elevation: 2, distance: 22, softness: 12, layers: 6, startOpacity: 0.6, endOpacity: 0.1, startColor: '#f97316', endColor: '#7c3aed', angle: 45 })], true);

  // A v2 shadow (one color, one opacity) reads back as one shadow.
  const v2 = card(board, 'v2', 420, 470, 120, 80);
  v2.setSharedPluginData('penumbra', 'shadow', JSON.stringify({ v: 2, color: '#112233', opacity: 0.3, elevation: 2, distance: 14, softness: 28, angle: 90, layers: 4, spacing: 2, blendMode: 'NORMAL', merge: false }));
  const converted = readShadows(v2);

  // Merged on, off, then removed: back where it started.
  const f = card(board, 'Round trip', 600, 470, 120, 80);
  writeShadows(f, [s({ merge: true }), s({ merge: true, elevation: 0 })], true);
  writeShadows(f, readShadows(f)!.map((x) => ({ ...x, merge: false })), true);
  const unmerged = { parent: f.parent!.type, drops: drops(f).length, groupsLeft: board.findAll((n) => n.type === 'GROUP' && n.name === 'Round trip').length };
  clearShadows(f);
  const roundTrip = { unmerged, cleared: { drops: drops(f).length, stored: readShadows(f) } };

  // --- Past Figma's 8 drop shadows per layer ---

  // Twelve copies as effects: the nearest 8 stay on the object, the farthest 4 go one layer down.
  const g = card(board, '12 as effects', 40, 640);
  writeShadows(g, [s({ ...twelve, ...fade })], true);
  const gLayers = layersOf(g.parent);
  const overflow = {
    parent: g.parent!.type,
    object: ys(drops(g)),
    layers: gLayers.map((l) => [l.name, l.opacity, l.blendMode, partsOf(l).map((p) => p.name), ys(layerDrops(l))]),
  };

  // Two shadows of 6: the top shadow's 6 and the next one's nearest 2 stay on the object.
  const h = card(board, '6 + 6 as effects', 290, 640);
  writeShadows(h, [s({ ...twelve, layers: 6, distance: 24, startColor: '#1d4ed8', endColor: '#1d4ed8' }), s({ ...twelve, layers: 6, startColor: '#c026d3', endColor: '#c026d3' })], true);
  const split = {
    object: drops(h).map((e) => [hex(e.color), Math.round(e.offset.y)]),
    layer: layersOf(h.parent).map((l) => layerDrops(l).map((e) => [hex(e.color), Math.round(e.offset.y)])),
  };

  // Twelve copies merged: one layer, two parts of 8 and 4, the nearest on top.
  const i = card(board, '12 merged', 540, 640);
  writeShadows(i, [s({ ...twelve, ...fade, merge: true })], true);
  const iLayer = layersOf(i.parent)[0];
  const mergedTwelve = {
    opacity: +iLayer.opacity.toFixed(3),
    parts: partsOf(iLayer).map((p) => [p.name, ys(drops(p))]),
    objectDrops: drops(i).length,
  };

  // Back to 8 or fewer: the layer and the group go.
  const j = card(board, 'Back to 8', 790, 640, 120, 80);
  writeShadows(j, [s({ ...twelve })], true);
  const grouped = j.parent!.type;
  writeShadows(j, [s({ ...twelve, layers: 8 })], true);
  const backTo8 = { grouped, after: j.parent!.type, drops: drops(j).length };

  // Can't be grouped: Figma's cap applies, the bottom copies are left out and the note says so.
  const tight = autoLayout('Tight', 'VERTICAL');
  board.appendChild(tight);
  tight.x = 790;
  tight.y = 760;
  tight.fills = [];
  tight.resize(200, 80);
  tight.counterAxisSizingMode = 'FIXED';
  const k = card(tight, 'Fills, 12', 0, 0, 120, 60);
  k.layoutSizingHorizontal = 'FILL';
  const kResult = writeShadows(k, [s({ ...twelve })], true);
  const capped = { note: kResult.note, drops: ys(drops(k)), parent: k.parent!.type };

  // A layer from before parts (silhouette right in the layer, effects on it) is converted.
  const m = card(board, 'Old layer', 40, 800, 120, 60);
  writeShadows(m, [s({ ...contact, merge: true })], true);
  const mLayer = layersOf(m.parent)[0];
  const mPart = partsOf(mLayer)[0];
  mLayer.locked = false;
  const oldEffects = drops(mPart);
  [...mPart.children].reverse().forEach((child) => mLayer.insertChild(0, child));
  mLayer.effects = oldEffects;
  const oldShape = mLayer.children.map((n) => n.name);
  writeShadows(m, readShadows(m)!, false);
  const migrated = {
    before: oldShape,
    after: mLayer.children.map((n) => [n.name, role(n)]),
    layerEffects: mLayer.effects.length,
    partDrops: drops(partsOf(mLayer)[0]).length,
  };

  // use_figma's inline screenshot; not part of the plugin API typings
  await (board as FrameNode & { screenshot(opts: { scale: number }): Promise<unknown> }).screenshot({ scale: 1 });
  return { boardId: board.id, gradient, two, mixed, dropped, rematch, layout, fill, converted, roundTrip, overflow, split, mergedTwelve, backTo8, capped, migrated };
}
