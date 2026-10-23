import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { existsSync, readdirSync } from 'node:fs'

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
  verifyMirroredOutput(packageRoot)
  return values
}

/** dist mirrors src module by module (unbundled build): no orphan or foreign file kinds. */
function verifyMirroredOutput(packageRoot) {
  const files = readdirSync(join(packageRoot, 'dist'), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(join(packageRoot, 'dist').length + 1))
  for (const entry of ['index.js', 'index.cjs', 'index.d.ts', 'index.d.cts'])
    assert.equal(files.includes(entry), true, `missing dist/${entry}`)
  for (const file of files) {
    const module = file.match(/^(.+?)\.(?:js|cjs|js\.map|cjs\.map|d\.ts|d\.cts)$/)?.[1]
    assert.ok(module, `unexpected dist file ${file}`)
    const sources = [`${module}.ts`, `${module}.json`].map((name) => join(packageRoot, 'src', name))
    assert.ok(
      sources.some((path) => existsSync(path)),
      `dist/${file} has no source module`
    )
  }
}
