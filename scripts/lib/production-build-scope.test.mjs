import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { test } from 'node:test'
import ts from 'typescript'

const root = resolve(import.meta.dirname, '../..')
const require = createRequire(`${root}/apps/web/package.json`)
const { runTypeCheck } = require('next/dist/lib/typescript/runTypeCheck.js')
const { loadBindings } = require('next/dist/build/swc/index.js')
await loadBindings()

function config(path) {
  return ts.getParsedCommandLineOfConfigFile(
    path,
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (error) => {
        throw new Error(ts.flattenDiagnosticMessageText(error.messageText, '\n'))
      },
    }
  )
}

test('production configs retain runtime roots and strictness while full configs retain tests', () => {
  for (const app of ['web', 'api']) {
    const full = config(`${root}/apps/${app}/tsconfig.json`)
    const build = config(`${root}/apps/${app}/tsconfig.build.json`)
    assert.equal(build.options.strict, full.options.strict)
    assert.equal(build.options.moduleResolution, full.options.moduleResolution)
    assert(build.fileNames.length > 0)
    assert(full.fileNames.some((name) => /\.(test|spec)\./.test(name)))
    assert(
      !build.fileNames.some((name) => /\.(test|spec|stories|testkit|test-support)\./.test(name)),
      app
    )
    assert(
      build.fileNames.includes(
        `${root}/apps/${app}/src/${app === 'api' ? 'main.ts' : 'global.d.ts'}`
      )
    )
  }
  const webBuild = config(`${root}/apps/web/tsconfig.build.json`)
  assert(!webBuild.fileNames.includes(`${root}/apps/web/playwright.config.ts`))
  assert(
    config(`${root}/apps/web/tsconfig.json`).fileNames.includes(
      `${root}/apps/web/playwright.config.ts`
    )
  )
})

test('production source closures contain no local test, story or test-support imports', () => {
  const web = config(`${root}/apps/web/tsconfig.build.json`)
  const program = ts.createProgram(web.fileNames, web.options)
  const native = spawnSync(
    process.execPath,
    [
      `${root}/scripts/typecheck-native.mjs`,
      '--listFilesOnly',
      '--noEmit',
      '-p',
      'tsconfig.build.json',
    ],
    { cwd: `${root}/apps/api`, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
  )
  assert.equal(native.status, 0, native.stderr || native.stdout)
  const inventories = {
    web: program.getSourceFiles().map((source) => source.fileName),
    api: native.stdout.trim().split('\n'),
  }
  for (const [app, inventory] of Object.entries(inventories)) {
    const local = inventory.filter((name) => name.startsWith(`${root}/apps/${app}/src/`))
    assert(local.length > 0, `${app} closure must not be empty`)
    const fixture =
      /(?:\.(?:test|spec|stories|testkit|test-support)\.|\/__(?:tests|mocks)__\/|\/src\/test\/)/
    assert.deepEqual(
      local.filter((name) => fixture.test(name)),
      [],
      app
    )
  }
})

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'amcore-build-scope-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const raw = JSON.parse(readFileSync(`${root}/apps/web/tsconfig.build.json`, 'utf8'))
  writeFileSync(
    join(dir, 'tsconfig.json'),
    JSON.stringify({
      extends: `${root}/apps/web/tsconfig.build.json`,
      compilerOptions: { types: [], incremental: false },
      include: raw.include.filter(
        (pattern) => pattern !== 'next.config.ts' && pattern !== 'next-env.d.ts'
      ),
      exclude: raw.exclude,
    })
  )
  function write(name, text) {
    mkdirSync(resolve(dir, name, '..'), { recursive: true })
    writeFileSync(join(dir, name), text)
  }
  write('src/runtime.ts', 'export const value: string = "ok"')
  const standalone = () => {
    const parsed = config(join(dir, 'tsconfig.json'))
    const program = ts.createProgram(parsed.fileNames, parsed.options)
    return {
      files: program.getSourceFiles().map((source) => source.fileName),
      errors: ts.getPreEmitDiagnostics(program),
    }
  }
  const next = () =>
    runTypeCheck(ts, dir, '.next', join(dir, 'tsconfig.json'), join(dir, 'cache'), true)
  return { dir, write, standalone, next }
}

test('real Next checker rejects source and generated production-route type errors', async (t) => {
  const project = fixture(t)
  project.write('src/runtime.ts', 'export const value: string = 42')
  assert(project.standalone().errors.some((error) => error.code === 2322))
  await assert.rejects(project.next, /Type 'number' is not assignable to type 'string'/)
  project.write('src/runtime.ts', 'export const value: string = "ok"')
  project.write('.next/types/route-guard.ts', 'export const value: string = 42')
  await assert.rejects(project.next, /Type 'number' is not assignable to type 'string'/)
})

test('Next filters dev roots but an import can reenter; excludes are not an import barrier', async (t) => {
  const project = fixture(t)
  project.write('.next/dev/types/route-guard.ts', 'export const value: string = 42')
  assert(project.standalone().errors.some((error) => error.code === 2322))
  await project.next()
  project.write('src/runtime.ts', 'import "../.next/dev/types/route-guard"; export {}')
  await assert.rejects(project.next, /Type 'number' is not assignable to type 'string'/)
})

test('build excludes test roots yet standalone catches an imported test error', async (t) => {
  const project = fixture(t)
  project.write('src/value.test.ts', 'export const value: string = 42')
  assert(!project.standalone().files.some((name) => name.endsWith('/value.test.ts')))
  await project.next()
  project.write('src/runtime.ts', 'import "./value.test"; export {}')
  const imported = project.standalone()
  assert(imported.files.some((name) => name.endsWith('/value.test.ts')))
  assert(imported.errors.some((error) => error.code === 2322))
  // Next intentionally filters test diagnostics. The separate full check remains mandatory.
  await project.next()
})

test('native API compiler rejects production errors and keeps full test checking separate', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'amcore-native-build-scope-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const build = JSON.parse(readFileSync(`${root}/apps/api/tsconfig.build.json`, 'utf8'))
  const configPath = join(dir, 'tsconfig.json')
  const selected = {
    extends: `${root}/apps/api/tsconfig.build.json`,
    compilerOptions: { rootDir: '.', types: [], incremental: false },
    include: build.include,
    exclude: build.exclude,
  }
  mkdirSync(join(dir, 'src'))
  const runtime = join(dir, 'src/runtime.ts')
  writeFileSync(runtime, 'export const value: string = "ok"')
  writeFileSync(join(dir, 'src/value.test.ts'), 'export const value: string = 42')
  const run = () => {
    writeFileSync(configPath, JSON.stringify(selected))
    return spawnSync(
      process.execPath,
      [`${root}/scripts/typecheck-native.mjs`, '--noEmit', '-p', configPath],
      {
        cwd: `${root}/apps/api`,
        encoding: 'utf8',
      }
    )
  }
  assert.equal(run().status, 0)
  writeFileSync(runtime, 'export const value: string = 42')
  assert.match(run().stdout, /TS2322/)
  writeFileSync(runtime, 'import "./value.test"; export {}')
  assert.match(run().stdout, /TS2322/)
  writeFileSync(runtime, 'export const value: string = "ok"')
  selected.extends = `${root}/apps/api/tsconfig.json`
  selected.exclude = ['node_modules', 'dist']
  assert.match(run().stdout, /TS2322/)
})
