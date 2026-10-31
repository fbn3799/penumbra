# Publishing to Figma Community

Figma only accepts submissions from the **desktop app**, from an account with two-factor authentication on (Fabian's account has it; Flow to Lottie and Copy Paste Overrides went out from it). Review takes a few days and the answer comes by email.

**Where it stands (2026-10-31):** v0.3 is submitted (versions 1 and 2, both 2026-10-29) and still in review; its listing page is private until approved. v0.4 goes out as the next version of the same listing, with a new description, new images and the brand below. Version 2 went in the same way while the first was in review.

## 1. Run it once in Figma desktop

Review rejects plugins that crash or show developer errors, and the panel has only run in a browser harness so far. So before publishing:

```bash
npm install
npm run build
```

**Plugins → Development → Import plugin from manifest…** → `manifest.json`. The manifest carries the id Figma issued (`1697766878329271677`, since 2026-10-29), so the imported plugin and the published listing are the same.

Already imported for v0.3? `npm run build` is enough; the development plugin picks up the new `dist/`. Then, on a scratch file:

- [ ] Select a rectangle, open Penumbra, **Add shadow**. The shadow appears and the panel shows its settings.
- [ ] Drag Elevation, Distance and Softness sideways. The layer follows live; one ⌘Z undoes one drag.
- [ ] Set Count to 12. The layer is grouped with a locked "Shadows" layer holding all 12 copies, and the layer itself keeps none; back to 8 and the group goes.
- [ ] Switch the Curve select through Distance, Blur, Opacity and Color and bend each, dragging the ends too: the copies move, soften, fade and change color live; double-click a handle to straighten a curve.
- [ ] Set start and end Softness under Opacity: near copies get the start blur, the far end the end blur.
- [ ] Unlink the colors (chain beside Color), give End its own color, link again: End takes Start's color.
- [ ] Add a second shadow with **+**, hide it with its eye and show it again, then remove it with **−**.
- [ ] **Copy** the shadows, select two other layers (one with a shadow of its own), **Paste**: both get the copied shadows; one ⌘Z undoes it. Paste also works in another file.
- [ ] Deselect, close the plugin, select the layer again: the sidebar shows **Edit shadow**, and it reopens with the same settings.
- [ ] Drag the light (the sun) on the preview, across the card too: the shadow turns away from it and grows as it moves away from the card's center, live on the layer; one ⌘Z undoes the drag.
- [ ] Add a second shadow: it turns with the first (linked) and keeps its own distance; unlink it with the chain and it turns alone. Drag each light the same few pixels from the card's center, sideways and upwards: the distances read about the same.
- [ ] Switch a shadow to **Inner**: it falls inside the layer. An inner shadow you added by hand stays when you edit or remove Penumbra's. Two inner shadows of 8 copies: both show, from a locked "Inner shadows" layer above the object; back to 8 copies in all and the group goes.
- [ ] Select a layer inside an instance and give it 12 copies. A Figma notice says why it can't be grouped and that 4 copies are left out, another that the settings can't be stored there, and nothing errors.
- [ ] The window fits its content without scrolling, also with two shadows (≈ 824 px).
- [ ] Pull curve handles outside the light square, above, below and to the sides: the curve follows each handle's line. Hold Shift while dragging one: it lies flat or stands upright from its end.

## 2. Publish the new version

Figma desktop → **Plugins → Manage plugins…** (or Development → Manage plugins in development) → Penumbra → **Publish new version**. The form holds the listing as it is; replace what changed for v0.4: the **description**, the **version notes**, **all six images** and two **data security** answers. Name, tagline, tags and support stay as they are. Everything you paste has its own block below.

**Name**

```
Penumbra – Realistic, Layered Drop Shadows
```

**Tagline**

```
Smooth, soft, long and inner shadows with real elevation, light and color fade, editable anytime.
```

**Description**

```
Realistic drop shadows for Figma, built the way light makes them: a stack of soft copies that grows wider and fainter with distance. Smooth, soft, long or colored, on cards, buttons, icons and images. And every shadow stays editable. Select the layer again, or click "Edit shadow" in the sidebar, and every setting comes back.

• Light: drag the light on the preview to aim the shadow and set its length. Each shadow has its own distance and softness; elevation, the gap before the shadow starts, belongs to the object. Link shadows so they all turn with one light.
• Start and end: the color and opacity next to the object and at the far end, or one linked color throughout. Penumbra solves each copy's alpha so the overlaps add up to what you set.
• Copies: one for a single solid shadow, up to 32 for a smooth one. Four curves shape them: where the copies sit, how soft each gets, and how strength and color fade.
• Several shadows per layer: a tight contact shadow, a long key shadow and a soft ambient fill, each with its own settings.
• Inner shadows: the same light, copies and fade, cast inside the layer.
• Past Figma's limit: Figma keeps 8 drop and 8 inner shadows per layer. Past that, Penumbra puts all the copies on grouped shadow layers instead of dropping them.
• Hide a shadow without losing it, and copy a layer's shadows onto others, in any file.
• Every number is a field: drag it sideways (Shift snaps), click to type, or use the arrow keys. Changes apply live, one undo step per drag.
• Several layers at once: an edit changes only the setting you touched.

Layers inside instances, variants and auto layout fill layers can't be grouped, so they keep Figma's limit of 8 copies.

Penumbra only changes the layers you select. It has no network access; settings are stored on the layers, and your last and copied shadows on your device.

Open source (MIT): https://github.com/fbn3799/penumbra
```

**Tags**, strongest first. Figma's tutorial allows twelve and a help mirror says five; if the form stops at five, these five carry the weight.

```
shadow
```

```
drop shadow
```

```
realistic shadow
```

```
smooth shadow
```

```
layered shadow
```

```
soft shadow
```

```
long shadow
```

```
elevation
```

```
box shadow
```

```
depth
```

```
inner shadow
```

```
light
```

**Support contact**

```
info@fabianschneider.net
```

**Version notes**

```
Inner shadows, a light you drag on the preview, and curves for distance, blur, opacity and color. Link start and end colors, hide a shadow, copy and paste shadows across files, up to 32 copies. Past 8 drop or 8 inner copies, all of them go on grouped shadow layers. Merge is gone: merged shadows become plain shadows the next time you select the layer.
```

**Images**, from `assets/`:

- Icon: `icon.png` (128 × 128), new
- Thumbnail: `cover.png` (1920 × 1080), new: the key visual's sphere with the title
- Carousel, in this order, all four new: `carousel-1-panel.png`, `carousel-2-elevation.png`, `carousel-3-color.png`, `carousel-4-stack.png`

**Picked, not pasted:**

| Field | Choose |
|---|---|
| Category | Design tools → Editing & effects (as set for v0.3) |
| Publisher | Fabian Schneider |
| Price | Free |
| Comments | Allowed |
| Network access | Shows "No access to network" by itself (from the manifest) |

### Data security form

Optional, but Flow to Lottie has one. Paste whichever answer a question asks for.

**Network**

```
None. The plugin makes no network requests; its manifest allows no domains.
```

**Data collected or sent**

```
None. No accounts, analytics, tracking or third parties.
```

**Data stored**

```
Each shadow's settings in shared plugin data on its layer, inside the file. The last-used and the copied shadows in figma.clientStorage, on the user's device.
```

**What it changes**

```
Only the selected layers' drop shadows and the inner shadows it wrote, and the shadow layers it groups with them.
```

### Being found for "shadow"

Community search ranks on the **name** first and reads the **tagline** too. Checked on 2026-10-29: every top plugin for "shadow" has the word in its name, and plugins with a few hundred users rank on the strength of their tagline alone ("Shadow Pro" is second for "realistic shadow" because its tagline says "realistic"). Plain "Penumbra" would match nothing, hence the name and tagline above:

- the name carries **shadows**, **drop shadows**, **realistic** and **layered**;
- the tagline carries **smooth**, **soft**, **long**, **inner**, **elevation**, **light** and **color**;
- the description's first lines repeat them in sentences, and the tags cover the rest.

`manifest.json` has the same name, so the publish form starts with it. Keep both if you rename. After publishing, search "shadow" filtered to Plugins and sorted by Recent to see it listed; relevance rank grows with users and likes.

## 3. After it's live

- Check the listing's id (in its Community URL) matches `manifest.json`, so later releases update the same listing.
- Add the Community link to the top of the README.
- Tag the release: `git tag v0.4.0 && git push --tags`.

Updates: bump `version` in `package.json`, `npm run build`, then **Manage plugins → Penumbra → Publish new version** with a line of version notes.

## The brand and the images

The brand is the key visual, made in Figma with Penumbra itself: a `#00CCFF` sphere on white, with two shadows, both blended Plus darker.

| Shadow | Copies | Color | Opacity | Light | Softness |
|---|---|---|---|---|---|
| Inner | 8 | `#2F0B93` → `#FF0095` | 73 → 0 % | 234°, 224 px | 0 → 84 px |
| Drop | 12 | `#121C63` → `#7E25A7` | 80 → 0 % | 53°, 395 px | 13 → 97 px |

At 384 px across; scale distance and softness with the size. Type: Instrument Serif for headlines, Inter for text, ink `#0E1033`.

`assets/` holds the listing images:

- `cover.png` is the key visual's sphere, same shadows, beside the eyebrow ("FIGMA PLUGIN"), the title and the tagline (board "Cover" on the page below).
- `icon.png` is a crop of Fabian's key visual frame (700 px square around the sphere), scaled to 128.
- The carousel slides are made with Penumbra's own code (`src/nodes.ts` run through the Figma MCP, like `npm run figma-check`) on the page "Community assets" of the scratch file "Penumbra plugin check (scratch)" in Fabian's drafts, with the brand sphere's settings. The panel on the first slide is the real `dist/ui.html` showing that sphere's shadows, rendered in headless Chrome and placed over the Figma render.
