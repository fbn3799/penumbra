// Runs the plugin's real node code inside a Figma file (via the Figma MCP's use_figma) and
// reports what it built. Build with `npm run figma-check`, then run the printed script.
import { clearShadow, readShadow, resolve, writeShadow, type ShadowNode } from '../src/nodes';
import { sanitize } from '../src/shadow';

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

const drops = (node: ShadowNode) => node.effects.filter((e) => e.type === 'DROP_SHADOW').length;
const origin = (node: SceneNode) => [Math.round(node.absoluteTransform[0][2]), Math.round(node.absoluteTransform[1][2])];

export async function run() {
  const board = figma.createFrame();
  board.name = 'Penumbra check';
  figma.currentPage.appendChild(board);
  board.resize(1000, 600);
  board.x = 100;
  board.y = 100;
  board.fills = [{ type: 'SOLID', color: { r: 0.93, g: 0.94, b: 0.95 } }];

  // Hard copies show the difference: as effects the overlaps step darker, merged they don't.
  const hard = { elevation: 0, distance: 44, softness: 4, layers: 4, spacing: 1, opacity: 0.35, angle: 60 };
  const a = card(board, 'Effects, hard', 40, 40);
  writeShadow(a, sanitize(hard), true);
  const b = card(board, 'Merged, hard', 290, 40);
  const bNote = writeShadow(b, sanitize({ ...hard, merge: true }), true).note;
  if (bNote) return { failed: 'merge', note: bNote, parent: b.parent!.type };
  const c = card(board, 'Effects, default', 540, 40);
  writeShadow(c, sanitize({}), true);
  const d = card(board, 'Merged, default', 790, 40);
  writeShadow(d, sanitize({ merge: true }), true);

  const wrapper = b.parent as GroupNode;
  const shadow = wrapper.children.find((n) => n.name === 'Shadow') as GroupNode;
  const merged = {
    wrapper: [wrapper.type, wrapper.name, wrapper.children.map((n) => n.name)],
    shadowChildren: shadow.children.map((n) => [n.name, n.type, 'isMask' in n && n.isMask]),
    shadow: { opacity: shadow.opacity, blend: shadow.blendMode, locked: shadow.locked, alphas: shadow.effects.map((e) => (e.type === 'DROP_SHADOW' ? e.color.a : null)) },
    objectDropShadows: drops(b),
    wrapperBox: [wrapper.x, wrapper.y, wrapper.width, wrapper.height],
    objectBox: [b.x, b.y, b.width, b.height],
    resolves: [resolve(wrapper)?.id === b.id, resolve(shadow)?.id === b.id],
    stored: readShadow(b),
  };

  // Resizing the object leaves the silhouette stale until a rematching write.
  b.resize(200, 104);
  writeShadow(b, readShadow(b)!, true);
  const silhouette = shadow.children.find((n) => 'isMask' in n && n.isMask)!;
  const rematch = { object: [b.width, b.height], silhouette: [silhouette.width, silhouette.height] };

  // Inside auto layout the group takes the card's slot; nothing should move.
  const row = autoLayout('Row', 'HORIZONTAL');
  board.appendChild(row);
  row.x = 40;
  row.y = 300;
  row.fills = [];
  const cards = [0, 1, 2].map((i) => card(row, `Row ${i}`, 0, 0, 120, 80));
  const before = cards.map(origin);
  writeShadow(cards[1], sanitize({ merge: true, elevation: 4, distance: 16, softness: 24 }), true);
  const layout = { before, after: cards.map(origin), row: [row.width, row.height], middleParent: cards[1].parent!.type };

  // A card that fills its auto layout can't be grouped: the shadow falls back to effects.
  const column = autoLayout('Column', 'VERTICAL');
  board.appendChild(column);
  column.x = 520;
  column.y = 300;
  column.fills = [];
  column.resize(200, 80);
  column.counterAxisSizingMode = 'FIXED';
  const filler = card(column, 'Filler', 0, 0, 120, 60);
  filler.layoutSizingHorizontal = 'FILL';
  const refused = writeShadow(filler, sanitize({ merge: true }), true);
  const fill = { note: refused.note, merge: readShadow(filler)?.merge, drops: drops(filler), parent: filler.parent!.type };

  // Text casts its own glyph silhouette.
  await figma.loadFontAsync({ family: 'Inter', style: 'Bold' });
  const text = figma.createText();
  board.appendChild(text);
  text.fontName = { family: 'Inter', style: 'Bold' };
  text.fontSize = 56;
  text.characters = 'Penumbra';
  text.x = 760;
  text.y = 300;
  text.fills = [{ type: 'SOLID', color: { r: 0.2, g: 0.35, b: 0.9 } }];
  writeShadow(text, sanitize({ merge: true, elevation: 2, distance: 18, softness: 10, opacity: 0.4, angle: 45 }), true);

  // Merge on, off, then removed: back where it started.
  const e = card(board, 'Round trip', 40, 460, 120, 80);
  writeShadow(e, sanitize({ merge: true }), true);
  writeShadow(e, sanitize({ merge: false }), true);
  const unmerged = { parent: e.parent!.type, drops: drops(e), groupsLeft: board.findAll((n) => n.type === 'GROUP' && n.name === 'Round trip').length };
  clearShadow(e);
  const roundTrip = { unmerged, cleared: { drops: drops(e), stored: readShadow(e) } };

  // use_figma's inline screenshot; not part of the plugin API typings
  await (board as FrameNode & { screenshot(opts: { scale: number }): Promise<unknown> }).screenshot({ scale: 1 });
  return { boardId: board.id, merged, rematch, layout, fill, roundTrip };
}
