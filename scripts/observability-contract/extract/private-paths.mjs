// AMCore observability contract — finds citations of the private root `ai/`
// overlay (ai/STATUS.md, ai/models-talk.md, ai/decisions/..., etc.) across
// every git-tracked file, while correctly excluding the unrelated public
// `docs/ai/` capability-layer tree. See ai/models-talk.md's FINAL PLAN §1
// Tier 1 item 7 for the exact exclusion rules this implements.
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

/** Scans every git-tracked file (excluding the private `ai/` repo itself). */
export function scanRepoForPrivatePathCitations() {
  const files = listTrackedFiles().filter((f) => !f.startsWith('ai/'))
  const all = []
  for (const file of files) all.push(...findPrivatePathCitations(file))
  return all
}
