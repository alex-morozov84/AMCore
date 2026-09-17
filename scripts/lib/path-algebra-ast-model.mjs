// The shared per-file structural model for structural adapters (BACKLOG
// item 14, PR2/M2, FINAL PLAN §2.2), built on the already-installed
// TypeScript Compiler API — no new dependency. The orchestrator parses the
// initial source exactly once; every adapter for that file then locates
// nodes on the same tree and records range edits against the original
// text; the orchestrator serializes once, rejecting overlapping edits and
// syntactically invalid output. Adapters never re-parse, never see a
// string, and never need to remember to validate anything.
import { PathAlgebraConflictError, CONFLICT_CODES } from './path-algebra-errors.mjs'
import { parseChecked } from './path-algebra-ast-parse.mjs'
import { removalRange, replacementStart } from './path-algebra-ast-ranges.mjs'

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

function dedupeIdenticalEdits(sorted) {
  return sorted.filter((edit, index) => {
    const previous = sorted[index - 1]
    return !(
      previous &&
      edit.start === previous.start &&
      edit.end === previous.end &&
      edit.replacement === previous.replacement
    )
  })
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
    removeNode: (
      node,
      { operationKey, includeLeadingBlank = false, includeTrailingBlank = false }
    ) =>
      record({
        ...removalRange(text, node, { includeLeadingBlank, includeTrailingBlank }),
        replacement: '',
        operationKey,
      }),
    replaceNode: (node, replacement, { operationKey, includeLeadingComments = false }) => {
      const start = replacementStart(text, node, includeLeadingComments)
      record({ start, end: node.end, replacement, operationKey })
    },
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
  const edits = clipTriviaOverlaps(model.path, model.text, dedupeIdenticalEdits(sorted))
  let output = model.text
  for (const edit of edits.reverse()) {
    output = output.slice(0, edit.start) + edit.replacement + output.slice(edit.end)
  }
  parseChecked(model.path, output, CONFLICT_CODES.INVALID_OUTPUT_PARSE)
  return output
}
