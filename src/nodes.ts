import { MAX_EFFECTS, computeCopies, fromStored, hexToRgb, toStored, type ShadowParams } from './shadow';

// Shared (not private) plugin data, so shadows stay editable when the dev plugin's id
// changes on publish.
const NAMESPACE = 'penumbra';
const KEY = 'shadow'; // the layer's shadows
const ROLE = 'role'; // 'wrapper' | 'shadow' | 'part' | 'inner' | 'inner-part', on the nodes shadow layers create
const MATCH = 'match'; // what the silhouette was copied from
const RELAUNCH = { edit: 'Adjust elevation, light and color' };

export type ShadowNode = SceneNode & BlendMixin;

/** The sidebar "Edit shadow" button is a convenience; it must never fail a write (layers in
 *  instances refuse it). The stored settings are what keep a shadow editable. */
function relaunch(node: SceneNode, data: { [command: string]: string }) {
  try {
    node.setRelaunchData(data);
  } catch {
    // ignore
  }
}

function role(node: BaseNode): string {
  return node.getSharedPluginData(NAMESPACE, ROLE);
}

function canHaveEffects(node: SceneNode): node is ShadowNode {
  return 'effects' in node;
}

export function readShadows(node: ShadowNode): ShadowParams[] | null {
  const raw = node.getSharedPluginData(NAMESPACE, KEY);
  return raw ? fromStored(raw) : null;
}

// Nodes inside a shadow layer. Earlier versions' merged shadows and hard outlines had more kinds;
// they're still recognised so a click on one finds its object, and replaced on the next write.
const INSIDE = ['shadow', 'part', 'inner', 'inner-part', 'outline', 'light', 'fade', 'base', 'band'];

/** The object a selected layer stands for: the group of shadow layers and everything in it
 *  resolve to the object inside. */
export function resolve(node: SceneNode): ShadowNode | null {
  const parent = node.parent;
  if (INSIDE.includes(role(node)) && parent && (parent.type === 'GROUP' || parent.type === 'FRAME')) return resolve(parent);
  if (role(node) === 'wrapper' && node.type === 'GROUP') {
    const object = node.children.find((c) => role(c) !== 'shadow' && canHaveEffects(c) && readShadows(c));
    if (object) return object as ShadowNode;
  }
  return canHaveEffects(node) ? node : null;
}

export function selected(): ShadowNode[] {
  const seen = new Set<string>();
  const nodes: ShadowNode[] = [];
  for (const node of figma.currentPage.selection) {
    const target = resolve(node);
    if (target && !seen.has(target.id)) {
      seen.add(target.id);
      nodes.push(target);
    }
  }
  return nodes;
}

/** Figma draws later effects on top, so the copies go farthest first and the nearest ends on
 *  top, every light's copies interleaved. */
function toShadows(params: ShadowParams) {
  return computeCopies(params)
    .sort((a, b) => b.offset - a.offset)
    .map((copy) => {
      const { r, g, b } = hexToRgb(copy.color);
      return {
        color: { r, g, b, a: copy.alpha },
        offset: { x: copy.x, y: copy.y },
        radius: copy.blur,
        spread: 0,
        visible: true,
        blendMode: params.blendMode as BlendMode,
      };
    });
}

/** The drop shadows of every shown drop shadow, bottom first; the first shadow ends on top. */
function dropEffects(shadows: ShadowParams[]): DropShadowEffect[] {
  return shadows
    .filter((s) => s.visible && !s.inner)
    .reverse()
    .flatMap((s) => toShadows(s).map((shadow): DropShadowEffect => ({ type: 'DROP_SHADOW', ...shadow, showShadowBehindNode: false })));
}

/** The inner shadows of every shown inner shadow, bottom first; the first shadow ends on top. */
function innerEffects(shadows: ShadowParams[]): InnerShadowEffect[] {
  return shadows
    .filter((s) => s.visible && s.inner)
    .reverse()
    .flatMap((s) => toShadows(s).map((shadow): InnerShadowEffect => ({ type: 'INNER_SHADOW', ...shadow })));
}

const near = (a: number, b: number, eps = 0.002) => Math.abs(a - b) < eps;

