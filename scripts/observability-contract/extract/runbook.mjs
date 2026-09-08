// AMCore observability contract — Markdown extraction: fenced PromQL blocks,
// relative links, headings (for anchor slugs), and the structured
// `**"Title"** ... panel (X row)` dashboard-panel citation idiom runbooks use.
import { readFileSync } from 'node:fs'

/** Every fenced code block (any or no language tag), with its tag and body. */
export function extractAllFences(markdownPath) {
  const text = readFileSync(markdownPath, 'utf8')
  const lines = text.split('\n')
  const fences = []
  for (let i = 0; i < lines.length; i++) {
    const open = /^```(\S*)\s*$/.exec(lines[i].trim())
    if (open) {
      const tag = open[1]
      const start = i + 2 // first content line, 1-based
      const body = []
      let j = i + 1
      while (j < lines.length && lines[j].trim() !== '```') {
        body.push(lines[j])
        j++
      }
      fences.push({ tag, body: body.join('\n'), file: markdownPath, line: start })
      i = j
    }
  }
  return fences
}

/** Fenced ```promql blocks, each with its 1-based starting line number. */
export function extractPromqlFences(markdownPath) {
  return extractAllFences(markdownPath)
    .filter((f) => f.tag === 'promql')
    .map((f) => ({ expr: f.body, file: f.file, line: f.line }))
}

/** GitHub-style heading slug (lowercase, spaces/punctuation -> hyphens). */
export function slugify(headingText) {
  return headingText
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
}

/** `{ text, slug, line }` for every `#`..`######` Markdown heading. */
export function extractHeadings(markdownPath) {
  const text = readFileSync(markdownPath, 'utf8')
  const lines = text.split('\n')
  const headings = []
  lines.forEach((line, i) => {
    const match = /^#{1,6}\s+(.+)$/.exec(line)
    if (match) headings.push({ text: match[1].trim(), slug: slugify(match[1]), line: i + 1 })
  })
  return headings
}

/** Relative (non-`http`) Markdown link targets: `[text](target)`. */
export function extractRelativeLinks(markdownPath) {
  const text = readFileSync(markdownPath, 'utf8')
  const lines = text.split('\n')
  const links = []
  const linkPattern = /\[[^\]]*]\(([^)]+)\)/g
  lines.forEach((line, i) => {
    let match
    while ((match = linkPattern.exec(line))) {
      const target = match[1]
      if (!/^https?:\/\//.test(target)) links.push({ target, file: markdownPath, line: i + 1 })
    }
  })
  return links
}

const norm = (s) => s.replace(/\s+/g, ' ').trim()

/**
 * Resolves each `**"Title"**` in one unit of text to the row named in the
 * text segment immediately following it, up to the next title (or the end
 * of the unit). A title with no row of its own inherits the *next* title's
 * row only when the two are joined by a bare "and" (the "X and Y panels (Row
 * row)" shared-citation shape) — never across an unrelated intervening
 * sentence.
 */
function resolveUnitCitations(unitText) {
  if (!/\bpanels?\b/.test(unitText)) return []
  const titleRe = /\*\*"([^"]+)"\*\*/g
  const matches = [...unitText.matchAll(titleRe)]
  if (matches.length === 0) return []

  const rows = matches.map((m, i) => {
    const segStart = m.index + m[0].length
    const segEnd = matches[i + 1] ? matches[i + 1].index : unitText.length
    const segment = unitText.slice(segStart, segEnd)
    const rowMatch = /\(([^()]+?)\s+row\b/.exec(segment)
    return { title: norm(m[1]), segmentToNext: segment, row: rowMatch ? norm(rowMatch[1]) : null }
  })

  for (let i = rows.length - 2; i >= 0; i--) {
    const bareJoinerBetween = /^\s*(and|\/|,)\s*$/.test(rows[i].segmentToNext)
    if (rows[i].row === null && bareJoinerBetween && rows[i + 1].row !== null) {
      rows[i].row = rows[i + 1].row
    }
  }
  return rows.map(({ title, row }) => ({ panel: title, row }))
}

/**
 * Structured dashboard-panel citations: `**"Title"**` names that appear in
 * the same list-item/paragraph unit as the word "panel", resolved to their
 * stated row (or `row: null` when the unit never states one for that title).
 */
export function extractPanelCitations(markdownPath) {
  const text = readFileSync(markdownPath, 'utf8')
  const lines = text.split('\n')
  const citations = []
  let lineNo = 0
  let unitStartLine = 0
  let unitLines = []
  const flush = () => {
    if (unitLines.length === 0) return
    for (const c of resolveUnitCitations(unitLines.join('\n'))) {
      citations.push({ ...c, file: markdownPath, line: unitStartLine })
    }
    unitLines = []
  }

  for (const raw of lines) {
    lineNo += 1
    const isNewItem = /^\s*(\d+\.|-)\s/.test(raw)
    if (raw.trim() === '') {
      flush()
      continue
    }
    if (isNewItem || unitLines.length === 0) {
      flush()
      unitStartLine = lineNo
      unitLines = [raw]
    } else {
      unitLines.push(raw)
    }
  }
  flush()

  return citations
}
