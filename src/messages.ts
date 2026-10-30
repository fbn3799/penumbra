import type { ShadowParams } from './shadow';

export interface SelectionState {
  total: number; // selected nodes
  capable: number; // of those, nodes that can carry effects
  managed: number; // of those, nodes with Penumbra shadows
  shadows: ShadowParams[] | null; // shadows of the first managed node, top first
  replaces: number; // drop shadows "Add" would replace on unmanaged nodes
  styled: number; // unmanaged nodes whose effect style "Add" would detach
  groupBlocker: string | null; // why the selection can't be grouped with a shadow layer, if it can't
}

export type PluginMessage =
  | { type: 'init'; last: ShadowParams[] | null; clipboard: ShadowParams[] }
  | ({ type: 'selection' } & SelectionState);

// Shadows are addressed by their index in each layer's list, so with several layers selected
// an edit reaches the same shadow on each and leaves the rest of their settings alone.
export type UiMessage =
  | { type: 'ready' }
  | { type: 'add'; shadows: ShadowParams[] }
  | { type: 'update'; index: number; patch: Partial<ShadowParams>; commit: boolean }
  | { type: 'insert'; index: number; params: ShadowParams }
  | { type: 'delete'; index: number }
  | { type: 'remove' }
  | { type: 'remember'; shadows: ShadowParams[] }
  | { type: 'copy'; shadows: ShadowParams[] } // kept in client storage, so it reaches other files
  | { type: 'paste'; shadows: ShadowParams[] } // onto every selected layer, replacing its shadows
  | { type: 'resize'; height: number };