function sameInner(e: Effect, o: InnerShadowEffect): boolean {
  return (
    e.type === 'INNER_SHADOW' &&
    e.blendMode === o.blendMode &&
    near(e.radius, o.radius, 0.01) &&
    near(e.offset.x, o.offset.x, 0.01) &&
    near(e.offset.y, o.offset.y, 0.01) &&
    (['r', 'g', 'b', 'a'] as const).every((c) => near(e.color[c], o.color[c]))
  );
}

/** The node's effects other than Penumbra's: every drop shadow is Penumbra's; inner shadows only
 *  when they are the ones `previous` wrote on it (at most 8), so the user's own inner shadows stay. */
function othersThan(node: ShadowNode, previous: ShadowParams[] | null): Effect[] {
  const ours = previous ? innerEffects(previous).slice(-MAX_EFFECTS) : [];
  return node.effects.filter((e) => {
    if (e.type === 'DROP_SHADOW') return false;
    const k = ours.findIndex((o) => sameInner(e, o));
    if (k < 0) return true;
    ours.splice(k, 1);
    return false;
  });
}

// --- The shadow layers -------------------------------------------------------------------
//
// Figma keeps 8 drop shadows and 8 inner shadows per layer and drops the rest without an error. Up
// to 8 copies of each kind sit on the object itself. Past that, all copies of that kind go on a
// layer of their own, so a shadow is never split between object and layer: drop shadows below the
// object, inner shadows above it. The object and its shadow layers share a group, named after it:
//
//   <object name>      group, role "wrapper"
//     Inner shadows    group, role "inner", locked; only past 8 inner copies
//       8 copies       copy of the object at 0.1% (role "inner-part"); up to 8 inner shadows
//     <object>         none of its own of a kind that went on a layer
//     Shadows          group, role "shadow", locked; only past 8 drop copies
//       8 copies       group, role "part"; up to 8 of the drop shadows, nearest on top
//         Color        rectangle in the copies' color, masked to the silhouette
//         Silhouette   copy of the object, alpha mask
//       4 copies       the farther copies
//
// Each drop part casts its copies from a silhouette of the object, and the object hides the
// silhouette. Figma draws inner shadows only on a visible fill, but at full strength on a fill
// of 0.1%, the same as on the object itself, over its children (checked 2026-10-31): so inner
// parts are copies of the object with every paint at 0.1%, which can't be seen. The group moves
// with the object; copies are made again when the object's shape no longer matches them.

type ShadowLayer = GroupNode | FrameNode; // frames only in earlier hard outlines, which are replaced

function wrapperOf(node: SceneNode): GroupNode | null {
  const parent = node.parent;
  return parent && parent.type === 'GROUP' && role(parent) === 'wrapper' ? parent : null;
}

/** The drop shadow layers, top first. There is one; earlier versions could leave several. */
function shadowLayersOf(wrapper: GroupNode): ShadowLayer[] {
  return wrapper.children.filter((c): c is ShadowLayer => (c.type === 'GROUP' || c.type === 'FRAME') && role(c) === 'shadow').reverse();
}

/** A shadow layer's parts, top first. */
function partsOf(layer: GroupNode): GroupNode[] {
  return layer.children.filter((c): c is GroupNode => c.type === 'GROUP' && role(c) === 'part').reverse();
}

/** The inner shadow layers, top first. There is one. */
function innerLayersOf(wrapper: GroupNode): GroupNode[] {
  return wrapper.children.filter((c): c is GroupNode => c.type === 'GROUP' && role(c) === 'inner').reverse();
}

/** An inner shadow layer's copies of the object, top first. */
function innerPartsOf(layer: GroupNode): ShadowNode[] {
  return layer.children.filter((c): c is ShadowNode => canHaveEffects(c) && role(c) === 'inner-part').reverse();
}

/** Splits a bottom-first list into runs of `size`, top first; only the last run can be short. */
function topDown<T>(list: T[], size: number): T[][] {
  const runs: T[][] = [];
  for (let end = list.length; end > 0; end -= size) runs.push(list.slice(Math.max(0, end - size), end));
  return runs;
}

