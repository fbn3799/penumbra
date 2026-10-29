import type { PluginMessage, UiMessage } from './messages';
import { clearShadow, lastWriteAt, mergeBlocker, readShadow, rematchSelection, selected, writeShadow } from './nodes';
import { sanitize, type ShadowParams } from './shadow';

const LAST_USED = 'last-used';

figma.showUI(__html__, { width: 300, height: 700, themeColors: true });

function post(message: PluginMessage) {
  figma.ui.postMessage(message);
}


function report(notes: Set<string>, unstored: number) {
  for (const note of notes) figma.notify(note);
  if (unstored) {
    figma.notify(`Shadow added, but ${unstored} layer${unstored > 1 ? 's' : ''} inside an instance can't keep its settings. Edit the main component to keep it editable.`);
  }
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
  const blocked = nodes.map(mergeBlocker).find((reason) => reason !== null) ?? null;
  post({
    type: 'selection',
    total: figma.currentPage.selection.length,
    capable: nodes.length,
    managed,
    params,
    replaces,
    styled,
    mergeBlocker: blocked,
  });
}

figma.ui.onmessage = async (msg: UiMessage) => {
  switch (msg.type) {
    case 'ready': {
      const last = await figma.clientStorage.getAsync(LAST_USED);
      post({ type: 'init', last: last ? sanitize(last) : null });
      if (rematchSelection()) figma.commitUndo();
      postSelection();
      break;
    }
    case 'add': {
      const params = sanitize(msg.params);
      const notes = new Set<string>();
      let unstored = 0;
      for (const node of selected()) {
        if (readShadow(node)) continue;
        const result = writeShadow(node, params, true);
        if (!result.stored) unstored++;
        if (result.note) notes.add(result.note);
      }
      figma.commitUndo();
      report(notes, unstored);
      postSelection();
      break;
    }
    case 'update': {
      // Patch, not replace: with several shadows selected, only the touched setting changes.
      const notes = new Set<string>();
      for (const node of selected()) {
        const current = readShadow(node);
        if (!current) continue;
        const result = writeShadow(node, sanitize({ ...current, ...msg.patch }), msg.commit);
        if (result.note) notes.add(result.note);
      }
      if (msg.commit) figma.commitUndo();
      if (notes.size) {
        report(notes, 0);
        postSelection(); // a refused merge flips back; show it
      }
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
