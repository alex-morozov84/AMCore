// AMCore observability contract — finds citations of the private root
// maintainer-overlay directory (any markdown-shaped file directly under it,
// plus its archive/backlog/decisions subtrees) across every git-tracked
// file, while correctly excluding the unrelated public capability-layer
// docs tree that happens to share the same directory name one level down.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const PRIVATE_PATTERN =
  /ai\/(?:[A-Za-z0-9_.-]+\.md|(?:archive|backlog|decisions)\/[A-Za-z0-9_.-]*)/g

export function listTrackedFiles() {
  const out = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
  return out.split('\n').filter(Boolean)
}

const LINK_PATTERN = /]\(([^)]+)\)/g

/** `[start, end)` character spans of every Markdown link target in `text`. */
function linkTargetSpans(text) {
  const spans = []
  let m
  LINK_PATTERN.lastIndex = 0
  while ((m = LINK_PATTERN.exec(text))) {
    const start = m.index + 2 // skip "]("
    spans.push({ start, end: start + m[1].length, target: m[1] })
  }
  return spans
}

/** True when a citation resolves to the public `docs/ai/**` tree, not the private root. */
function resolvesToPublicDocsAi(fileText, matchIndex, matchText, filePath, spans) {
  if (fileText.slice(Math.max(0, matchIndex - 5), matchIndex).endsWith('docs/')) {
    return true // literal "docs/ai/..." substring, not a link
  }
  const span = spans.find((s) => matchIndex >= s.start && matchIndex < s.end)
  if (!span) return false // plain text (not inside any link target) — always private root
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(filePath), span.target))
  return resolved.startsWith('docs/ai/')
}

/** `{ file, target, line }` for every real private-root citation in one file. */
export function findPrivatePathCitations(filePath) {
  let text
  try {
    text = readFileSync(filePath, 'utf8')
  } catch {
    return [] // binary or unreadable — never a text citation
  }
  const spans = linkTargetSpans(text)
  const hits = []
  let match
  PRIVATE_PATTERN.lastIndex = 0
  while ((match = PRIVATE_PATTERN.exec(text))) {
    if (resolvesToPublicDocsAi(text, match.index, match[0], filePath, spans)) continue
    const line = text.slice(0, match.index).split('\n').length
    hits.push({ file: filePath, target: match[0], line })
  }
  return hits
}

const UNAVOIDABLE_DATA_FILES = new Set([
  'scripts/observability-contract/private-path-baseline.json',
])

/** True for a path this tool cannot avoid filling with real citation strings as data. */
function isUnavoidableDataFile(file) {
  return (
    UNAVOIDABLE_DATA_FILES.has(file) ||
    (file.startsWith('scripts/observability-contract/') && file.endsWith('.test.mjs'))
  )
}

/**
 * Scans every git-tracked file, excluding the private `ai/` repo itself and
 * only the specific files this tool cannot avoid filling with real citation
 * strings as data (the baseline JSON's own tracked entries; `.test.mjs`
 * fixtures across the whole repo, not only this tool's own). Every other
 * file — including this tool's own non-test source — is scanned normally;
 * a real citation slipping into a source comment here is exactly the kind
 * of regression this guard exists to catch, including in itself.
 */
export function scanRepoForPrivatePathCitations() {
  const files = listTrackedFiles().filter((f) => !f.startsWith('ai/') && !isUnavoidableDataFile(f))
  const all = []
  for (const file of files) all.push(...findPrivatePathCitations(file))
  return all
}