/** Why a layer can't be grouped with a shadow layer, or null if it can. */
export function groupBlocker(node: SceneNode): string | null {
  if (wrapperOf(node)) return null;
  if (node.type === 'COMPONENT_SET' || (node.parent && node.parent.type === 'COMPONENT_SET')) {
    return "Variants can't be grouped with a shadow layer.";
  }
  for (let p: BaseNode | null = node.parent; p && p.type !== 'PAGE'; p = p.parent) {
    if (p.type === 'INSTANCE') return "Layers inside an instance can't be grouped with a shadow layer.";
  }
  const parent = node.parent;
  if (
    parent &&
    'layoutMode' in parent &&
    parent.layoutMode !== 'NONE' &&
    'layoutSizingHorizontal' in node &&
    node.layoutPositioning !== 'ABSOLUTE' &&
    (node.layoutSizingHorizontal === 'FILL' || node.layoutSizingVertical === 'FILL')
  ) {
    return "This layer fills its auto layout, which a group can't, so it can't be grouped with a shadow layer.";
  }
  return null;
}

function wrap(node: ShadowNode): GroupNode {
  const parent = node.parent!;
  // Shadow layers left behind by a manual ungroup
  for (let i = parent.children.indexOf(node) - 1; i >= 0 && role(parent.children[i]) === 'shadow'; i--) parent.children[i].remove();
  const above = parent.children.indexOf(node) + 1;
  while (above < parent.children.length && role(parent.children[above]) === 'inner') parent.children[above].remove();
  const absolute = 'layoutPositioning' in node && node.layoutPositioning === 'ABSOLUTE';
  const transform = node.relativeTransform;
  const wrapper = figma.group([node], parent, parent.children.indexOf(node));
  wrapper.name = node.name;
  wrapper.setSharedPluginData(NAMESPACE, ROLE, 'wrapper');
  if (absolute) {
    wrapper.layoutPositioning = 'ABSOLUTE';
    node.relativeTransform = transform;
  }
  return wrapper;
}

function unwrap(node: ShadowNode) {
  const wrapper = wrapperOf(node);
  if (!wrapper) return;
  const parent = wrapper.parent!;
  const absolute = wrapper.layoutPositioning === 'ABSOLUTE';
  const transform = node.relativeTransform;
  parent.insertChild(parent.children.indexOf(wrapper), node);
  if (absolute && 'layoutPositioning' in node) {
    node.layoutPositioning = 'ABSOLUTE';
    node.relativeTransform = transform;
  }
  // Both lists first: Figma removes the group as soon as it's empty.
  [...shadowLayersOf(wrapper), ...innerLayersOf(wrapper)].forEach((layer) => layer.remove());
  // Figma removes a group once it's empty; one that still holds the user's layers stays.
  if (!wrapper.removed) wrapper.setSharedPluginData(NAMESPACE, ROLE, '');
}

/** What the silhouette's shape depends on beyond size and position. */
function shapeKey(node: SceneNode): string {
  // Figma throws on reading a property a node type doesn't have, so check before reading.
  const n = node as unknown as Record<string, unknown>;
  const keys = ['characters', 'cornerRadius', 'topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius', 'strokeWeight', 'pointCount', 'innerRadius'];
  const parts = keys.map((k) => (k in node && (typeof n[k] === 'number' || typeof n[k] === 'string') ? `${k}:${n[k]}` : ''));
  if ('vectorPaths' in node) parts.push(node.vectorPaths.map((p) => p.data).join(' '));
  if ('arcData' in node) parts.push(JSON.stringify(node.arcData));
  if ('children' in node) parts.push(`children:${node.children.length}`);
  return parts.join('|');
}

/** Whether `copy`, made for `part`, still has the object's shape, size and place. */
function matches(node: SceneNode, part: SceneNode, copy: SceneNode | undefined): boolean {
  const silhouette = copy;
  if (!silhouette || part.getSharedPluginData(NAMESPACE, MATCH) !== shapeKey(node)) return false;
  const a = node.relativeTransform;
  const b = silhouette.relativeTransform;
  const close = (x: number, y: number) => Math.abs(x - y) < 0.01;
  return (
    close(node.width, silhouette.width) &&
    close(node.height, silhouette.height) &&
    a.every((row, i) => row.every((v, j) => close(v, b[i][j])))
  );
}

/** A shadow layer that needs its silhouettes copied again, or is left from an earlier version. */
function stale(node: SceneNode, layer: ShadowLayer): boolean {
  if (layer.type !== 'GROUP') return true;
  const parts = partsOf(layer);
  return parts.length === 0 || parts.some((part) => !matches(node, part, part.children.find((c) => 'isMask' in c && c.isMask)));
}

