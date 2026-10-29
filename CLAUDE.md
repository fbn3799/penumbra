# penumbra

Figma plugin: layered object shadows driven by elevation, light distance/softness/direction, color, opacity and blend mode; re-editable via stored settings.

- The model lives in `src/shadow.ts` and is shared by plugin and UI preview. Keep it that way; never duplicate the math.
- `npm test` covers the model; the Figma side (`src/code.ts`) can only be verified inside Figma.
