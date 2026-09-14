// Generated-tree fingerprinting with explicit normalization (BACKLOG item
// 14, PR1 §C). Two scenarios sharing a fingerprint are only ever reported as
// a *candidate* equivalence — nothing here deletes or skips a test on that
// basis; see `groupCandidateEquivalents`.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'

function trackedFiles(root) {
  return execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .sort()
}

function hashFile(root, relPath) {
  return createHash('sha256').update(readFileSync(path.join(root, relPath))).digest('hex')
}

// PROJECT_CONTEXT.md fields that record the actual scaffold choice made —
// these must stay visible in every fingerprint report even before any hash
// comparison, so two topologies that happen to hash the same are never
// treated as equivalent without a human/agent seeing *why* they might be.
const SIGNIFICANT_FIELDS = [
  'i18n_mode',
  'base_locale',
  'supported_locales',
  'frontend_storybook',
  'frontend_route_progress',
  'admin_console',
  'admin_console_mode',
  'admin_console_slug',
]

function significantValues(root) {
  let content
  try {
    content = readFileSync(path.join(root, 'PROJECT_CONTEXT.md'), 'utf8')
  } catch {
    return Object.fromEntries(SIGNIFICANT_FIELDS.map((field) => [field, null]))
  }
  return Object.fromEntries(
    SIGNIFICANT_FIELDS.map((field) => {
      const match = content.match(new RegExp(`- \\*\\*${field}:\\*\\* (.+)`))
      return [field, match ? match[1].trim() : null]
    })
  )
}

/**
 * Normalized fingerprint of a generated tree: every git-tracked file's
 * relative path + content hash, reduced to one `treeHash`, plus the explicit
 * significant field values a hash match must never silently gloss over.
 * `node_modules`/build output are excluded automatically — `git ls-files`
 * only lists tracked (never-gitignored) paths, the same property
 * `createRealRepoCopy()` already relies on.
 */
export function fingerprintTree(root) {
  const files = trackedFiles(root)
  const combined = files.map((relPath) => `${relPath}:${hashFile(root, relPath)}`).join('\n')
  return {
    treeHash: createHash('sha256').update(combined).digest('hex'),
    fileCount: files.length,
    significantValues: significantValues(root),
  }
}

/**
 * Groups `{ scenarioName, treeHash }` entries sharing one `treeHash`.
 * Publishable as candidate-equivalence evidence only (BACKLOG item 14: "PR1
 * may publish candidate equivalence groups, but not... delete or skip tests
 * on their basis").
 */
export function groupCandidateEquivalents(scenarioFingerprints) {
  const groups = new Map()
  for (const { scenarioName, treeHash } of scenarioFingerprints) {
    if (!groups.has(treeHash)) groups.set(treeHash, [])
    groups.get(treeHash).push(scenarioName)
  }
  return [...groups.values()].filter((group) => group.length > 1)
}