/** An inner shadow layer whose copies no longer match the object. */
function innerStale(node: SceneNode, layer: GroupNode): boolean {
  const parts = innerPartsOf(layer);
  return parts.length === 0 || parts.some((part) => !matches(node, part, part));
}

function containerTransform(node: BaseNode): Transform {
  let p = node.parent;
  while (p && (p.type === 'GROUP' || p.type === 'BOOLEAN_OPERATION' || p.type === 'TRANSFORM_GROUP')) p = p.parent;
  return p && 'absoluteTransform' in p ? p.absoluteTransform : [[1, 0, 0], [0, 1, 0]];
}

function invert([[a, c, e], [b, d, f]]: Transform): Transform {
  const det = a * d - b * c;
  return [
    [d / det, -c / det, (c * f - d * e) / det],
    [-b / det, a / det, (b * e - a * f) / det],
  ];
}

function multiply(m: Transform, n: Transform): Transform {
  return [
    [m[0][0] * n[0][0] + m[0][1] * n[1][0], m[0][0] * n[0][1] + m[0][1] * n[1][1], m[0][0] * n[0][2] + m[0][1] * n[1][2] + m[0][2]],
    [m[1][0] * n[0][0] + m[1][1] * n[1][0], m[1][0] * n[0][1] + m[1][1] * n[1][1], m[1][0] * n[0][2] + m[1][1] * n[1][2] + m[1][2]],
  ];
}

/** A new part at `index` in `parent`: a silhouette of the object masking a color rectangle. */
function makePart(node: ShadowNode, parent: BaseNode & ChildrenMixin, index: number): GroupNode {
  const silhouette = (node.type === 'COMPONENT' ? node.createInstance() : node.clone()) as ShadowNode & LayoutMixin;
  silhouette.name = 'Silhouette';
  silhouette.setSharedPluginData(NAMESPACE, KEY, '');
  silhouette.setSharedPluginData(NAMESPACE, ROLE, '');
  relaunch(silhouette, {});
  silhouette.effects = [];
  silhouette.locked = false;
  parent.insertChild(index, silhouette);
  silhouette.relativeTransform = node.relativeTransform;

  // The color rectangle covers everything the silhouette renders, strokes and overflow too.
  const color = figma.createRectangle();
  color.name = 'Color';
  parent.insertChild(index + 1, color);
  const bounds = silhouette.absoluteRenderBounds;
  if (bounds) {
    color.resize(Math.max(bounds.width, 0.01), Math.max(bounds.height, 0.01));
    color.relativeTransform = multiply(invert(containerTransform(color)), [[1, 0, bounds.x], [0, 1, bounds.y]]);
  } else {
    color.resize(Math.max(node.width, 0.01), Math.max(node.height, 0.01));
    color.relativeTransform = node.relativeTransform;
  }
  silhouette.isMask = true;
  silhouette.maskType = 'ALPHA';

  const part = figma.group([silhouette, color], parent, index);
  part.setSharedPluginData(NAMESPACE, ROLE, 'part');
  part.setSharedPluginData(NAMESPACE, MATCH, shapeKey(node));
  return part;
}

/** All of `effects` (bottom first) on the drop shadow layer, eight per part. `rematch` copies
 *  stale silhouettes again; drags skip it and catch up on release. */
