import { AiArtifactKind, AiRunStatus } from '@/generated/prisma/client'

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

/**
 * Coarse, provider-agnostic aggregate cap on one run's referenced-artifact **raw** bytes (FINAL
 * PLAN §6, "reject if the assembled request would push near the verified 32 MiB provider
 * envelope"). The 32 MiB ceiling is itself the **base64-encoded** request-body limit (Anthropic),
 * and base64 inflates raw bytes by 4/3 — so a raw-byte cap set to 32 MiB directly (as an earlier
 * draft of this constant did) would let up to ~42.7 MiB of encoded payload through, well past the
 * real ceiling. This value is the reverse conversion: `32 MiB * 3 / 4` = 24 MiB raw, which encodes
 * to ~32 MiB, leaving no headroom for the surrounding JSON/text/provider envelope overhead on top
 * of the artifact bytes themselves — a deliberately conservative, not precise, coarse guard.
 */
export const AI_ARTIFACT_MAX_TOTAL_RAW_BYTES_PER_MESSAGE = 25_165_824

/**
 * Owner-specified rebind matrix (FINAL PLAN §2 invariant 5), exhaustive over all 8 `AiRunStatus`
 * values. An artifact bound to one of these statuses is `409` on any further reference; `FAILED`/
 * `CANCELLED`/`EXPIRED` (and never-bound) allow rebinding to a new run.
 */
export const AI_ARTIFACT_REBIND_BLOCKED_STATUSES: ReadonlySet<AiRunStatus> = new Set([
  AiRunStatus.QUEUED,
  AiRunStatus.RUNNING,
  AiRunStatus.WAITING_APPROVAL,
  AiRunStatus.WAITING_HUMAN,
  AiRunStatus.COMPLETED,
])

/**
 * The model `capabilities` key an `AiArtifactKind` requires, or `null` for a kind this arc never
 * produces via upload (`FILE`/`GENERATED_IMAGE`/`TOOL_RESULT` stay laid-but-inert — a `null` result
 * is always a fail-closed rejection at the call site, never silently allowed).
 */
export function capabilityForArtifactKind(kind: AiArtifactKind): 'vision' | 'pdf' | null {
  if (kind === AiArtifactKind.IMAGE) return 'vision'
  if (kind === AiArtifactKind.PDF) return 'pdf'
  return null
}

/**
 * The `AI_MODALITIES` key an `AiArtifactKind` requires for the assistant `allowedModalities` gate.
 * Deliberately a separate mapping from {@link capabilityForArtifactKind}: `IMAGE` maps to the model
 * capability `vision` but the modality `image` — these are different vocabularies that happen to
 * coincide for `pdf`.
 */
export function modalityForArtifactKind(kind: AiArtifactKind): 'image' | 'pdf' | null {
  if (kind === AiArtifactKind.IMAGE) return 'image'
  if (kind === AiArtifactKind.PDF) return 'pdf'
  return null
}
