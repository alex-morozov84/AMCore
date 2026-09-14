// Typed, structured conflict diagnostics for the path algebra (BACKLOG item
// 14, PR2/M1, FINAL PLAN §2.1). Kept separate from the existing engine's
// bare-message `EngineError` (scripts/lib/actions.mjs) — M1 is additive and
// does not import from the existing engine.

/**
 * One precise, structured conflict diagnostic. `code` names the exact rule
 * violated (see the §2.1 compatibility table); `paths` and `dimensions` name
 * every path/fact involved, sorted deterministically so the same conflict
 * always produces an identical message regardless of input order.
 */
export class PathAlgebraConflictError extends Error {
  constructor(code, { paths, dimensions, detail }) {
    const sortedPaths = [...paths].sort()
    const sortedDimensions = [...new Set(dimensions)].sort()
    super(
      `path algebra conflict [${code}]: ${detail} ` +
        `(paths: ${sortedPaths.join(', ')}; dimensions: ${sortedDimensions.join(', ')})`
    )
    this.code = code
    this.paths = sortedPaths
    this.dimensions = sortedDimensions
  }
}

export const CONFLICT_CODES = Object.freeze({
  MOVE_DESTINATION_MISMATCH: 'move-destination-mismatch',
  DELETE_OF_MOVE_SOURCE: 'delete-of-move-source',
  DELETE_CONTENT_CONFLICT: 'delete-content-conflict',
  COMPETING_MOVE_DESTINATION: 'competing-move-destination',
  MOVE_CYCLE: 'move-cycle',
  UNRESOLVED_OVERLAP: 'unresolved-overlap',
  // PR2/M2 (FINAL PLAN §2.2) — structural operation composition.
  UNKNOWN_OPERATION_KEY: 'unknown-operation-key',
  DUPLICATE_OPERATION_DEFINITION: 'duplicate-operation-definition',
  INVALID_OPERATION_DEFINITION: 'invalid-operation-definition',
  INVALID_OPERATION_PARAMS: 'invalid-operation-params',
  STRUCTURAL_PARAMS_CONFLICT: 'structural-params-conflict',
  EMPTY_SEMANTIC_WRITES: 'empty-semantic-writes',
  INVALID_SEMANTIC_WRITE: 'invalid-semantic-write',
  SEMANTIC_WRITE_CONFLICT: 'semantic-write-conflict',
  UNKNOWN_OPERATION_DEPENDENCY: 'unknown-operation-dependency',
  MISSING_OPERATION_DEPENDENCY: 'missing-operation-dependency',
  OPERATION_DEPENDENCY_CYCLE: 'operation-dependency-cycle',
  // Structural (AST) model — parse once, edit by node, serialize once.
  INVALID_INPUT_PARSE: 'invalid-input-parse',
  MISSING_SEMANTIC_NODE: 'missing-semantic-node',
  AMBIGUOUS_SEMANTIC_NODE: 'ambiguous-semantic-node',
  OVERLAPPING_STRUCTURAL_EDITS: 'overlapping-structural-edits',
  INVALID_OUTPUT_PARSE: 'invalid-output-parse',
})
