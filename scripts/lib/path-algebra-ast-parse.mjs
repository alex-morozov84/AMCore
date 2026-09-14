// Fail-closed parsing for the structural model (BACKLOG item 14, PR2/M2,
// FINAL PLAN §2.2) on the already-installed TypeScript Compiler API — no
// new dependency. Script kind (JS/TS/JSX) follows the path's extension.
import ts from 'typescript'
import { PathAlgebraConflictError } from './path-algebra-errors.mjs'

function parseError(code, path, diagnostic) {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')
  const { line } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start ?? 0)
  return new PathAlgebraConflictError(code, {
    paths: [path],
    dimensions: [],
    detail: `"${path}" does not parse at line ${line + 1}: ${message}`,
  })
}

/**
 * Syntactic diagnostics for an already-parsed `SourceFile`, through a
 * single-file program host that hands back that same object — the public
 * API route that does not parse a second time.
 */
function syntacticDiagnostics(sourceFile) {
  const { fileName } = sourceFile
  const host = {
    getSourceFile: (name) => (name === fileName ? sourceFile : undefined),
    getDefaultLibFileName: () => 'lib.d.ts',
    writeFile: () => {},
    getCurrentDirectory: () => '',
    getCanonicalFileName: (name) => name,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
    fileExists: (name) => name === fileName,
    readFile: () => undefined,
  }
  const program = ts.createProgram(
    [fileName],
    { noResolve: true, noLib: true, allowJs: true },
    host
  )
  return program.getSyntacticDiagnostics(sourceFile)
}

/**
 * Parses `text` as the file at `path` (with parent pointers, so adapters can
 * navigate upward) and throws `code` — `INVALID_INPUT_PARSE` for the source
 * the orchestrator reads, `INVALID_OUTPUT_PARSE` for what it would write —
 * on the first syntactic diagnostic.
 */
export function parseChecked(path, text, code) {
  const sourceFile = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true)
  const [first] = syntacticDiagnostics(sourceFile)
  if (first) throw parseError(code, path, first)
  return sourceFile
}
