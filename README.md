# Penumbra

A Figma plugin for object shadows that behave like light. Set where the shadow starts, how far it reaches, how soft it gets and how its copies are spaced; Penumbra writes the drop shadows. Select the layer again any time and the plugin picks the settings back up.

## Controls

| Control | What it does |
|---|---|
| **Elevation** | How far from the object the shadow starts, in px. 0 rests on the surface, with a tight contact shadow at the edge. |
| **Distance** | How far the shadow reaches beyond that gap, in px. The farthest copy sits at elevation + distance. |
| **Softness** | Blur of the farthest copy, in px. Closer copies are sharper, in step with their offset, the way a shadow softens the further it falls. |
| **Direction** | Where the shadow falls. 90° is straight down. Drag the dial, or hold Shift to snap to 15°. |
| **Color** | Shadow color. A tinted dark reads more natural than black. |
| **Opacity** | Strength of the whole shadow. |
| **Blending** | Blend mode, the same list as Figma's. Merged, it applies to the shadow as one. |
| **Merge** | Draws the copies as one shadow on a layer behind the object (see below). Off, the copies are separate drop shadows on the object. |
| **Count** | How many copies build the shadow. 1 = one solid shadow. |
| **Spacing** | Each gap between copies is this many times the one before: 1× is even, 2× doubles every gap, below 1× the widest gaps sit next to the object. The strip under it shows where each copy lands. |

The preview mirrors the copies, blend mode and merge included (Chromium can't do Plus darker, so the preview shows it as Multiply; Figma renders it properly). The generated values are listed under **drop shadows generated**.

## Merge: one shadow, one opacity

Figma draws every drop shadow on a layer separately and has no shared opacity for them, so where copies overlap they add up. Off, Penumbra solves each copy's alpha so the stack adds up to exactly the set opacity. Hard copies still step visibly, though.

On, Penumbra groups the object with a shadow layer:

```
<object name>      group
  Shadow           locked; carries the drop shadows, opacity and blend mode
    Color          the shadow color, masked to the silhouette
    Silhouette     a copy of the object (an instance, for a main component)
  <object>
```

The copies are drawn opaque, so they fuse into one shape, and the shadow layer's opacity fades that shape as a whole. Because it's a real layer, it works on any background, photos included. At the same opacity a merged shadow reads darker than a stacked one, since the whole core is at full strength.

- The group has the object's bounds, so it takes the object's slot in an auto layout without moving anything.
- Clicking the shadow selects the group; the plugin treats the group and the object as the same shadow.
- When the object changes shape (resize, corner radius, text), the silhouette is re-copied the next time you select it or edit with the plugin open.
- Not possible for layers that fill their auto layout (a group can't fill), layers inside an instance, or variants. The switch says why and the shadow stays as effects.
- Turning Merge off, or **Remove**, puts the object back where the group was.

## Editing later

- The settings are stored on the layer. Select it with the plugin open and the controls load them; from then on every change applies live. Each drag or typed value is one undo step.
- Shadowed layers get an **Edit shadow** button in Figma's right sidebar (relaunch button), which reopens the plugin on that layer.
- With several shadowed layers selected, a change only touches the setting you moved. Each layer keeps the rest of its own settings.
- Select a layer without a shadow and the current settings stay in the panel, so **Add shadow** copies a shadow from one layer to another. The last-used settings are remembered between sessions.
- Shadows made with v0.1 (when elevation was an overall size) convert to the same reach on first edit.

## What it changes

- Penumbra **owns a layer's drop shadows.** Adding a shadow replaces any drop shadows already there (the footer says how many). Inner shadows, layer and background blurs, and other effects are kept.
- Setting effects detaches an effect style if the layer had one (the footer warns about this too).
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
npm run watch        # rebuilds dist/ on save (edits to ui.html need a restart)
npm test             # shadow model tests
npm run typecheck
npm run figma-check  # bundles test/figma-check.ts for a real Figma file (see below)
```

- `src/shadow.ts`: the model. Both sides share it, so the plugin and the preview can't drift apart.
- `src/nodes.ts`: what Penumbra does to layers (effects, merged groups, silhouettes, stored settings).
- `src/code.ts`: the plugin entry (selection, messages, undo, nodechange sync).
- `src/ui.ts` + `src/ui.html`: the panel. `build.mjs` inlines the bundled script into `dist/ui.html`.
- `test/figma-check.ts` runs `src/nodes.ts` inside a Figma file through the Figma MCP's `use_figma`, and returns the structure it built plus a screenshot. Run it in a scratch file; it adds a board to the current page.
