// Shared assertion helper for the path-algebra test files (BACKLOG item 14,
// PR2/M1) — not a `.test.mjs` file itself, so it is never picked up by the
// `node --test` glob and never runs as its own (empty) test suite.
import { PathAlgebraConflictError } from './path-algebra-errors.mjs'

/** For `assert.throws(fn, conflict(CODE))` — matches a specific conflict code, not just "some error". */
export function conflict(code) {
  return (error) => error instanceof PathAlgebraConflictError && error.code === code
}
