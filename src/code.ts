import type { PluginMessage, UiMessage } from './messages';
import { computeLayers, hexToRgb, sanitize, type ShadowParams } from './shadow';

// Shared (not private) plugin data, so shadows stay editable when the dev plugin's id
// changes on publish.
const NAMESPACE = 'penumbra';
const KEY = 'shadow';
const LAST_USED = 'last-used';

type ShadowNode = SceneNode & BlendMixin;

figma.showUI(__html__, { width: 300, height: 610, themeColors: true });

function post(message: PluginMessage) {
  figma.ui.postMessage(message);
}

function canHaveEffects(node: SceneNode): node is ShadowNode {
  return 'effects' in node;
}

function selected(): ShadowNode[] {
  return figma.currentPage.selection.filter(canHaveEffects);
}

function readShadow(node: ShadowNode): ShadowParams | null {
  const raw = node.getSharedPluginData(NAMESPACE, KEY);
  if (!raw) return null;
  try {
    return sanitize(JSON.parse(raw));
  } catch {
    return null;
  }
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
      blendMode: params.blendMode,
      showShadowBehindNode: false,
    }),
  );
}

// Our own writes fire nodechange too; ignore those so a drag doesn't echo back into the UI.
let lastWrite = 0;

/** Penumbra owns a node's drop shadows; inner shadows, blurs and the rest are kept. Returns
 *  false when the settings couldn't be stored (layers inside instances refuse plugin data). */
function writeShadow(node: ShadowNode, params: ShadowParams): boolean {
  lastWrite = Date.now();
  node.effects = [...toEffects(params), ...node.effects.filter((e) => e.type !== 'DROP_SHADOW')];
  try {
    node.setSharedPluginData(NAMESPACE, KEY, JSON.stringify(params));
  } catch {
    return false;
  }
  try {
    node.setRelaunchData({ edit: 'Adjust elevation, light and color' });
  } catch {
    // The sidebar button is a convenience; the stored settings are what keep it editable.
  }
  return true;
}

function clearShadow(node: ShadowNode) {
  lastWrite = Date.now();
  node.effects = node.effects.filter((e) => e.type !== 'DROP_SHADOW');
  node.setSharedPluginData(NAMESPACE, KEY, '');
  node.setRelaunchData({});
}

function postSelection() {
  const nodes = selected();
  let params: ShadowParams | null = null;
  let managed = 0;
  let replaces = 0;
  let styled = 0;
  for (const node of nodes) {
    const shadow = readShadow(node);
    if (shadow) {
      managed++;
      params = params ?? shadow;
    } else {
      replaces += node.effects.filter((e) => e.type === 'DROP_SHADOW').length;
      if (node.effectStyleId) styled++;
    }
  }
  post({ type: 'selection', total: figma.currentPage.selection.length, capable: nodes.length, managed, params, replaces, styled });
}

figma.ui.onmessage = async (msg: UiMessage) => {
  switch (msg.type) {
    case 'ready': {
      const last = await figma.clientStorage.getAsync(LAST_USED);
      post({ type: 'init', last: last ? sanitize(last) : null });
      postSelection();
      break;
    }
    case 'add': {
      const params = sanitize(msg.params);
      let unstored = 0;
      for (const node of selected()) {
        if (!readShadow(node) && !writeShadow(node, params)) unstored++;
      }
      figma.commitUndo();
      if (unstored) {
        figma.notify(`Shadow added, but ${unstored} layer${unstored > 1 ? 's' : ''} inside an instance can't keep its settings. Edit the main component to keep it editable.`);
      }
      postSelection();
      break;
    }
    case 'update': {
      // Patch, not replace: with several shadows selected, only the touched setting changes.
      for (const node of selected()) {
        const current = readShadow(node);
        if (current) writeShadow(node, sanitize({ ...current, ...msg.patch }));
      }
      if (msg.commit) figma.commitUndo();
      break;
    }
    case 'remove': {
      for (const node of selected()) if (readShadow(node)) clearShadow(node);
      figma.commitUndo();
      postSelection();
      break;
    }
    case 'remember': {
      await figma.clientStorage.setAsync(LAST_USED, msg.params);
      break;
    }
  }
};

// Keep the UI honest when shadows change outside the plugin (undo, another editor).
let page = figma.currentPage;
let refresh: ReturnType<typeof setTimeout> | undefined;

function onNodeChange(event: NodeChangeEvent) {
  if (Date.now() - lastWrite < 500) return;
  const ids = new Set(figma.currentPage.selection.map((n) => n.id));
  const touched = event.nodeChanges.some(
    (c) => c.type === 'PROPERTY_CHANGE' && ids.has(c.id) && (c.properties.includes('pluginData') || c.properties.includes('effects')),
  );
  if (!touched) return;
  clearTimeout(refresh);
  refresh = setTimeout(postSelection, 150);
}

page.on('nodechange', onNodeChange);
figma.on('currentpagechange', () => {
  page.off('nodechange', onNodeChange);
  page = figma.currentPage;
  page.on('nodechange', onNodeChange);
});
figma.on('selectionchange', postSelection);
