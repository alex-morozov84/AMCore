// The shared per-file structural model for structural adapters (BACKLOG
// item 14, PR2/M2, FINAL PLAN §2.2), built on the already-installed
// TypeScript Compiler API — no new dependency. The orchestrator parses the
// initial source exactly once; every adapter for that file then locates
// nodes on the same tree and records range edits against the original
// text; the orchestrator serializes once, rejecting overlapping edits and
// syntactically invalid output. Adapters never re-parse, never see a
// string, and never need to remember to validate anything.
import ts from 'typescript'
import { PathAlgebraConflictError, CONFLICT_CODES } from './path-algebra-errors.mjs'
import { parseChecked } from './path-algebra-ast-parse.mjs'

/**
 * Where a node's removal starts (`triviaStart`) and where its own content —
 * first attached comment or the node — begins (`contentStart`). Leading
 * comments go with the node unless a blank line separates them from what
 * follows: such a comment is detached (a section banner, an unrelated
 * note) and stays.
 */
function leadingTrivia(text, node) {
  const fullStart = node.getFullStart()
  const comments = ts.getLeadingCommentRanges(text, fullStart) ?? []
  let triviaStart = fullStart
  let contentStart = comments[0]?.pos ?? node.getStart()
  comments.forEach((comment, index) => {
    const nextStart = comments[index + 1]?.pos ?? node.getStart()
    if (!/\n[ \t]*\n/.test(text.slice(comment.end, nextStart))) return
    triviaStart = comment.end
    contentStart = nextStart
  })
  return { triviaStart, contentStart }
}

/**
 * A statement owns its lines: from the start of its first attached line
 * through its own line break. When a blank line sat on both sides, one goes
 * too, so the neighbours are not left doubly separated.
 */
function statementRange(text, node, { triviaStart, contentStart }) {
  const start = triviaStart + text.slice(triviaStart, contentStart).lastIndexOf('\n') + 1
  let end = node.end + /^[ \t]*(\r?\n)?/.exec(text.slice(node.end))[0].length
  const blankAfter = /^[ \t]*\r?\n/.exec(text.slice(end))
  if (blankAfter && /(^|\n)[ \t]*\n$/.test(text.slice(0, start))) end += blankAfter[0].length
  return { start, end }
}

/**
 * The text a node's removal takes. A list element takes its separating
 * comma — the one after it when present, else (a last element with no
 * trailing comma) the one before; a first element on one line also takes
 * the space after its comma. Anything without a comma is a statement.
 */
function removalRange(text, node) {
  const trivia = leadingTrivia(text, node)
  const start = trivia.triviaStart
  const trailing = /^\s*,/.exec(text.slice(node.end))
  if (trailing) {
    const end = node.end + trailing[0].length
    const gap = start === node.getStart() ? /^[ \t]*/.exec(text.slice(end))[0].length : 0
    return { start, end: end + gap }
  }
  const leading = /,\s*$/.exec(text.slice(0, start))
  return leading ? { start: leading.index, end: node.end } : statementRange(text, node, trivia)
}

/**
 * Two edits may share whitespace or a list separator (adjacent removals
 * both take the comma between them) but never a token: any other overlap
 * is two operations claiming the same node, and fails closed.
 */
function clipTriviaOverlaps(path, text, sorted) {
  const clipped = []
  for (const edit of sorted) {
    const previous = clipped.at(-1)
    if (!previous || edit.start >= previous.end) {
      clipped.push(edit)
      continue
    }
    if (/[^\s,]/.test(text.slice(edit.start, Math.min(edit.end, previous.end)))) {
      throw new PathAlgebraConflictError(CONFLICT_CODES.OVERLAPPING_STRUCTURAL_EDITS, {
        paths: [path],
        dimensions: [],
        detail: `edits by "${previous.operationKey}" and "${edit.operationKey}" overlap in "${path}"`,
      })
    }
    clipped.push({ ...edit, start: previous.end })
  }
  return clipped
}

/**
 * Parses `text` once (fails closed with `INVALID_INPUT_PARSE`) and returns
 * the model adapters share. `removeNode` / `replaceNode` record edits tagged
 * with the calling operation; `isRemoved` lets a dependent operation see an
 * earlier operation's removal without anyone re-parsing.
 */
export function parseStructuralModel(path, text) {
  const sourceFile = parseChecked(path, text, CONFLICT_CODES.INVALID_INPUT_PARSE)
  const edits = []
  // Returns nothing on purpose: an adapter written as an arrow expression
  // must not accidentally hand a value back to the orchestrator.
  const record = (edit) => {
    edits.push(edit)
  }
  return {
    path,
    text,
    sourceFile,
    edits,
    removeNode: (node, { operationKey }) =>
      record({ ...removalRange(text, node), replacement: '', operationKey }),
    replaceNode: (node, replacement, { operationKey }) =>
      record({ start: node.getStart(), end: node.end, replacement, operationKey }),
    isRemoved: (node) =>
      edits.some(
        (edit) => edit.replacement === '' && edit.start <= node.getStart() && node.end <= edit.end
      ),
  }
}

/**
 * Applies every recorded edit to the original text in one pass and returns
 * the serialized file. Edits claiming the same token
 * (`OVERLAPPING_STRUCTURAL_EDITS`) and output that no longer parses
 * (`INVALID_OUTPUT_PARSE`) fail closed here — the one place that owns the
 * representation contract.
 */
export function serializeStructuralModel(model) {
  const sorted = [...model.edits].sort((a, b) => a.start - b.start || a.end - b.end)
  const edits = clipTriviaOverlaps(model.path, model.text, sorted)
  let output = model.text
  for (const edit of edits.reverse()) {
    output = output.slice(0, edit.start) + edit.replacement + output.slice(edit.end)
  }
  parseChecked(model.path, output, CONFLICT_CODES.INVALID_OUTPUT_PARSE)
  return output
}
