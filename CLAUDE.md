# penumbra

Figma plugin: layered object shadows driven by elevation (gap), distance, softness, direction, color, opacity, blend mode, copy count and exponential spacing; optionally merged onto one grouped shadow layer; re-editable via stored settings.

- The model lives in `src/shadow.ts` and is shared by plugin and UI preview. Keep it that way; never duplicate the math.
- `npm test` covers the model. `src/nodes.ts` (what happens to layers) is checked inside a real file: `npm run figma-check`, then run `.test/figma-check.js` with the Figma MCP's `use_figma` in a scratch file. Figma throws on reading a property a node type lacks: guard with `in`.
- Not yet verifiable without Figma desktop: the panel↔plugin messaging, relaunch button, nodechange sync, undo steps.
