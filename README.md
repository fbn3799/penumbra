# Penumbra

A Figma plugin for realistic, layered drop shadows: object shadows that behave like light. Set where the shadow starts, how far it reaches, how soft it gets, how its copies are spaced and blurred (two curves) and how strength and color run from the object outwards; Penumbra writes the drop shadows. Stack several shadows on one layer, say a tight contact shadow under a wide ambient one, or sink the layer in with inner shadows. Select the layer again any time and the plugin picks the settings back up.

## Controls

**Shadows** lists the layer's shadows. Click one to edit it, **+** adds one (a copy of the selected shadow, right below it), **−** removes it, up to 16 shadows. The first shadow draws on top. Everything below applies to the selected shadow.

Every number is a field: drag it sideways to change it (Shift snaps to round steps), type a value, or use the arrow keys (Shift for 10 steps). A click without a drag starts typing. The window grows and shrinks with its content, so it doesn't scroll until it reaches 880 px; two shadows still fit.

| Control | What it does |
|---|---|
| **Eye** (on a shadow's row) | Hides the shadow: it keeps its settings but isn't drawn until you show it again. |
| **Copy / Paste** (next to Shadows) | Copy takes all of the panel's shadows, hidden ones included. Paste puts them on every selected layer, replacing that layer's shadows, in one undo step. With nothing selected, Paste loads them into the panel, ready for **Add shadow**. The copy is kept by the plugin, so it reaches other files too. |
| **Light** | Each shadow is cast by one light, with a Direction and a Distance, and Softness under Opacity. It also sits on the preview: drag it to move it, over the card too. The shadow falls away from it, and the further it sits from the card's center, the longer the shadow: 0 px at the center, 1000 px on a circle that just fits the preview, the same in every direction, on a log scale so short shadows get room too. At the center the light keeps its direction. Shift snaps the direction to 15°, Alt moves it slower. |
| **Direction** | Where the light casts the shadow, away from itself. 90° is straight down. Drag the field (Shift snaps to 15°), or drag the little dial in it to aim. |
| **Distance** | How far the light casts the shadow beyond the elevation gap, in px. The farthest copy sits at elevation + distance. |
| **Softness**, Start / End | Under Opacity: the blur where the shadow starts and at its far end, in px. The Blur curve runs between them. With one copy only End applies. |
| **Link** (chain, next to Light) | Linked shadows turn together: they share the light's direction, so turning one turns them all. Distance and softness stay each shadow's own, so a tight contact shadow and a long cast shadow can share a light. New shadows start linked. Unlink a shadow to give it a light of its own; link it again and it turns like the rest. |
| **Elevation** (first row under Shadow) | How far the object floats: the gap before the shadow starts, in px. It belongs to the object, so every shadow's light starts from it. 0 rests on the surface, with a tight contact shadow at the edge. |
| **Drop / Inner** | A drop shadow falls behind the layer; an inner shadow falls inside it, as if the layer were sunk into the surface, with the same light, copies, start and end. |
| **Color**, Start / End | Color next to the object and at the far end. Each copy steps evenly between them. A tinted dark reads more natural than black. The chain beside Color links them: one color throughout, set from either field. |
| **Opacity**, Start / End | Strength next to the object and at the far end, in even steps per copy (see below). With one copy only Start applies. |
| **Blending** (second row under Shadow) | Blend mode of every copy, the same list as Figma's. |
| **Count** (next to Copies) | How many copies build this shadow, up to 32. 1 = one solid shadow. Figma keeps only 8 drop and 8 inner shadows per layer; see [More than 8 copies](#more-than-8-copies). |
| **Curve** (under Copies) | Picks the ramp the curve below shapes. **Distance**: where the copies sit (across: copy 1 to the last; up: their share of the distance); the default bends down, so the gaps widen towards the far end. **Blur**: how soft the copies get (across: how far a copy sits along the shadow; up: how far it is from start to end softness). **Opacity** and **Color**: how strength and color run from Start to End (across: the nearest copy to the farthest). Every curve but Distance starts as a straight line, which steps evenly. |

Each curve is a cubic Bézier with dots for the copies: a start and an end (filled), which stay in the 0–1 square (the lighter area), and two handles (hollow), which can be pulled past it on every side: half a square up and down, a quarter to the sides. A handle pulled past the far end is read along its own line, so the curve keeps the direction it points in; one pulled back behind its own end makes the curve leave straight up or down. Grab a point and drag it; an end takes its handle along. Hold Shift to lay a handle flat or upright from its end, or to snap an end to tenths. Before its start and after its end a curve runs flat, so moving the ends sets where the ramp begins and stops. Double-click a handle to straighten the curve between its ends, an end to put it back in its corner.

The preview mirrors every shadow, blend modes included, and carries the selected shadow's light (Chromium can't do Plus darker, so the preview shows it as Multiply; Figma renders it properly).

## Start and end opacity

Copies overlap: the area next to the object is covered by every copy, the far end by the last one only. So Penumbra doesn't give the copies the start and end values themselves. It solves each copy's alpha so that the overlap comes out at Start next to the object, at End at the far end, and in even steps in between. The numbers in Figma's effects panel are those solved alphas.

Two consequences:

- **Start can't be lighter than End.** Every copy covers the area next to the object, so the shadow is at least as strong there as at the far end. A lighter Start levels out at End.
- **No copy is stronger than the ones nearer the object.** Right behind the object every copy overlaps, but beside it the copies show on their own, so a far copy stronger than the ones before it would stand out at the end. Even steps need the far copy alone to be no more than one step, so a strong End (100% → 60% over 12 copies, say) or an even shadow can't step evenly. Then the far copies share the fade: Start stays as set, and the far end comes out lighter than End.

Colors step evenly per copy, and the nearest copy draws on top. The copies' colors mix where they overlap, so next to the object the start color is tinted by the later ones.

## More than 8 copies

Figma keeps at most 8 drop shadows and 8 inner shadows on a layer (frames, groups and effect styles alike) and drops the rest without an error. Penumbra works around both:

- **Up to 8 copies** of a kind (all shadows together) sit on the object as its own effects: no group, no extra layer.
- **Past 8 drop copies**, all of them move to one **Shadows** layer right below the object, grouped with it, so the shadow is never split between the two. The layer holds the copies in parts of 8, each casting from its own copy of the object, which the object covers.
- **Past 8 inner copies**, all of them move to one **Inner shadows** layer right above the object, in the same group. Its parts are copies of the object at 0.1% opacity: invisible themselves, but Figma draws inner shadows on any fill that isn't fully transparent, so each part lays 8 inner shadows over the object. Inner shadows you added yourself stay on the object.

```
<object name>      group
  Inner shadows    locked, only past 8 inner copies
    8 copies       up to 8 of the inner shadows, the top ones first
    8 copies       a copy of the object at 0.1%, carrying them
  <object>         no drop shadows of its own (nor inner ones, past 8)
  Shadows          locked
    8 copies       up to 8 of the drop shadows, the nearest on top
      Color        masked to the silhouette
      Silhouette   a copy of the object (an instance, for a main component)
    4 copies       the farther ones
```

- The group has the object's bounds, so it takes the object's slot in an auto layout without moving anything. Clicking the shadow selects the group; the plugin treats the group and the object as the same shadow.
- When the object changes shape (resize, corner radius, text), the silhouettes and inner copies are copied again the next time you select it or edit with the plugin open. Each part adds a copy of the object, so keep that in mind on heavy layers.
- Not possible for layers that fill their auto layout (a group can't fill), layers inside an instance, or variants: they keep Figma's limit, the bottom copies are left out, and Figma shows a notice saying how many.
- Going back to 8 copies or fewer of each kind, or **Remove**, puts the object back where the group was.

## Editing later

- The settings are stored on the layer. Select it with the plugin open and the controls load them; from then on every change applies live. Each drag or typed value is one undo step.
- Shadowed layers get an **Edit shadow** button in Figma's right sidebar (relaunch button), which reopens the plugin on that layer.
- With several shadowed layers selected, the panel shows the first layer's shadows. A change only touches the setting you moved, on the same shadow (by position) of each layer. Each layer keeps the rest of its own settings.
- Select a layer without a shadow and the current shadows stay in the panel, so **Add shadow** copies them from one layer to another. To move shadows onto layers that already have their own, use **Copy** and **Paste**. The last-used shadows are remembered between sessions.
- Shadows made with v0.3 open with one light each, linked if they all fell the same way. Their spacing becomes the distance curve closest to it.
- Merged shadows and hard outlines from earlier versions become plain shadows the next time you select the layer, and copies split between the object and a "More shadows" layer move onto one layer.
- Shadows made with v0.1 or v0.2 convert on first edit: v0.2's one color and opacity become equal start and end colors, and a stacked v0.2 shadow keeps its fade (Start at the old opacity, End at one copy's alpha).

## What it changes

- Penumbra **owns a layer's drop shadows.** Adding a shadow replaces any drop shadows already there (the footer says how many). Inner shadows you added yourself, layer and background blurs, and other effects are kept: Penumbra only replaces the inner shadows it wrote.
- Copies past Figma's 8 group the layer with a shadow layer, or two (see above).
- Setting effects detaches an effect style if the layer had one (the footer warns about this too).
- Layers inside an instance can take the shadow but can't store settings, so edit the main component instead. The plugin tells you when this happens.
- Settings live in shared plugin data (`penumbra` namespace), so shadows stay editable when the plugin id changes on publish.
- No network access. Besides the layers, Penumbra keeps only your last-used and your copied shadows, in Figma's client storage on your device.

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
- `src/nodes.ts`: what Penumbra does to layers (effects, the shadow layer, silhouettes, stored settings).
- `src/code.ts`: the plugin entry (selection, messages, undo, nodechange sync).
- `src/ui.ts` + `src/ui.html`: the panel. `build.mjs` inlines the bundled script into `dist/ui.html`.
- `test/figma-check.ts` runs `src/nodes.ts` inside a Figma file through the Figma MCP's `use_figma`, and returns the structure it built plus a screenshot. Run it in a scratch file; it adds a board to the current page.

## License

[MIT](LICENSE)
