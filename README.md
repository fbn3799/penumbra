# Penumbra

A Figma plugin for realistic, layered drop shadows: object shadows that behave like light. Set where the shadow starts, how far it reaches, how soft it gets, how its copies are spaced and how strength and color run from the object outwards; Penumbra writes the drop shadows. Stack several shadows on one layer, say a tight contact shadow under a wide ambient one. Select the layer again any time and the plugin picks the settings back up.

## Controls

**Shadows** lists the layer's shadows. Click one to edit it, **+** adds one (a copy of the selected shadow, right below it), **−** removes it, up to 16 shadows. The first shadow draws on top. Everything below applies to the selected shadow.

Every number is a field: drag it sideways to change it (Shift snaps to round steps), type a value, or use the arrow keys (Shift for 10 steps). A click without a drag starts typing. The window grows and shrinks with its content, so it doesn't scroll until it reaches 820 px (many shadows, or the open copy table).

| Control | What it does |
|---|---|
| **Elevation** | How far from the object the shadow starts, in px. 0 rests on the surface, with a tight contact shadow at the edge. |
| **Distance** | How far the shadow reaches beyond that gap, in px. The farthest copy sits at elevation + distance. |
| **Softness** | Blur of the farthest copy, in px. Closer copies are sharper, in step with their offset, the way a shadow softens the further it falls. |
| **Direction** | Where the shadow falls. 90° is straight down. Drag the field (Shift snaps to 15°), or drag the little dial in it to aim. |
| **Color**, Start / End | Color next to the object and at the far end. Each copy steps evenly between them. A tinted dark reads more natural than black. |
| **Opacity**, Start / End | Strength next to the object and at the far end, in even steps per copy (see below). With one copy only Start applies. |
| **Blending** | Blend mode, the same list as Figma's. Merged, it applies to the shadow as one. |
| **Merge** | Draws this shadow's copies on its own layer behind the object (see below). Off, they're drop shadows on the object. Each shadow merges or not on its own. |
| **Count** | How many copies build this shadow, up to 12. 1 = one solid shadow. Figma keeps only 8 drop shadows per layer; see [More than 8 copies](#more-than-8-copies). |
| **Spacing** | Each gap between copies is this many times the one before: 1× is even, 2× doubles every gap, below 1× the widest gaps sit next to the object. The strip under it shows where each copy lands. |

The preview mirrors every shadow, blend mode and merge included (Chromium can't do Plus darker, so the preview shows it as Multiply; Figma renders it properly). The strip under Spacing shows each copy in its color. The generated values for the selected shadow are listed under **drop shadows generated**.

## Start and end opacity

Copies overlap: the area next to the object is covered by every copy, the far end by the last one only. So Penumbra doesn't give the copies the start and end values themselves. It solves each copy's alpha so that the overlap comes out at Start next to the object, at End at the far end, and in even steps in between. The numbers in Figma's effects panel are those solved alphas.

Two consequences:

- **Start can't be lighter than End.** Every copy covers the area next to the object, so the shadow is at least as strong there as at the far end. A lighter Start levels out at End, and the panel says so.
- **Even strength as effects is the farthest copy alone**, since any other copy would darken the area next to the object. Merged, every copy stays: see below.

Colors step evenly per copy, and the nearest copy draws on top. As effects, the copies' colors mix where they overlap, so next to the object the start color is tinted by the later ones. Merged, the nearest copy is opaque, so the start color shows as set.

## Merge: one shadow layer, one opacity

Figma draws every drop shadow on a layer separately and has no shared opacity for them, so where copies overlap they add up, and hard copies step visibly.

Merged, Penumbra groups the object with one shadow layer per merged shadow:

```
<object name>      group
  <object>         shadows that aren't merged stay effects here, above every shadow layer
  More shadows     only past 8 such copies, see below
  Shadow 1         locked; carries the opacity and blend mode
    8 copies       up to 8 of the drop shadows, the nearest on top
      Color        the start color, masked to the silhouette
      Silhouette   a copy of the object (an instance, for a main component)
    4 copies       the farther ones, when there are more than 8
  Shadow 2         the next merged shadow, below the first
```

The nearest copy is drawn opaque and the shadow layer's opacity carries the Start strength, so the core fuses into one shape and fades as a whole; with equal Start and End every copy is opaque and the shadow is one even shape. Because it's a real layer, it works on any background, photos included. At the same opacity a merged shadow reads darker than a stacked one, since its core is at full strength. Each merged shadow adds a copy of the object, so keep that in mind on heavy layers.

- The group has the object's bounds, so it takes the object's slot in an auto layout without moving anything.
- Clicking the shadow selects the group; the plugin treats the group and the object as the same shadow.
- When the object changes shape (resize, corner radius, text), the silhouette is re-copied the next time you select it or edit with the plugin open.
- Not possible for layers that fill their auto layout (a group can't fill), layers inside an instance, or variants. The switch says why and the shadow stays as effects.
- Turning Merge off on every shadow, or **Remove**, puts the object back where the group was.

## More than 8 copies

Figma keeps at most 8 drop shadows on a layer (frames, groups and effect styles alike) and drops the rest without an error. Inner shadows and blurs don't count. Penumbra works around it:

- **As effects**, the top 8 copies stay on the object. The rest go on a **More shadows** layer right below it, grouped with the object the same way a merged shadow is, and they draw as if they were all on the object.
- **Merged**, the shadow layer holds its copies in parts of 8, each with its own copy of the object.
- With 8 copies or fewer as effects, nothing changes: no group, no extra layer. The panel says when copies move to a layer.
- Layers that can't be grouped (see above) keep Figma's limit: the bottom copies are left out, and the panel says how many.
- Both kinds of shadow layer sit under a copy of the object, which shows through only where the object itself is see-through.

## Editing later

- The settings are stored on the layer. Select it with the plugin open and the controls load them; from then on every change applies live. Each drag or typed value is one undo step.
- Shadowed layers get an **Edit shadow** button in Figma's right sidebar (relaunch button), which reopens the plugin on that layer.
- With several shadowed layers selected, the panel shows the first layer's shadows. A change only touches the setting you moved, on the same shadow (by position) of each layer. Each layer keeps the rest of its own settings.
- Select a layer without a shadow and the current shadows stay in the panel, so **Add shadow** copies them from one layer to another. The last-used shadows are remembered between sessions.
- Shadows made with v0.1 or v0.2 convert on first edit: v0.2's one color and opacity become equal start and end colors, and a stacked v0.2 shadow keeps its fade (Start at the old opacity, End at one copy's alpha).

## What it changes

- Penumbra **owns a layer's drop shadows.** Adding a shadow replaces any drop shadows already there (the footer says how many). Inner shadows, layer and background blurs, and other effects are kept.
- Merged shadows, and copies past Figma's 8, group the layer with shadow layers (see above).
- Setting effects detaches an effect style if the layer had one (the footer warns about this too).
- Layers inside an instance can take the shadow but can't store settings, so edit the main component instead. The plugin tells you when this happens.
- Settings live in shared plugin data (`penumbra` namespace), so shadows stay editable when the plugin id changes on publish.
- No network access. Besides the layers, Penumbra keeps only your last-used shadow, in Figma's client storage on your device.

## Install (development)

```bash
npm install
npm run build
```

Figma desktop → **Plugins → Development → Import plugin from manifest…** → pick `manifest.json`. Then run it from **Plugins → Development → Penumbra**.

The `id` in `manifest.json` is Penumbra's Figma-issued plugin id. Keep it, so releases go to the same listing.

Publishing to Figma Community (checklist, listing copy, images): [PUBLISHING.md](PUBLISHING.md).

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

## License

[MIT](LICENSE)
