// A small unified-diff renderer for --dry-run's review surface (FINAL PLAN,
// Safety model: "--dry-run prints the plan and unified diffs"). No new
// dependency — a line-level LCS plus standard `diff -u`-style hunk
// collapsing (N lines of context around each change, not the whole file)
// is plenty for the config/manifest-sized files this tool edits, and
// matters in practice: an early version printed one hunk per whole file,
// which turned a 3-line change to a 99-line file into ~30KB of noise.

function longestCommonSubsequenceTable(a, b) {
  const table = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i][j] =
        a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1])
    }
  }
  return table
}

function diffLines(aLines, bLines) {
  const table = longestCommonSubsequenceTable(aLines, bLines)
  const ops = []
  let i = 0
  let j = 0
  while (i < aLines.length && j < bLines.length) {
    if (aLines[i] === bLines[j]) {
      ops.push({ type: 'context', line: aLines[i] })
      i += 1
      j += 1
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      ops.push({ type: 'remove', line: aLines[i] })
      i += 1
    } else {
      ops.push({ type: 'add', line: bLines[j] })
      j += 1
    }
  }
  while (i < aLines.length) {
    ops.push({ type: 'remove', line: aLines[i] })
    i += 1
  }
  while (j < bLines.length) {
    ops.push({ type: 'add', line: bLines[j] })
    j += 1
  }
  return ops
}

/** Tags every op with the 1-based old/new line position it occupies (or would occupy, for an add/remove). */
function annotateLineNumbers(ops) {
  let oldLine = 1
  let newLine = 1
  return ops.map((op) => {
    const annotated = { ...op, oldLineAtStart: oldLine, newLineAtStart: newLine }
    if (op.type !== 'add') oldLine += 1
    if (op.type !== 'remove') newLine += 1
    return annotated
  })
}

/** Groups changes that are within `2*contextLines` of each other into the same hunk, standard `diff -u` style. */
function groupIntoHunkRanges(ops, contextLines) {
  const changeIndices = ops.flatMap((op, i) => (op.type === 'context' ? [] : [i]))
  if (changeIndices.length === 0) return []

  const ranges = []
  let start = changeIndices[0]
  let end = changeIndices[0]
  for (const index of changeIndices.slice(1)) {
    if (index - end <= contextLines * 2) {
      end = index
    } else {
      ranges.push([start, end])
      start = index
      end = index
    }
  }
  ranges.push([start, end])

  return ranges.map(([first, last]) => [
    Math.max(0, first - contextLines),
    Math.min(ops.length - 1, last + contextLines),
  ])
}

function renderHunk(ops, from, to) {
  const slice = ops.slice(from, to + 1)
  const oldCount = slice.filter((op) => op.type !== 'add').length
  const newCount = slice.filter((op) => op.type !== 'remove').length
  const prefix = { context: ' ', remove: '-', add: '+' }
  const header = `@@ -${slice[0].oldLineAtStart},${oldCount} +${slice[0].newLineAtStart},${newCount} @@`
  const body = slice.map((op) => `${prefix[op.type]}${op.line}`)
  return [header, ...body]
}

/** Renders a unified diff of `before`/`after`; `''` when they're identical. */
export function unifiedDiff(
  before,
  after,
  { fromLabel = 'before', toLabel = 'after', contextLines = 3 } = {}
) {
  if (before === after) return ''

  const ops = annotateLineNumbers(diffLines(before.split('\n'), after.split('\n')))
  const hunks = groupIntoHunkRanges(ops, contextLines)
  const hunkLines = hunks.flatMap(([from, to]) => renderHunk(ops, from, to))

  return [`--- ${fromLabel}`, `+++ ${toLabel}`, ...hunkLines].join('\n')
}
