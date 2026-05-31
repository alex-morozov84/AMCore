import type { FileValidationOptions } from './file-validation.pipe'

/**
 * Reusable validation presets. SVG is intentionally absent from every image
 * preset (Decision D): `file-type` cannot reliably detect it via magic bytes,
 * and inline SVG is a stored-XSS vector. Forks that must accept SVG should serve
 * it `attachment`-only.
 */

export const IMAGE_VALIDATION: FileValidationOptions = {
  maxSize: 5 * 1024 * 1024,
  allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  contentDisposition: 'inline',
}

export const AVATAR_VALIDATION: FileValidationOptions = {
  maxSize: 2 * 1024 * 1024,
  allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
  contentDisposition: 'inline',
}

export const DOCUMENT_VALIDATION: FileValidationOptions = {
  maxSize: 10 * 1024 * 1024,
  allowedMimeTypes: ['application/pdf', 'image/jpeg', 'image/png'],
  // User documents are served as a download, never rendered inline.
  contentDisposition: 'attachment',
}
