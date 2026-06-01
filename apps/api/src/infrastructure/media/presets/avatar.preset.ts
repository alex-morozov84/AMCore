import type { ImageDerivativeSpec, SourcePolicy } from '../media.types'

/**
 * Avatar derivative set. Square `cover` WebP at three densities (1x/2x/4x of a
 * 128px base). WebP only in the baseline; JPEG fallback and AVIF are deferred
 * (see ai/MEDIA_PROCESSING_PLAN.md). Names are semantic and bounded — clients
 * never pass arbitrary width/quality.
 */
export const AVATAR_DERIVATIVES: readonly ImageDerivativeSpec[] = [
  { name: 'avatar-128', width: 128, height: 128, fit: 'cover', format: 'webp', quality: 82 },
  { name: 'avatar-256', width: 256, height: 256, fit: 'cover', format: 'webp', quality: 82 },
  { name: 'avatar-512', width: 512, height: 512, fit: 'cover', format: 'webp', quality: 82 },
]

/**
 * Avatars accept still JPEG/PNG/WebP only. Animation is rejected outright (no
 * first-frame fallback) — an animated avatar is almost always a mistake, and
 * rejecting keeps the synchronous path bounded.
 */
export const AVATAR_SOURCE_POLICY: SourcePolicy = {
  allowedFormats: ['jpeg', 'png', 'webp'],
  allowAnimated: false,
}
