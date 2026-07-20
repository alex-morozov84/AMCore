import { z } from 'zod'

// Media processing (image derivatives — see ai/MEDIA_PROCESSING_PLAN.md). Decode-
// safety limits applied before/around sharp. Source bytes are capped before
// download; decoded dimensions/pixels are validated after metadata.
// `MEDIA_SHARP_LIMIT_INPUT_PIXELS` is the hard libvips decode guard (defense-in-
// depth). The composed refinement enforces the per-preset caps ≤ the global cap.
export const mediaEnv = z.object({
  MEDIA_MAX_SOURCE_BYTES: z.coerce.number().int().min(1).default(5242880),
  MEDIA_MAX_WIDTH: z.coerce.number().int().min(1).default(8000),
  MEDIA_MAX_HEIGHT: z.coerce.number().int().min(1).default(8000),
  MEDIA_MAX_PIXELS: z.coerce.number().int().min(1).default(40000000),
  MEDIA_SHARP_LIMIT_INPUT_PIXELS: z.coerce.number().int().min(1).default(40000000),
  // Tighter pixel cap for the synchronous avatar path (F12): an avatar tops out at
  // 512 px, so 8 MP bounds per-decode memory/CPU under upload bursts.
  MEDIA_AVATAR_MAX_PIXELS: z.coerce.number().int().min(1).default(8000000),
  // Cache-control for public avatar derivatives. Keys are per-upload versioned, so
  // immutable long-lived caching is safe (no stale-on-overwrite).
  MEDIA_AVATAR_CACHE_CONTROL: z.string().min(1).default('public, max-age=31536000, immutable'),
})
