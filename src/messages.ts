import type { ShadowParams } from './shadow';

export interface SelectionState {
  total: number; // selected nodes
  capable: number; // of those, nodes that can carry effects
  managed: number; // of those, nodes with a Penumbra shadow
  params: ShadowParams | null; // settings of the first managed node
  replaces: number; // drop shadows "Add" would replace on unmanaged nodes
  styled: number; // unmanaged nodes whose effect style "Add" would detach
  mergeBlocker: string | null; // why the selection can't merge, if it can't
}

export type PluginMessage =
  | { type: 'init'; last: ShadowParams | null }
  | ({ type: 'selection' } & SelectionState);

export type UiMessage =
  | { type: 'ready' }
  | { type: 'add'; params: ShadowParams }
  | { type: 'update'; patch: Partial<ShadowParams>; commit: boolean }
  | { type: 'remove' }
  | { type: 'remember'; params: ShadowParams };
