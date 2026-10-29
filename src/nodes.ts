import { MAX_EFFECTS, computeCopies, fromStored, hexToRgb, toStored, type ShadowParams } from './shadow';

// Shared (not private) plugin data, so shadows stay editable when the dev plugin's id
// changes on publish.
const NAMESPACE = 'penumbra';
const KEY = 'shadow'; // the layer's shadows
const ROLE = 'role'; // 'wrapper' | 'shadow' | 'part', on the groups shadow layers create
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

/** The object a selected layer stands for: the group of shadow layers and everything in it
 *  resolve to the object inside. */
export function resolve(node: SceneNode): ShadowNode | null {
  if ((role(node) === 'shadow' || role(node) === 'part') && node.parent && node.parent.type === 'GROUP') return resolve(node.parent);
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
 *  top. */
function toEffects(params: ShadowParams): DropShadowEffect[] {
  return computeCopies(params)
    .copies.reverse()
    .map((copy): DropShadowEffect => {
      const { r, g, b } = hexToRgb(copy.color);
      return {
        type: 'DROP_SHADOW',
        color: { r, g, b, a: copy.alpha },
        offset: { x: copy.x, y: copy.y },
        radius: copy.blur,
        spread: 0,
        visible: true,
        // Merged, the copies blend as one: the shadow layer carries the blend mode.
        blendMode: params.merge ? 'NORMAL' : params.blendMode,
        showShadowBehindNode: false,
      };
    });
}

function withoutDropShadows(node: ShadowNode): Effect[] {
  return node.effects.filter((e) => e.type !== 'DROP_SHADOW');
}

// --- Shadow layers -----------------------------------------------------------------------
//
// Merged shadows, and copies past the 8 drop shadows Figma keeps per layer, go on shadow layers
// below the object. The object and its shadow layers share a group, named after the object:
//
//   <object name>      group, role "wrapper"
//     <object>         the top 8 copies of the shadows that aren't merged
//     More shadows     group, role "shadow", locked; the rest of those copies, if any
//     Shadow 1         the first merged shadow; its opacity and blend mode
//       8 copies       group, role "part"; up to 8 of the drop shadows, nearest on top
//         Color        rectangle in the shadow's color, masked to the silhouette
//         Silhouette   copy of the object, alpha mask
//       4 copies       the farther copies
//     Shadow 2         the next merged shadow, below the first
//
// Each part casts its copies from a silhouette of the object, and the object hides the
// silhouette. Merged, the nearest copies are opaque, so they fuse into one shape; the shadow
// layer's opacity then fades that shape as a whole. The group moves with the object;
// silhouettes are re-copied when the object's shape no longer matches them.

function wrapperOf(node: SceneNode): GroupNode | null {
  const parent = node.parent;
  return parent && parent.type === 'GROUP' && role(parent) === 'wrapper' ? parent : null;
}

/** The shadow layers, top first. */
function shadowLayersOf(wrapper: GroupNode): GroupNode[] {
  return wrapper.children.filter((c): c is GroupNode => c.type === 'GROUP' && role(c) === 'shadow').reverse();
}

/** A shadow layer's parts, top first. */
function partsOf(layer: GroupNode): GroupNode[] {
  return layer.children.filter((c): c is GroupNode => c.type === 'GROUP' && role(c) === 'part').reverse();
}

/** Splits a bottom-first list into runs of `size`, top first; only the last run can be short. */
function topDown<T>(list: T[], size: number): T[][] {
  const runs: T[][] = [];
  for (let end = list.length; end > 0; end -= size) runs.push(list.slice(Math.max(0, end - size), end));
  return runs;
}

/** Why a layer can't be grouped with a shadow layer, or null if it can. */
export function mergeBlocker(node: SceneNode): string | null {
  if (wrapperOf(node)) return null;
  if (node.type === 'COMPONENT_SET' || (node.parent && node.parent.type === 'COMPONENT_SET')) {
    return "Variants can't be grouped, so they can't merge.";
  }
  for (let p: BaseNode | null = node.parent; p && p.type !== 'PAGE'; p = p.parent) {
    if (p.type === 'INSTANCE') return "Layers inside an instance can't be grouped, so they can't merge.";
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
    return "This layer fills its auto layout, and a group can't, so it can't merge.";
  }
  return null;
}

function wrap(node: ShadowNode): GroupNode {
  const parent = node.parent!;
  // Shadow layers left behind by a manual ungroup
  for (let i = parent.children.indexOf(node) - 1; i >= 0 && role(parent.children[i]) === 'shadow'; i--) parent.children[i].remove();
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
  shadowLayersOf(wrapper).forEach((layer) => layer.remove());
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

function matches(node: SceneNode, part: GroupNode): boolean {
  const silhouette = part.children.find((c) => 'isMask' in c && c.isMask);
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

/** A shadow layer that needs its silhouettes copied again. */
function stale(node: SceneNode, layer: GroupNode): boolean {
  const parts = partsOf(layer);
  return parts.length === 0 || parts.some((part) => !matches(node, part));
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

interface LayerSpec {
  name: string;
  effects: DropShadowEffect[]; // bottom first
  opacity: number;
  blendMode: BlendMode;
  color: RGB; // of the silhouettes, which the object hides
}

/** Draws `spec` on `layer`, or on a new layer just below `above`, eight copies per part.
 *  `rematch` re-copies stale silhouettes; drags skip it and catch up on release. */
function writeLayer(node: ShadowNode, wrapper: GroupNode, layer: GroupNode | null, above: SceneNode, spec: LayerSpec, rematch: boolean): GroupNode {
  if (!layer) {
    const part = makePart(node, wrapper, wrapper.children.indexOf(above));
    layer = figma.group([part], wrapper, wrapper.children.indexOf(part));
    layer.setSharedPluginData(NAMESPACE, ROLE, 'shadow');
  }
  layer.locked = false;
  const runs = topDown(spec.effects, MAX_EFFECTS);
  const parts = rematch && stale(node, layer) ? [] : partsOf(layer).slice(0, runs.length);
  const keep = new Set(parts.map((part) => part.id));
  // Layers from before parts existed carry their silhouette directly; those go too.
  const extra = layer.children.filter((c) => !keep.has(c.id));
  while (parts.length < runs.length) parts.push(makePart(node, layer, 0));
  extra.forEach((c) => c.remove()); // after adding, so the layer is never empty

  parts.forEach((part, i) => {
    part.name = runs[i].length === 1 ? '1 copy' : `${runs[i].length} copies`;
    part.effects = runs[i];
    for (const child of part.children) {
      if (child.type === 'RECTANGLE' && !child.isMask) child.fills = [{ type: 'SOLID', color: spec.color }];
    }
  });
  layer.name = spec.name;
  layer.effects = [];
  layer.opacity = spec.opacity;
  layer.blendMode = spec.blendMode;
  layer.locked = true; // clicks on the shadow select the object, not the shadow
  return layer;
}

/** Draws the copies past the object's 8 and each merged shadow on shadow layers, reusing
 *  layers top-down and dropping extras. */
function writeLayers(node: ShadowNode, shadows: ShadowParams[], spill: DropShadowEffect[], rematch: boolean) {
  const wrapper = wrapperOf(node) ?? wrap(node);
  const specs: LayerSpec[] = [];
  if (spill.length) {
    const { r, g, b } = spill[spill.length - 1].color;
    specs.push({ name: 'More shadows', effects: spill, opacity: 1, blendMode: 'PASS_THROUGH', color: { r, g, b } });
  }
  shadows.forEach((params, index) => {
    if (!params.merge) return;
    const { copies, opacity } = computeCopies(params);
    const { r, g, b } = hexToRgb(copies[0].color);
    specs.push({
      name: shadows.length > 1 ? `Shadow ${index + 1}` : 'Shadow',
      effects: toEffects(params),
      opacity,
      blendMode: params.blendMode,
      color: { r, g, b },
    });
  });
  const layers = shadowLayersOf(wrapper);
  layers.slice(specs.length).forEach((layer) => layer.remove());
  let above: SceneNode = node;
  specs.forEach((spec, i) => {
    above = writeLayer(node, wrapper, layers[i] ?? null, above, spec, rematch);
  });
  relaunch(wrapper, RELAUNCH);
}

// --- Writing -----------------------------------------------------------------------------

// Our own writes fire nodechange too; ignore those so a drag doesn't echo back into the UI.
let lastWrite = 0;
export const lastWriteAt = () => lastWrite;

/** The drop shadows of every shadow that isn't merged, bottom first. */
function looseEffects(shadows: ShadowParams[]): DropShadowEffect[] {
  return shadows.filter((s) => !s.merge).reverse().flatMap(toEffects);
}

/** Penumbra owns a node's drop shadows; inner shadows, blurs and the rest are kept. The first
 *  shadow in the list draws on top. Returns why a shadow couldn't be drawn as set, if one
 *  couldn't. */
export function writeShadows(node: ShadowNode, shadows: ShadowParams[], rematch: boolean): { stored: boolean; note: string | null } {
  lastWrite = Date.now();
  let note: string | null = null;
  let loose = looseEffects(shadows);
  const merging = shadows.some((s) => s.merge);
  const layered = merging || loose.length > MAX_EFFECTS;
  const blocker = layered ? mergeBlocker(node) : null;
  if (layered) {
    note = blocker;
    if (!note) {
      try {
        writeLayers(node, shadows, loose.slice(0, -MAX_EFFECTS), rematch);
      } catch (error) {
        note = `Couldn't group this layer with its shadow layers (${error instanceof Error ? error.message : error}).`;
      }
    }
    if (note) {
      shadows = shadows.map((s) => ({ ...s, merge: false }));
      loose = looseEffects(shadows);
    }
  }
  if (!layered || note) unwrap(node);
  if (note && loose.length > MAX_EFFECTS) {
    const left = loose.length - MAX_EFFECTS;
    const lost = `the bottom ${left === 1 ? 'copy is' : `${left} copies are`} left out.`;
    note = merging || !blocker
      ? `${note} Figma keeps ${MAX_EFFECTS} drop shadows per layer, so ${lost}`
      : `Figma keeps ${MAX_EFFECTS} drop shadows per layer and this one can't be grouped with more, so ${lost}`;
  }
  node.effects = [...loose.slice(-MAX_EFFECTS), ...withoutDropShadows(node)];
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
  unwrap(node);
  node.effects = withoutDropShadows(node);
  node.setSharedPluginData(NAMESPACE, KEY, '');
  relaunch(node, {});
}

/** Re-copies silhouettes whose object changed shape since. */
export function rematchSelection(): boolean {
  let changed = false;
  for (const node of selected()) {
    const shadows = readShadows(node);
    const wrapper = shadows ? wrapperOf(node) : null;
    if (wrapper && shadowLayersOf(wrapper).some((layer) => stale(node, layer))) {
      writeShadows(node, shadows!, true);
      changed = true;
    }
  }
  return changed;
}
