import { OWNERSHIP_CODES, ownershipError } from './ownership-errors.mjs'

const FACT_KINDS = new Set(['file', 'directory'])
const SEAM_KINDS = new Set(['owned-block', 'config-field', 'structural-operation'])
const CARDINALITIES = new Set(['one', 'one-or-more'])

function requireString(value, field) {
  if (typeof value === 'string' && value.length > 0) return
  throw ownershipError(OWNERSHIP_CODES.INVALID_MANIFEST, `${field} must be a non-empty string`)
}

function validatePattern(entry, field) {
  if (Boolean(entry.path) === Boolean(entry.glob)) {
    throw ownershipError(
      OWNERSHIP_CODES.INVALID_MANIFEST,
      `${field} needs exactly one path or glob`
    )
  }
  requireString(entry.path ?? entry.glob, field)
  if (!FACT_KINDS.has(entry.kind)) {
    throw ownershipError(OWNERSHIP_CODES.INVALID_MANIFEST, `${field} has invalid kind`)
  }
  if (!CARDINALITIES.has(entry.cardinality)) {
    throw ownershipError(OWNERSHIP_CODES.INVALID_MANIFEST, `${field} has invalid cardinality`)
  }
}

function validateSeam(seam) {
  requireString(seam.id, 'seam.id')
  validatePattern(seam, `seam ${seam.id}`)
  if (!SEAM_KINDS.has(seam.seamKind)) {
    throw ownershipError(OWNERSHIP_CODES.INVALID_MANIFEST, `seam ${seam.id} has invalid seamKind`)
  }
  if (!seam.detectors?.length) {
    throw ownershipError(OWNERSHIP_CODES.INVALID_MANIFEST, `seam ${seam.id} needs detectors`)
  }
  if (seam.seamKind === 'structural-operation') requireString(seam.operationKey, 'operationKey')
}

function validateFactGroups(manifest) {
  for (const root of manifest.facts.roots) {
    if (!root.path || root.kind !== 'directory') {
      throw ownershipError(OWNERSHIP_CODES.INVALID_MANIFEST, 'closed roots must be directories')
    }
  }
  const fileGroups = [
    'featureFiles',
    'sharedModules',
    'sharedModuleTests',
    'topology',
    'verification',
    'documentation',
    'featureEntrypoints',
    'repositoryEntrypoints',
  ]
  for (const field of fileGroups) {
    if (manifest.facts[field].some((fact) => fact.kind !== 'file')) {
      throw ownershipError(OWNERSHIP_CODES.INVALID_MANIFEST, `${field} must contain files`)
    }
  }
}

function validateSharedTestLinks(manifest) {
  const modules = new Set(manifest.facts.sharedModules.map((fact) => fact.path))
  const stale = manifest.facts.sharedModuleTests.filter((fact) => !modules.has(fact.module))
  if (stale.length) {
    throw ownershipError(OWNERSHIP_CODES.INVALID_MANIFEST, 'shared module test has no module fact')
  }
}

function validateUniqueIds(manifest) {
  const ids = manifest.seams.map((seam) => seam.id)
  if (new Set(ids).size !== ids.length) {
    throw ownershipError(OWNERSHIP_CODES.INVALID_MANIFEST, 'seam ids must be unique')
  }
}

function validateNoPrivateSurface(manifest) {
  const facts = Object.values(manifest.facts).flat()
  const paths = [...manifest.surfaceRoots, ...manifest.tsconfigs, ...facts, ...manifest.seams]
    .flatMap((entry) => (typeof entry === 'string' ? [entry] : [entry.path, entry.glob]))
    .filter(Boolean)
  if (paths.some((value) => value === 'ai' || value.startsWith('ai/'))) {
    throw ownershipError(OWNERSHIP_CODES.INVALID_MANIFEST, 'ai/ is not a downstream surface')
  }
}

/** Runtime-checked definition point; JSDoc-aware editors retain the literal shape. */
export function defineOwnershipManifest(manifest) {
  requireString(manifest.feature, 'feature')
  for (const [field, entries] of Object.entries(manifest.facts)) {
    for (const entry of entries) validatePattern(entry, `${field} entry`)
  }
  for (const seam of manifest.seams) validateSeam(seam)
  for (const id of manifest.monitoredIdentifiers) requireString(id, 'monitored identifier')
  validateUniqueIds(manifest)
  validateFactGroups(manifest)
  validateSharedTestLinks(manifest)
  validateNoPrivateSurface(manifest)
  return Object.freeze(manifest)
}
