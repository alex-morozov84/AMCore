// AMCore observability contract — extracts the structured
// `**"Title"** ... panel (X row)` dashboard-panel citation idiom runbooks
// use. Split from runbook.mjs (generic Markdown extraction) to keep both
// files under the repo's <150-line limit.
import { readFileSync } from 'node:fs'

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
 * Groups lines into "units" (a list item plus its wrapped continuation
 * lines, or a bare paragraph), each `{ startLine, text }` — a citation
 * spanning a soft line-wrap, or a row clause shared by two titles in the
 * same sentence, must be read together as one unit.
 */
function groupIntoUnits(lines) {
  const units = []
  let lineNo = 0
  let unitStartLine = 0
  let unitLines = []
  const flush = () => {
    if (unitLines.length > 0) units.push({ startLine: unitStartLine, text: unitLines.join('\n') })
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
  return units
}

/**
 * Structured dashboard-panel citations: `**"Title"**` names that appear in
 * the same list-item/paragraph unit as the word "panel", resolved to their
 * stated row (or `row: null` when the unit never states one for that title).
 */
export function extractPanelCitations(markdownPath) {
  const text = readFileSync(markdownPath, 'utf8')
  const units = groupIntoUnits(text.split('\n'))
  return units.flatMap((unit) =>
    resolveUnitCitations(unit.text).map((c) => ({ ...c, file: markdownPath, line: unit.startLine }))
  )
}
