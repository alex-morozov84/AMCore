export class OwnershipError extends Error {
  constructor(code, detail, paths = []) {
    super(`${code}: ${detail}`)
    this.name = 'OwnershipError'
    this.code = code
    this.paths = [...new Set(paths)].sort()
  }
}

export const OWNERSHIP_CODES = Object.freeze({
  INVALID_MANIFEST: 'invalid-manifest',
  STALE_ENTRY: 'stale-manifest-entry',
  KIND_MISMATCH: 'manifest-kind-mismatch',
  CARDINALITY: 'manifest-cardinality-mismatch',
  OUTSIDE_ROOT: 'whole-feature-file-outside-root',
  MISSING_SEAM: 'missing-declared-seam',
  DYNAMIC_REFERENCE: 'unresolved-dynamic-reference',
  RESIDUAL: 'projection-residual',
})

export function ownershipError(code, detail, paths = []) {
  return new OwnershipError(code, detail, paths)
}
