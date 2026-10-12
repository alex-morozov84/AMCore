import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { readdirSync } from 'node:fs'

export function verifyExports(root, packageRoot) {
  const require = createRequire(join(root, 'package.json'))
  const ts = require('typescript')
  const paths = ['src/index.ts', 'dist/index.d.ts', 'dist/index.d.cts'].map((file) =>
    join(packageRoot, file)
  )
  const program = ts.createProgram(paths, {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
  })
  const checker = program.getTypeChecker()
  const exports = paths.map((path) => {
    const file = program.getSourceFile(path)
    assert.ok(file, `Missing built/source module ${path}`)
    return checker
      .getExportsOfModule(checker.getSymbolAtLocation(file))
      .map((symbol) => symbol.name)
      .sort()
  })
  const source = program.getSourceFile(paths[0])
  const values = checker
    .getExportsOfModule(checker.getSymbolAtLocation(source))
    .filter((symbol) => {
      const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol
      return Boolean(target.flags & ts.SymbolFlags.Value)
    })
    .map((symbol) => symbol.name)
    .sort()
  assert.deepEqual(exports[1], exports[0])
  assert.deepEqual(exports[2], exports[0])
  assert.deepEqual(readdirSync(join(packageRoot, 'dist')).sort(), [
    'index.cjs',
    'index.cjs.map',
    'index.d.cts',
    'index.d.ts',
    'index.js',
    'index.js.map',
  ])
  return values
}
