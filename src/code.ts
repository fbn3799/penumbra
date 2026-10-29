import type { PluginMessage, UiMessage } from './messages';
import { clearShadows, lastWriteAt, mergeBlocker, readShadows, rematchSelection, selected, writeShadows } from './nodes';
import { MAX_SHADOWS, fromStored, sanitize, sanitizeList, type ShadowParams } from './shadow';

const LAST_USED = 'last-used';

// The panel asks for the height its content needs, so it never has to scroll; past MAX_HEIGHT
// (a long list, the open copy table) it scrolls after all.
const WIDTH = 320;
const MIN_HEIGHT = 240;
const MAX_HEIGHT = 820;
figma.showUI(__html__, { width: WIDTH, height: 620, themeColors: true });

function post(message: PluginMessage) {
  figma.ui.postMessage(message);
}

function lastUsed(raw: unknown): ShadowParams[] | null {
  if (Array.isArray(raw)) {
    const shadows = sanitizeList(raw);
    return shadows.length ? shadows : null;
  }
  // v0.2 remembered one shadow's settings
  return raw && typeof raw === 'object' ? fromStored(JSON.stringify({ ...raw, v: 2 })) : null;
}

function report(notes: Set<string>, unstored: number) {
  for (const note of notes) figma.notify(note);
  if (unstored) {
    figma.notify(`Shadow added, but ${unstored} layer${unstored > 1 ? 's' : ''} inside an instance can't keep its settings. Edit the main component to keep it editable.`);
  }
}

function postSelection() {
  const nodes = selected();
  let shadows: ShadowParams[] | null = null;
  let managed = 0;
  let replaces = 0;
  let styled = 0;
  for (const node of nodes) {
    const stored = readShadows(node);
    if (stored) {
      managed++;
      shadows = shadows ?? stored;
    } else {
      replaces += node.effects.filter((e) => e.type === 'DROP_SHADOW').length;
      if (node.effectStyleId) styled++;
    }
  }
  const blocked = nodes.map(mergeBlocker).find((reason) => reason !== null) ?? null;
  post({
    type: 'selection',
    total: figma.currentPage.selection.length,
    capable: nodes.length,
    managed,
    shadows,
    replaces,
    styled,
    mergeBlocker: blocked,
  });
}

/** Applies `change` to each selected layer's shadow list and writes the result; an emptied
 *  list removes the shadow. */
function edit(change: (shadows: ShadowParams[]) => ShadowParams[] | null, rematch: boolean): Set<string> {
  const notes = new Set<string>();
  for (const node of selected()) {
    const current = readShadows(node);
    const next = current && change(current);
    if (!next) continue;
    if (next.length) {
      const result = writeShadows(node, next, rematch);
      if (result.note) notes.add(result.note);
    } else {
      clearShadows(node);
    }
  }
  return notes;
}

figma.ui.onmessage = async (msg: UiMessage) => {
  switch (msg.type) {
    case 'ready': {
      post({ type: 'init', last: lastUsed(await figma.clientStorage.getAsync(LAST_USED)) });
      if (rematchSelection()) figma.commitUndo();
      postSelection();
      break;
    }
    case 'add': {
      const shadows = sanitizeList(msg.shadows);
      if (!shadows.length) break;
      const notes = new Set<string>();
      let unstored = 0;
      for (const node of selected()) {
        if (readShadows(node)) continue;
        const result = writeShadows(node, shadows, true);
        if (!result.stored) unstored++;
        if (result.note) notes.add(result.note);
      }
      figma.commitUndo();
      report(notes, unstored);
      postSelection();
      break;
    }
    case 'update': {
      // Patch, not replace: with several layers selected, only the touched setting changes.
      const notes = edit((shadows) => {
        if (msg.index >= shadows.length) return null;
        return shadows.map((s, i) => (i === msg.index ? sanitize({ ...s, ...msg.patch }) : s));
      }, msg.commit);
      if (msg.commit) figma.commitUndo();
      if (notes.size) {
        report(notes, 0);
        postSelection(); // a refused merge flips back; show it
      }
      break;
    }
    case 'insert': {
      const params = sanitize(msg.params);
      report(
        edit((shadows) => {
          if (shadows.length >= MAX_SHADOWS) return null;
          const next = [...shadows];
          next.splice(Math.min(msg.index, next.length), 0, params);
          return next;
        }, true),
        0,
      );
      figma.commitUndo();
      postSelection();
      break;
    }
    case 'delete': {
      report(edit((shadows) => (msg.index < shadows.length ? shadows.filter((_, i) => i !== msg.index) : null), true), 0);
      figma.commitUndo();
      postSelection();
      break;
    }
    case 'remove': {
      for (const node of selected()) if (readShadows(node)) clearShadows(node);
      figma.commitUndo();
      postSelection();
      break;
    }
    case 'remember': {
      await figma.clientStorage.setAsync(LAST_USED, msg.shadows);
      break;
    }
    case 'resize': {
      figma.ui.resize(WIDTH, Math.round(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, msg.height))));
      break;
    }
  }
};

// Keep the UI honest when shadows change outside the plugin (undo, another editor), and
// merged silhouettes in step with their objects.
let page = figma.currentPage;
let refresh: ReturnType<typeof setTimeout> | undefined;

function onNodeChange(event: NodeChangeEvent) {
  if (Date.now() - lastWriteAt() < 500) return;
  const ids = new Set(selected().map((n) => n.id));
  for (const node of figma.currentPage.selection) ids.add(node.id);
  if (!event.nodeChanges.some((c) => c.type === 'PROPERTY_CHANGE' && ids.has(c.id))) return;
  clearTimeout(refresh);
  refresh = setTimeout(() => {
    if (rematchSelection()) figma.commitUndo();
    postSelection();
  }, 200);
}

page.on('nodechange', onNodeChange);
figma.on('currentpagechange', () => {
  page.off('nodechange', onNodeChange);
  page = figma.currentPage;
  page.on('nodechange', onNodeChange);
});
figma.on('selectionchange', () => {
  if (rematchSelection()) figma.commitUndo();
  postSelection();
});