function writeLayer(node: ShadowNode, wrapper: GroupNode, effects: DropShadowEffect[], rematch: boolean) {
  const [first, ...rest] = shadowLayersOf(wrapper);
  rest.forEach((layer) => layer.remove());
  let layer = first && first.type === 'GROUP' ? first : null;
  if (first && !layer) first.remove();
  if (!layer) {
    const part = makePart(node, wrapper, wrapper.children.indexOf(node));
    layer = figma.group([part], wrapper, wrapper.children.indexOf(part));
    layer.setSharedPluginData(NAMESPACE, ROLE, 'shadow');
  }
  layer.locked = false;
  const runs = topDown(effects, MAX_EFFECTS);
  const parts = rematch && stale(node, layer) ? [] : partsOf(layer).slice(0, runs.length);
  const keep = new Set(parts.map((part) => part.id));
  // Anything else goes: extra parts, and earlier versions' silhouettes.
  const extra = layer.children.filter((c) => !keep.has(c.id));
  while (parts.length < runs.length) parts.push(makePart(node, layer, 0));
  extra.forEach((c) => c.remove()); // after adding, so the layer is never empty

  // The top copy's color, for any of the silhouette the object doesn't cover.
  const { r, g, b } = effects[effects.length - 1].color;
  parts.forEach((part, i) => {
    part.name = runs[i].length === 1 ? '1 copy' : `${runs[i].length} copies`;
    part.effects = runs[i];
    for (const child of part.children) {
      if (child.type === 'RECTANGLE' && !child.isMask) child.fills = [{ type: 'SOLID', color: { r, g, b } }];
    }
  });
  layer.name = 'Shadows';
  layer.effects = [];
  layer.opacity = 1; // merged layers carried the shadow's strength and blend mode
  layer.blendMode = 'PASS_THROUGH';
  layer.locked = true; // clicks on the shadow select the object, not the shadow
}

const FAINT = 0.001; // a paint's opacity on inner parts: invisible, yet Figma draws inner shadows on it

/** Every paint of `node` and its children at 0.1%, and no effects of their own. */
function faint(node: SceneNode) {
  const fade = (paints: ReadonlyArray<Paint> | PluginAPI['mixed']): Paint[] =>
    typeof paints === 'symbol' ? [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 }, opacity: FAINT }] : paints.map((p) => ({ ...p, opacity: (p.opacity ?? 1) * FAINT }));
  try {
    if ('fills' in node) node.fills = fade(node.fills);
    if ('strokes' in node) node.strokes = fade(node.strokes);
    if ('effects' in node) node.effects = [];
  } catch {
    // a layer in an instance that refuses the override keeps it
  }
  if ('children' in node) node.children.forEach(faint);
}

/** A new inner part at `index` in `parent`: a copy of the object at 0.1%, where it is. */
function makeInnerPart(node: ShadowNode, parent: BaseNode & ChildrenMixin, index: number): ShadowNode {
  const copy = (node.type === 'COMPONENT' ? node.createInstance() : node.clone()) as ShadowNode;
  copy.name = 'Copy';
  copy.setSharedPluginData(NAMESPACE, KEY, '');
  copy.setSharedPluginData(NAMESPACE, ROLE, 'inner-part');
  copy.setSharedPluginData(NAMESPACE, MATCH, shapeKey(node));
  relaunch(copy, {});
  copy.locked = false;
  parent.insertChild(index, copy);
  copy.relativeTransform = node.relativeTransform;
  faint(copy);
  return copy;
}

/** All of `effects` (bottom first) on the inner shadow layer above the object, eight per copy. */
function writeInnerLayer(node: ShadowNode, wrapper: GroupNode, effects: InnerShadowEffect[], rematch: boolean) {
  const [first, ...rest] = innerLayersOf(wrapper);
  rest.forEach((layer) => layer.remove());
  let layer = first ?? null;
  if (!layer) {
    const copy = makeInnerPart(node, wrapper, wrapper.children.indexOf(node) + 1);
    layer = figma.group([copy], wrapper, wrapper.children.indexOf(copy));
    layer.setSharedPluginData(NAMESPACE, ROLE, 'inner');
  }
  layer.locked = false;
  const runs = topDown(effects, MAX_EFFECTS);
  const parts = rematch && innerStale(node, layer) ? [] : innerPartsOf(layer).slice(0, runs.length);
  const keep = new Set(parts.map((part) => part.id));
  const extra = layer.children.filter((c) => !keep.has(c.id));
  while (parts.length < runs.length) parts.push(makeInnerPart(node, layer, 0));
  extra.forEach((c) => c.remove()); // after adding, so the layer is never empty
  parts.forEach((part, i) => {
    part.name = runs[i].length === 1 ? '1 copy' : `${runs[i].length} copies`;
    part.effects = runs[i];
  });
  layer.name = 'Inner shadows';
  layer.effects = [];
  layer.opacity = 1;
  layer.blendMode = 'PASS_THROUGH';
  layer.locked = true;
}

// --- Writing -----------------------------------------------------------------------------

