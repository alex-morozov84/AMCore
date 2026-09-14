// Path normalization and ancestor/descendant relations for the desired-state
// path algebra (BACKLOG item 14, PR2/M1, FINAL PLAN §2.1). Pure, standalone —
// does not read the filesystem and is not wired into the existing engine.
export class InvalidPathError extends Error {
  constructor(rawPath, reason) {
    super(`invalid repository-relative path "${rawPath}": ${reason}`)
    this.rawPath = rawPath
    this.reason = reason
  }
}

/**
 * Normalizes a repository-relative path into a canonical, `/`-joined,
 * `.`/`..`-resolved form. Rejects an absolute path and any path that would
 * escape the repository root via `..` — both fail closed, never silently
 * clamped to root.
 */
export function normalizeRelativePath(rawPath) {
  if (typeof rawPath !== 'string' || rawPath.length === 0) {
    throw new InvalidPathError(rawPath, 'must be a non-empty string')
  }
  if (rawPath.startsWith('/') || rawPath.startsWith('\\') || /^[a-zA-Z]:[\\/]/.test(rawPath)) {
    throw new InvalidPathError(rawPath, 'must be repository-relative, not absolute')
  }
  const segments = rawPath.split(/[\\/]+/).filter((segment) => segment.length > 0 && segment !== '.')
  const resolved = []
  for (const segment of segments) {
    if (segment === '..') {
      if (resolved.length === 0) {
        throw new InvalidPathError(rawPath, 'escapes the repository root via ".."')
      }
      resolved.pop()
    } else {
      resolved.push(segment)
    }
  }
  if (resolved.length === 0) {
    throw new InvalidPathError(rawPath, 'resolves to the repository root itself')
  }
  return resolved.join('/')
}

/** Splits an already-normalized path into its component segments. */
export function segmentsOf(normalizedPath) {
  return normalizedPath.split('/')
}

/**
 * True when `ancestor` is a strict, component-wise ancestor directory of
 * `descendant` — e.g. `foo` is an ancestor of `foo/bar`, but `foo` is
 * **not** an ancestor of `foobar` (string-prefix matching would wrongly say
 * yes; component comparison says no).
 */
export function isAncestor(ancestor, descendant) {
  if (ancestor === descendant) return false
  const ancestorSegments = segmentsOf(ancestor)
  const descendantSegments = segmentsOf(descendant)
  if (ancestorSegments.length >= descendantSegments.length) return false
  return ancestorSegments.every((segment, index) => segment === descendantSegments[index])
}

/** True for identical paths or a true ancestor/descendant relationship, in either direction. */
export function isRelated(a, b) {
  return a === b || isAncestor(a, b) || isAncestor(b, a)
}
