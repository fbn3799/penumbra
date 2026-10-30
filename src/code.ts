import type { PluginMessage, UiMessage } from './messages';
import { clearShadows, groupBlocker, lastWriteAt, readShadows, rematchSelection, selected, writeShadows } from './nodes';
import { MAX_SHADOWS, applyPatch, fromStored, insertAt, sanitize, sanitizeList, type ShadowParams } from './shadow';

const LAST_USED = 'last-used';
const CLIPBOARD = 'clipboard';

// The panel asks for the height its content needs, so it never has to scroll; past MAX_HEIGHT
// (a long list, the open copy table) it scrolls after all.
const WIDTH = 320;
const MIN_HEIGHT = 240;
const MAX_HEIGHT = 880;
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
  const blocked = nodes.map(groupBlocker).find((reason) => reason !== null) ?? null;
  post({
    type: 'selection',
    total: figma.currentPage.selection.length,
    capable: nodes.length,
    managed,
    shadows,
    replaces,
    styled,
    groupBlocker: blocked,
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

// A layer Penumbra can't change shouldn't leave the panel stuck on a developer error.
function guard<T extends unknown[]>(run: (...args: T) => unknown) {
  return async (...args: T) => {
    try {
      await run(...args);
    } catch (error) {
      figma.notify(`Penumbra couldn't change this layer: ${error instanceof Error ? error.message : error}`, { error: true });
      try {
        postSelection();
      } catch {
        // the selection is gone; the next selectionchange updates the panel
      }
    }
  };
}

figma.ui.onmessage = guard(async (msg: UiMessage) => {
  switch (msg.type) {
    case 'ready': {
      post({ type: 'init', last: lastUsed(await figma.clientStorage.getAsync(LAST_USED)), clipboard: sanitizeList(await figma.clientStorage.getAsync(CLIPBOARD)) });
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
    case 'paste': {
      // Like add, but onto shadowed layers too: their shadows are replaced.
      const shadows = sanitizeList(msg.shadows);
      if (!shadows.length) break;
      const notes = new Set<string>();
      let unstored = 0;
      for (const node of selected()) {
        const result = writeShadows(node, shadows, true);
        if (!result.stored) unstored++;
        if (result.note) notes.add(result.note);
      }
      figma.commitUndo();
      report(notes, unstored);
      postSelection();
      break;
    }
    case 'copy': {
      const shadows = sanitizeList(msg.shadows);
      await figma.clientStorage.setAsync(CLIPBOARD, shadows);
      figma.notify(`Copied ${shadows.length === 1 ? '1 shadow' : `${shadows.length} shadows`}. Select layers and paste.`);
      break;
    }
    case 'update': {
      // Patch, not replace: with several layers selected, only the touched setting changes, and
      // linked shadows on each layer turn with it.
      const notes = edit((shadows) => (msg.index < shadows.length ? applyPatch(shadows, msg.index, msg.patch) : null), msg.commit);
      if (msg.commit) figma.commitUndo();
      if (notes.size) report(notes, 0);
      break;
    }
    case 'insert': {
      const params = sanitize(msg.params);
      report(
        edit((shadows) => (shadows.length < MAX_SHADOWS ? insertAt(shadows, msg.index, params) : null), true),
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
});

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
  refresh = setTimeout(
    guard(() => {
      if (rematchSelection()) figma.commitUndo();
      postSelection();
    }),
    200,
  );
}

page.on('nodechange', onNodeChange);
figma.on('currentpagechange', () => {
  page.off('nodechange', onNodeChange);
  page = figma.currentPage;
  page.on('nodechange', onNodeChange);
});
figma.on(
  'selectionchange',
  guard(() => {
    if (rematchSelection()) figma.commitUndo();
    postSelection();
  }),
);
