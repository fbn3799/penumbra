import { computeLayers, fromStored, hexToRgb, toStored, type ShadowParams } from './shadow';

// Shared (not private) plugin data, so shadows stay editable when the dev plugin's id
// changes on publish.
const NAMESPACE = 'penumbra';
const KEY = 'shadow';
const ROLE = 'role'; // 'wrapper' | 'shadow', on the groups a merged shadow creates
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

export function readShadow(node: ShadowNode): ShadowParams | null {
  const raw = node.getSharedPluginData(NAMESPACE, KEY);
  return raw ? fromStored(raw) : null;
}

/** The object a selected layer stands for: a merged shadow's group and its shadow layer both
 *  resolve to the object inside. */
export function resolve(node: SceneNode): ShadowNode | null {
  if (role(node) === 'shadow' && node.parent && node.parent.type === 'GROUP') return resolve(node.parent);
  if (role(node) === 'wrapper' && node.type === 'GROUP') {
    const object = node.children.find((c) => role(c) !== 'shadow' && canHaveEffects(c) && readShadow(c));
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

function toEffects(params: ShadowParams): DropShadowEffect[] {
  const { r, g, b } = hexToRgb(params.color);
  return computeLayers(params).map(
    (layer): DropShadowEffect => ({
      type: 'DROP_SHADOW',
      color: { r, g, b, a: layer.alpha },
      offset: { x: layer.x, y: layer.y },
      radius: layer.blur,
      spread: 0,
      visible: true,
      // Merged, the copies blend as one: the shadow layer carries the blend mode.
      blendMode: params.merge ? 'NORMAL' : params.blendMode,
      showShadowBehindNode: false,
    }),
  );
}

function withoutDropShadows(node: ShadowNode): Effect[] {
  return node.effects.filter((e) => e.type !== 'DROP_SHADOW');
}

// --- Merged shadows ----------------------------------------------------------------------
//
// The object and a shadow layer share a group, named after the object:
//
//   <object name>      group, role "wrapper"
//     <object>
//     Shadow           group, role "shadow", locked; the drop shadows, opacity and blend mode
//       Color          rectangle in the shadow color, masked to the silhouette
//       Silhouette     copy of the object, alpha mask
//
// The copies are opaque, so they fuse into one shape; the shadow layer's opacity then fades
// that shape as a whole. The group moves with the object; the silhouette is re-copied when
// the object's shape no longer matches it.

function wrapperOf(node: SceneNode): GroupNode | null {
  const parent = node.parent;
  return parent && parent.type === 'GROUP' && role(parent) === 'wrapper' ? parent : null;
}

function shadowLayerOf(wrapper: GroupNode): GroupNode | null {
  const layer = wrapper.children.find((c) => c.type === 'GROUP' && role(c) === 'shadow');
  return (layer as GroupNode | undefined) ?? null;
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
  const below = parent.children[parent.children.indexOf(node) - 1];
  if (below && role(below) === 'shadow') below.remove(); // left behind by a manual ungroup
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
  shadowLayerOf(wrapper)?.remove();
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

function matches(node: SceneNode, shadow: GroupNode): boolean {
  const silhouette = shadow.children.find((c) => 'isMask' in c && c.isMask);
  if (!silhouette || shadow.getSharedPluginData(NAMESPACE, MATCH) !== shapeKey(node)) return false;
  const a = node.relativeTransform;
  const b = silhouette.relativeTransform;
  const close = (x: number, y: number) => Math.abs(x - y) < 0.01;
  return (
    close(node.width, silhouette.width) &&
    close(node.height, silhouette.height) &&
    a.every((row, i) => row.every((v, j) => close(v, b[i][j])))
  );
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

/** Copies the object into a fresh silhouette, reusing the shadow layer (and its effects) if
 *  there is one. */
function matchSilhouette(node: ShadowNode, wrapper: GroupNode): GroupNode {
  const silhouette = (node.type === 'COMPONENT' ? node.createInstance() : node.clone()) as ShadowNode & LayoutMixin;
  silhouette.name = 'Silhouette';
  silhouette.setSharedPluginData(NAMESPACE, KEY, '');
  silhouette.setSharedPluginData(NAMESPACE, ROLE, '');
  relaunch(silhouette, {});
  silhouette.effects = [];
  silhouette.locked = false;
  const index = wrapper.children.indexOf(node);
  wrapper.insertChild(index, silhouette);
  silhouette.relativeTransform = node.relativeTransform;

  // The color rectangle covers everything the silhouette renders, strokes and overflow too.
  const color = figma.createRectangle();
  color.name = 'Color';
  wrapper.insertChild(index + 1, color);
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

  let shadow = shadowLayerOf(wrapper);
  if (shadow) {
    const stale = [...shadow.children];
    shadow.locked = false;
    shadow.insertChild(0, color);
    shadow.insertChild(0, silhouette);
    stale.forEach((c) => c.remove());
  } else {
    shadow = figma.group([silhouette, color], wrapper, wrapper.children.indexOf(silhouette));
    shadow.name = 'Shadow';
    shadow.setSharedPluginData(NAMESPACE, ROLE, 'shadow');
  }
  shadow.locked = true; // clicks on the shadow select the object, not the shadow
  shadow.setSharedPluginData(NAMESPACE, MATCH, shapeKey(node));
  return shadow;
}

/** Returns why the shadow couldn't merge, or null. `rematch` re-copies a stale silhouette;
 *  drags skip it and catch up on release. */
function writeMerged(node: ShadowNode, params: ShadowParams, rematch: boolean): string | null {
  const blocker = mergeBlocker(node);
  if (blocker) return blocker;
  try {
    const wrapper = wrapperOf(node) ?? wrap(node);
    let shadow = shadowLayerOf(wrapper);
    if (!shadow || (rematch && !matches(node, shadow))) shadow = matchSilhouette(node, wrapper);
    node.effects = withoutDropShadows(node);
    shadow.effects = toEffects(params);
    shadow.opacity = params.opacity;
    shadow.blendMode = params.blendMode;
    const { r, g, b } = hexToRgb(params.color);
    for (const child of shadow.children) {
      if (child.type === 'RECTANGLE' && !child.isMask) child.fills = [{ type: 'SOLID', color: { r, g, b } }];
    }
    relaunch(wrapper, RELAUNCH);
    return null;
  } catch (error) {
    return `Couldn't group this layer with its shadow (${error instanceof Error ? error.message : error}).`;
  }
}

// --- Writing -----------------------------------------------------------------------------

// Our own writes fire nodechange too; ignore those so a drag doesn't echo back into the UI.
let lastWrite = 0;
export const lastWriteAt = () => lastWrite;

/** Penumbra owns a node's drop shadows; inner shadows, blurs and the rest are kept. */
export function writeShadow(node: ShadowNode, params: ShadowParams, rematch: boolean): { stored: boolean; note: string | null } {
  lastWrite = Date.now();
  let note: string | null = null;
  if (params.merge) {
    note = writeMerged(node, params, rematch);
    if (note) params = { ...params, merge: false };
  }
  if (!params.merge) {
    unwrap(node);
    node.effects = [...toEffects(params), ...withoutDropShadows(node)];
  }
  try {
    node.setSharedPluginData(NAMESPACE, KEY, toStored(params));
  } catch {
    return { stored: false, note };
  }
  relaunch(node, RELAUNCH);
  return { stored: true, note };
}

export function clearShadow(node: ShadowNode) {
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
    const params = readShadow(node);
    const wrapper = params && params.merge ? wrapperOf(node) : null;
    const shadow = wrapper && shadowLayerOf(wrapper);
    if (shadow && !matches(node, shadow)) {
      writeShadow(node, params!, true);
      changed = true;
    }
  }
  return changed;
}
