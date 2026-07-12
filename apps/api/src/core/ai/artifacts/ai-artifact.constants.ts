import { AiArtifactKind } from '@prisma/client'

/**
 * AI artifact upload constants (Track C — ADR-054, Arc G). Only `IMAGE` (JPEG/PNG/WebP) and `PDF`
 * kinds are built this arc — these are the only two with a matching `AI_MODALITIES`/
 * `AI_CAPABILITIES` entry. GIF is deliberately excluded (animated-format/decompression-bomb
 * caution, matching the avatar pipeline's stance); SVG is excluded by omission (not on the
 * allowlist), consistent with every other image preset in this codebase.
 */

export const AI_ARTIFACT_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export const AI_ARTIFACT_PDF_MIME_TYPE = 'application/pdf'
export const AI_ARTIFACT_ALLOWED_MIME_TYPES: readonly string[] = [
  ...AI_ARTIFACT_IMAGE_MIME_TYPES,
  AI_ARTIFACT_PDF_MIME_TYPE,
]

/** Map a magic-byte-detected MIME type to its `AiArtifactKind`, or `null` if unsupported. */
export function detectAiArtifactKind(mime: string): AiArtifactKind | null {
  if ((AI_ARTIFACT_IMAGE_MIME_TYPES as readonly string[]).includes(mime))
    return AiArtifactKind.IMAGE
  if (mime === AI_ARTIFACT_PDF_MIME_TYPE) return AiArtifactKind.PDF
  return null
}

/**
 * Static Multer transport-layer ceiling for the upload route — a crude, kind-agnostic backstop
 * against memory exhaustion, sized above the largest possible `AI_ARTIFACT_MAX_DOCUMENT_BYTES`
 * (env-bounded max 32 MB) so the service's own kind-aware size check always gets a chance to
 * produce the clean, precise `FILE_TOO_LARGE` error — mirrors the avatar upload's
 * `AVATAR_UPLOAD_HARD_LIMIT_BYTES` headroom pattern (`auth.controller.ts`).
 */
export const AI_ARTIFACT_UPLOAD_HARD_LIMIT_BYTES = 40 * 1024 * 1024
