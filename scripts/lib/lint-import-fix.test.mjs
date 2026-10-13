import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import ts from 'typescript'

const ROOT = path.resolve(import.meta.dirname, '../..')

function command(args, cwd = ROOT) {
  const result = spawnSync(process.execPath, args, { cwd, encoding: 'utf8' })
  assert.equal(result.error, undefined)
  assert.equal(result.signal, null)
  assert.equal(result.status, 0, result.stdout + result.stderr)
}

function importKinds(source, filename) {
  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true)
  return file.statements.filter(ts.isImportDeclaration).flatMap((node) => {
    if (!node.importClause) return [{ module: node.moduleSpecifier.text, kind: 'side-effect' }]
    const clause = node.importClause
    return clause.namedBindings.elements.map((item) => ({
      name: item.name.text,
      kind: clause.isTypeOnly || item.isTypeOnly ? 'type' : 'value',
    }))
  })
}

test('paired fixes preserve mixed import kinds and DI, are byte-idempotent and typecheck', () => {
  const id = `lint-import-${randomUUID()}`
  const web = path.join(ROOT, 'apps/web/src/shared/lib')
  const api = path.join(ROOT, 'apps/api/src')
  const files = [
    path.join(web, `${id}.ts`),
    path.join(web, `${id}-support.ts`),
    path.join(web, `${id}-effect.ts`),
    path.join(api, `${id}.ts`),
  ]
  const config = path.join(ROOT, 'apps/api', `.lint-import-${randomUUID()}.json`)
  try {
    writeFileSync(
      files[1],
      'export type Shape = { value: number }; export type Explicit = Shape; export type Mixed = Shape; export const runtime = 1\n'
    )
    // Typecheck this module without executing its runtime side effect.
    writeFileSync(files[2], "Reflect.set(globalThis, '__lintImportFixture', true)\nexport {}\n")
    writeFileSync(
      files[0],
      `import { Shape, runtime, type Mixed } from './${id}-support'\nimport type { Explicit } from './${id}-support'\nimport './${id}-effect'\nexport const mixed: Mixed = { value: runtime }; export const result: Shape = { value: runtime }; export const explicit: Explicit = result\n`
    )
    writeFileSync(
      files[3],
      "import { EnvService } from './env/env.service'\nimport { Injectable } from '@nestjs/common'\n@Injectable()\nexport class Example { constructor(readonly env: EnvService) {} }\n"
    )
    const originals = [files[0], files[3]].map((file) => readFileSync(file))
    for (const [scope, file] of [
      ['web', files[0]],
      ['api', files[3]],
    ]) {
      command([
        path.join(ROOT, 'scripts/lint.mjs'),
        '--scope',
        scope,
        '--fix',
        '--max-warnings=0',
        file,
      ])
    }
    const first = [files[0], files[3]].map((file) => readFileSync(file))
    assert.notDeepEqual(
      first[0],
      originals[0],
      'native type import + residual sorting must perform a fix'
    )
    const kinds = importKinds(first[0].toString(), files[0])
    for (const name of ['Shape', 'Explicit', 'Mixed'])
      assert.ok(kinds.some((item) => item.name === name && item.kind === 'type'))
    assert.ok(kinds.some((item) => item.name === 'runtime' && item.kind === 'value'))
    assert.ok(kinds.some((item) => item.module === `./${id}-effect` && item.kind === 'side-effect'))
    assert.ok(
      importKinds(first[1].toString(), files[3]).some(
        (item) => item.name === 'EnvService' && item.kind === 'value'
      )
    )
    for (const [index, scope] of ['web', 'api'].entries()) {
      const file = index === 0 ? files[0] : files[3]
      command([
        path.join(ROOT, 'scripts/lint.mjs'),
        '--scope',
        scope,
        '--fix',
        '--max-warnings=0',
        file,
      ])
      assert.deepEqual(
        readFileSync(file),
        first[index],
        `${scope}: second paired fix changes bytes`
      )
    }
    writeFileSync(
      config,
      JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          target: 'ES2022',
          module: 'Preserve',
          moduleResolution: 'Bundler',
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          esModuleInterop: true,
          skipLibCheck: true,
          types: ['node'],
        },
        files,
      })
    )
    command([path.join(ROOT, 'node_modules/typescript/bin/tsc'), '--project', config])
  } finally {
    for (const file of [...files, config]) rmSync(file, { force: true })
  }
})
