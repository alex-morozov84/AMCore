// Shared assertion helpers for the path-algebra test files (BACKLOG item 14,
// PR2/M1–M2) — not a `.test.mjs` file itself, so it is never picked up by the
// `node --test` glob and never runs as its own (empty) test suite.
import { PathAlgebraConflictError } from './path-algebra-errors.mjs'
import { parseStructuralModel } from './path-algebra-ast-model.mjs'
import { findAllNodes, findUniqueNode, isImportOf } from './path-algebra-ast-query.mjs'
import {
  planStructuralComposition,
  applyStructuralPlan,
} from './path-algebra-structural-compose.mjs'

/** For `assert.throws(fn, conflict(CODE))` — matches a specific conflict code, not just "some error". */
export function conflict(code) {
  return (error) => error instanceof PathAlgebraConflictError && error.code === code
}

/** A registry definition that is well-formed but does nothing — for tests of the planning layers. */
export function stubDefinition(overrides = {}) {
  return {
    paramsSchema: () => true,
    deriveSemanticWrites: () => [{ location: 'x', value: 1 }],
    adapter: () => {},
    ...overrides,
  }
}

/** How many nodes of a semantic shape a serialized result contains — assertions on structure, not on text. */
export function countNodes(path, text, predicate) {
  return findAllNodes(parseStructuralModel(path, text), predicate).length
}

/** A synthetic three-statement module the orchestrator tests edit. */
export const SYNTHETIC_PATH = 'apps/web/example.mjs'
export const SYNTHETIC_SOURCE =
  "import a from 'a';\nimport b from 'b';\nexport default ['x', 'y'];\n"

export const syntheticFact = (operationKey, dimension = 'd') => ({
  dimension,
  path: SYNTHETIC_PATH,
  operationKey,
  params: {},
})

/** A real structural definition: removes the one `import ... from '<specifier>'` statement. */
export function removeImportDefinition(specifier) {
  return stubDefinition({
    deriveSemanticWrites: () => [{ location: `import:${specifier}`, value: 'absent' }],
    adapter: (model, params, ctx) =>
      model.removeNode(
        findUniqueNode(model, (node) => isImportOf(node, specifier), {
          ...ctx,
          describe: 'import',
        }),
        ctx
      ),
  })
}

/** Plans and applies `facts` (all on one path) against `source`. */
export function composeSynthetic(registry, facts, source = SYNTHETIC_SOURCE) {
  const [plan] = planStructuralComposition(registry, facts)
  return applyStructuralPlan(registry, plan, source)
}
