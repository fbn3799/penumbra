# Penumbra

A Figma plugin for object shadows that behave like light. Set how high the object floats, where the light is and how soft it is; Penumbra writes the drop shadows. Select the layer again any time and the plugin picks the settings back up.

## Controls

| Control | What it does |
|---|---|
| **Elevation** | How far the object floats above the surface, in px. Raising it throws the shadow further and softens it, the way a lifted object does. |
| **Distance** | How far the shadow is thrown, as a share of elevation (a low sun means a long shadow). |
| **Softness** | How diffuse the light is: blur as a share of elevation. |
| **Direction** | Where the shadow falls. 90° is straight down. Drag the dial, or hold Shift to snap to 15°. |
| **Color** | Shadow color. A tinted dark reads more natural than black. |
| **Opacity** | Strength of the whole shadow. Each layer's alpha is worked out so the stack adds up to exactly this, so it stays one shadow at any layer count. |
| **Blending** | Blend mode for the shadow, the same list as Figma's. |
| **Shadows** | How many drop shadows build the shadow. 1 = one solid shadow. More layers grow from a tight contact shadow at the edge out to the full throw. |

The preview mirrors the layers, blend mode included (Chromium can't do Plus darker, so the preview shows it as Multiply; Figma renders it properly). The generated values are listed under **drop shadows generated**.

## Editing later

- The settings are stored on the layer. Select it with the plugin open and the controls load them; from then on every change applies live. Each drag or typed value is one undo step.
- Shadowed layers get an **Edit shadow** button in Figma's right sidebar (relaunch button), which reopens the plugin on that layer.
- With several shadowed layers selected, a change only touches the setting you moved. Each layer keeps the rest of its own settings.
- Select a layer without a shadow and the current settings stay in the panel, so **Add shadow** copies a shadow from one layer to another. The last-used settings are remembered between sessions.

## What it changes

- Penumbra **owns a layer's drop shadows.** Adding a shadow replaces any drop shadows already there (the footer says how many). Inner shadows, layer and background blurs, and other effects are kept.
- Setting effects detaches an effect style if the layer had one (the footer warns about this too).
- **Remove** deletes the drop shadows and the stored settings.
- Layers inside an instance can take the shadow but can't store settings, so edit the main component instead. The plugin tells you when this happens.
- Settings live in shared plugin data (`penumbra` namespace), so shadows stay editable when the plugin id changes on publish.

## Install (development)

```bash
npm install
npm run build
```

Figma desktop → **Plugins → Development → Import plugin from manifest…** → pick `manifest.json`. Then run it from **Plugins → Development → Penumbra**.

If Figma rejects the placeholder `id` in `manifest.json`: create a new plugin in Figma (Plugins → Development → New plugin), copy the id it generates into the manifest, and import again.

## Develop

```bash
npm run watch      # rebuilds dist/ on save (edits to ui.html need a restart)
npm test           # shadow model tests
npm run typecheck
```

- `src/shadow.ts`: the model. Both sides share it, so the plugin and the preview can't drift apart.
- `src/code.ts`: the Figma side (selection, effects, stored settings, undo, nodechange sync).
- `src/ui.ts` + `src/ui.html`: the panel. `build.mjs` inlines the bundled script into `dist/ui.html`.
