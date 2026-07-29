# PWA Icons

- `icon-192x192.png` — 192×192, referenced in `manifest.ts`.
- `icon-512x512.png` — 512×512, referenced in `manifest.ts`.
- `icon-512x512-maskable.png` — 512×512, `purpose: 'maskable'` — extra
  padding so OS launchers can safely crop it to a circle/squircle without
  clipping the logo (the maskable-icon "safe zone").

The current set is the AM monogram (`../logo-light.png`) centered on a solid
`#fafafa` background (matches `globals.css`'s light-mode `--background`),
generated deterministically with `sharp` — no AI image generation.

## Regenerating (e.g. after a downstream rebrand)

Composite your own square-cropped logo onto a solid background at the sizes
above, keeping maskable content within roughly the inner 80% of the canvas.
Any deterministic tool works: `sharp`, ImageMagick, or a manual export from a
design tool. See `docs/frontend/brand-theme-and-tokens.md`'s rebrand
checklist.
