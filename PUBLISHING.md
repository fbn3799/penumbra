# Publishing to Figma Community

**For Fabian: open [publish.html](publish.html)**, the same content with a copy button on every value. This file is the agent-facing version; when a value changes, change it in both.

Figma only accepts submissions from the **desktop app**, from an account with two-factor authentication on (Fabian's account has it; Flow to Lottie and Copy Paste Overrides went out from it). Review takes a few days and the answer comes by email.

## 1. Run it once in Figma desktop

Review rejects plugins that crash or show developer errors, and the panel has only run in a browser harness so far. So before publishing:

```bash
npm install
npm run build
```

**Plugins → Development → Import plugin from manifest…** → `manifest.json`. The manifest carries the id Figma issued (`1697766878329271677`, since 2026-10-29), so the imported plugin and the published listing are the same.

Then, on a scratch file:

- [ ] Select a rectangle, open Penumbra, **Add shadow**. The shadow appears and the panel shows its settings.
- [ ] Drag Elevation, Distance and Softness sideways. The layer follows live; one ⌘Z undoes one drag.
- [ ] Turn **Merge** on. The layer is grouped with a locked "Shadow" layer; turn it off and the group goes away.
- [ ] Set Count to 12 with Merge off. A "More shadows" layer appears; back to 8 and it goes.
- [ ] Add a second shadow with **+**, then remove it with **−**.
- [ ] Deselect, close the plugin, select the layer again: the sidebar shows **Edit shadow**, and it reopens with the same settings.
- [ ] Select a layer inside an instance and add a shadow. The panel says why it can't merge, Figma notes that the settings can't be stored there, and nothing errors.
- [ ] The window fits its content without scrolling (one shadow ≈ 625 px tall).

## 2. Publish

Figma desktop → **Plugins → Manage plugins…** (or Development → Manage plugins in development) → Penumbra → **Publish**. Fill in:

| Field | Value |
|---|---|
| Name | Penumbra – Realistic, Layered Drop Shadows |
| Tagline | Smooth, soft and long shadows with real elevation and color fade, editable anytime. |
| Description | below |
| Category | Design tools (closest subcategory on offer) |
| Icon | `assets/icon.png` (128 × 128) |
| Thumbnail | `assets/cover.png` (1920 × 1080) |
| Carousel | `assets/carousel-1-panel.png`, `-2-elevation`, `-3-color`, `-4-stack`, in that order |
| Support contact | info@fabianschneider.net |
| Network access | shows "No access to network" (from the manifest) |
| Comments | allowed |
| Price | Free |
| Publisher | Fabian Schneider |
| Version notes | First release. |

Tags, in this order (Figma's tutorial allows twelve, a help mirror says five, so the first five carry the weight): `shadow`, `drop shadow`, `realistic shadow`, `smooth shadow`, `layered shadow`, `soft shadow`, `long shadow`, `elevation`, `box shadow`, `depth`, `effects`, `light`.

### Being found for "shadow"

Community search ranks on the **name** first and reads the **tagline** too. Checked on 2026-10-29: every top plugin for "shadow" has the word in its name, and plugins with a few hundred users rank on the strength of their tagline alone ("Shadow Pro" is second for "realistic shadow" because its tagline says "realistic"). Plain "Penumbra" would match nothing, hence the name and tagline above:

- the name carries **shadows**, **drop shadows**, **realistic** and **layered**;
- the tagline carries **smooth**, **soft**, **long**, **elevation** and **color**;
- the description's first lines repeat them in sentences, and the tags cover the rest.

`manifest.json` has the same name, so the publish form starts with it. Keep both if you rename. After publishing, search "shadow" filtered to Plugins and sorted by Recent to see it listed; relevance rank grows with users and likes.

### Description

```
Realistic drop shadows for Figma, built the way light makes them: a stack of soft copies that grows wider and fainter with distance. Smooth, soft, long or colored, on cards, buttons, icons and images. And every shadow stays editable. Select the layer again, or click "Edit shadow" in the sidebar, and every setting comes back.

• Light: elevation (the gap before the shadow starts), distance, softness and direction.
• Start and end: the color and opacity next to the object and at the far end. Penumbra solves each copy's alpha so the overlaps add up to what you set.
• Copies: one for a single solid shadow, up to twelve for a smooth one, with exponential spacing.
• Several shadows per layer: a tight contact shadow, a long key shadow and a soft ambient fill, each with its own settings.
• Merge: draws a shadow on its own locked layer, grouped with the object, so it has one opacity, any blend mode and no visible overlaps. Works on photos and any shape.
• Past Figma's limit: Figma keeps 8 drop shadows per layer. Penumbra puts the rest on a grouped layer instead of dropping them.
• Every number is a field: drag it sideways (Shift snaps), click to type, or use the arrow keys. Changes apply live, one undo step per drag.
• Several layers at once: an edit changes only the setting you touched.

Layers inside instances, variants and auto layout fill layers can't be grouped, so they keep their shadows as effects.

Penumbra only changes the layers you select. It has no network access; settings are stored on the layers, and your last shadow on your device.

Open source (MIT): https://github.com/fbn3799/penumbra
```

### Data security form

Optional, but Flow to Lottie has one, and the facts are short:

- **Network:** none. `networkAccess.allowedDomains` is `["none"]`; the plugin makes no requests.
- **Data collected or sent:** none. No accounts, analytics, tracking or third parties.
- **Data stored:** each shadow's settings in shared plugin data on its layer (inside the file, namespace `penumbra`), and the last-used shadow in `figma.clientStorage` (local to the device).
- **What it changes:** only the selected layers' drop shadows, and the shadow layers it groups with them.

## 3. After it's live

- Check the listing's id (in its Community URL) matches `manifest.json`, so later releases update the same listing.
- Add the Community link to the top of the README.
- Tag the release: `git tag v0.3.0 && git push --tags`.

Updates: bump `version` in `package.json`, `npm run build`, then **Manage plugins → Penumbra → Publish new version** with a line of version notes.

## The images

`assets/` holds the listing images. They're made in Figma with Penumbra's own code (`src/nodes.ts` run through the Figma MCP, like `npm run figma-check`), on the page "Community assets" of the scratch file "Penumbra plugin check (scratch)" in Fabian's drafts. The panel on the first carousel slide is the real `dist/ui.html`, rendered in headless Chrome and placed over the Figma render.
