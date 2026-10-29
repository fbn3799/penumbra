# penumbra

Figma plugin: a list of layered object shadows per layer, each driven by elevation (gap), distance, softness, direction, start/end color and opacity (solved per overlap band), blend mode, copy count and exponential spacing; each optionally merged onto its own grouped shadow layer; re-editable via stored settings (v3: `{v, shadows}`).

- The model lives in `src/shadow.ts` and is shared by plugin and UI preview. Keep it that way; never duplicate the math.
- `npm test` covers the model. `src/nodes.ts` (what happens to layers) is checked inside a real file: `npm run figma-check`, then run `.test/figma-check.js` with the Figma MCP's `use_figma` in a scratch file. Figma throws on reading a property a node type lacks: guard with `in`.
- Figma draws later effects on top (checked in a file), so copies are written farthest first.
- Figma keeps 8 drop shadows per node (frames, groups and effect styles too) and drops the rest silently; inner shadows and blurs don't count. So the object carries at most 8 copies, the rest go on a "More shadows" layer, and every shadow layer holds its copies in parts of 8 (`MAX_EFFECTS`). Any new place that writes effects must respect it.
- The panel has no sliders: every number is a drag-to-change field (`numberField` in `src/ui.ts`). The panel sends its content height and the plugin resizes the window (`resize` message, capped in `src/code.ts`), so it doesn't scroll. In a hidden browser pane `requestAnimationFrame` never fires, so don't hang UI work that must happen on it.
- Not yet verifiable without Figma desktop: the panel↔plugin messaging, relaunch button, nodechange sync, undo steps.