// Our own writes fire nodechange too; ignore those so a drag doesn't echo back into the UI.
let lastWrite = 0;
export const lastWriteAt = () => lastWrite;

/** Penumbra owns a node's drop shadows and the inner shadows it wrote; the user's inner shadows,
 *  blurs and the rest are kept. The first shadow in the list draws on top; hidden shadows are
 *  stored but not drawn. Returns why a shadow couldn't be drawn as set, if one couldn't. */
export function writeShadows(node: ShadowNode, shadows: ShadowParams[], rematch: boolean): { stored: boolean; note: string | null } {
  lastWrite = Date.now();
  const previous = readShadows(node);
  const drops = dropEffects(shadows);
  const inners = innerEffects(shadows);
  let onObject = { drops, inners };
  const layered = drops.length > MAX_EFFECTS || inners.length > MAX_EFFECTS;
  let blocked = layered ? groupBlocker(node) : null;
  if (layered && !blocked) {
    try {
      const wrapper = wrapperOf(node) ?? wrap(node);
      if (drops.length > MAX_EFFECTS) writeLayer(node, wrapper, drops, rematch);
      else shadowLayersOf(wrapper).forEach((layer) => layer.remove());
      if (inners.length > MAX_EFFECTS) writeInnerLayer(node, wrapper, inners, rematch);
      else innerLayersOf(wrapper).forEach((layer) => layer.remove());
      relaunch(wrapper, RELAUNCH);
      onObject = { drops: drops.length > MAX_EFFECTS ? [] : drops, inners: inners.length > MAX_EFFECTS ? [] : inners };
    } catch (error) {
      blocked = `Couldn't group this layer with its shadow layers (${error instanceof Error ? error.message : error}).`;
    }
  }
  if (!layered || blocked) unwrap(node);
  const notes: string[] = [];
  if (blocked) {
    notes.push(blocked);
    const lost = (n: number, kind: string) => `Figma keeps ${MAX_EFFECTS} ${kind} shadows per layer, so the bottom ${n === 1 ? `${kind} copy is` : `${n} ${kind} copies are`} left out.`;
    if (drops.length > MAX_EFFECTS) notes.push(lost(drops.length - MAX_EFFECTS, 'drop'));
    if (inners.length > MAX_EFFECTS) notes.push(lost(inners.length - MAX_EFFECTS, 'inner'));
    onObject = { drops: drops.slice(-MAX_EFFECTS), inners: inners.slice(-MAX_EFFECTS) };
  }
  const note = notes.length ? notes.join(' ') : null;
  node.effects = [...onObject.drops, ...othersThan(node, previous), ...onObject.inners];
  try {
    node.setSharedPluginData(NAMESPACE, KEY, toStored(shadows));
  } catch {
    return { stored: false, note };
  }
  relaunch(node, RELAUNCH);
  return { stored: true, note };
}

export function clearShadows(node: ShadowNode) {
  lastWrite = Date.now();
  const previous = readShadows(node);
  unwrap(node);
  node.effects = othersThan(node, previous);
  node.setSharedPluginData(NAMESPACE, KEY, '');
  relaunch(node, {});
}

/** Rewrites shadows whose layers no longer fit: the object changed shape, a layer is missing or no
 *  longer needed, or it's left from an earlier version (merged shadows, outlines, copies split
 *  between object and layer). */
export function rematchSelection(): boolean {
  let changed = false;
  for (const node of selected()) {
    const shadows = readShadows(node);
    const wrapper = shadows ? wrapperOf(node) : null;
    if (!wrapper) continue;
    const dropsOver = dropEffects(shadows!).length > MAX_EFFECTS;
    const innersOver = innerEffects(shadows!).length > MAX_EFFECTS;
    const drops = shadowLayersOf(wrapper);
    const inners = innerLayersOf(wrapper);
    const wrong =
      (dropsOver ? drops.length !== 1 || stale(node, drops[0]) || node.effects.some((e) => e.type === 'DROP_SHADOW') : drops.length > 0) ||
      (innersOver ? inners.length !== 1 || innerStale(node, inners[0]) : inners.length > 0) ||
      (!dropsOver && !innersOver);
    if (wrong) {
      writeShadows(node, shadows!, true);
      changed = true;
    }
  }
  return changed;
}
