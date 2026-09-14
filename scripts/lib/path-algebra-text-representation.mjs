// A dependency-free, text-based "in-memory representation" for structural
// adapters (BACKLOG item 14, PR2/M2, FINAL PLAN §2.2). M2's composition
// core (registry, dedup, semantic-write conflicts, ordering) is
// representation-agnostic; this module is one concrete, minimal choice for
// its required tests — a real AST/parser dependency is a separate,
// explicitly-approved decision this track does not make unilaterally (see
// the implementation report). Deliberately parallel in spirit to the
// existing engine's scripts/lib/content-blocks.mjs (exact-text, fail-closed
// on zero/multiple matches) but a fresh, independent implementation — M2
// does not import from the existing engine.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PathAlgebraConflictError, CONFLICT_CODES } from './path-algebra-errors.mjs'

function occurrences(text, block) {
  return text.split(block).length - 1
}

function assertSingleAnchor(text, block, path, operationKey) {
  const count = occurrences(text, block)
  if (count === 1) return
  const code = count === 0 ? CONFLICT_CODES.MISSING_ANCHOR : CONFLICT_CODES.AMBIGUOUS_ANCHOR
  throw new PathAlgebraConflictError(code, {
    paths: [path],
    dimensions: [],
    detail: `operationKey "${operationKey}" expected exactly one occurrence of its anchor in "${path}", found ${count}`,
  })
}

/** Removes exactly one occurrence of `block`; fails closed on zero or multiple matches. */
export function removeTextBlock(text, block, { path, operationKey }) {
  assertSingleAnchor(text, block, path, operationKey)
  return text.replace(block, '')
}

/** Replaces exactly one occurrence of `before` with `after`; fails closed on zero or multiple matches. */
export function replaceTextBlock(text, before, after, { path, operationKey }) {
  assertSingleAnchor(text, before, path, operationKey)
  return text.replace(before, after)
}

/**
 * Validates that `text` still parses as JavaScript/ESM, via the already-
 * available `node --check` (no new parser dependency). An adapter that edits
 * JS/ESM text should call this on its own output; a resulting
 * `INVALID_OUTPUT_PARSE` throw propagates out of `applyStructuralPlan`
 * before the caller ever writes the representation to disk.
 */
export function assertParsesAsJavaScript(text, { path, operationKey }) {
  const dir = mkdtempSync(join(tmpdir(), 'path-algebra-parse-'))
  try {
    const file = join(dir, 'check.mjs')
    writeFileSync(file, text)
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' })
  } catch (error) {
    throw new PathAlgebraConflictError(CONFLICT_CODES.INVALID_OUTPUT_PARSE, {
      paths: [path],
      dimensions: [],
      detail: `operationKey "${operationKey}" produced output that fails to parse as JavaScript: ${String(error.message).split('\n')[0]}`,
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
