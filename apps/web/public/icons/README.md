# PWA icons

`apps/web/src/app/manifest.ts` references three PNG files:

| File | Size | Purpose |
| --- | --- | --- |
| `icon-192x192.png` | 192 × 192 | General |
| `icon-512x512.png` | 512 × 512 | General |
| `icon-512x512-maskable.png` | 512 × 512 | Maskable |

Extend the solid background to the edges of the maskable icon. Keep
important artwork inside a central circle with a diameter of 80% of the
icon's side length so launcher cropping preserves it.
Follow the [downstream rebrand checklist](../../../../docs/frontend/brand-theme-and-tokens.md#downstream-rebrand-checklist)
for validation, copying and manifest colors.
