import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

import { OBSOLETE_PRODUCTION_MODULES } from './project-production-boundary-support.mjs'
import { structuralCopyCandidates } from './project-structural-copy-inventory.mjs'

const ROOT = path.resolve('.')
const LIB = path.join(ROOT, 'scripts/lib')
const MEASURE = path.join(ROOT, 'scripts/measure')
const TEST_HELPERS = new Set([
  'filesystem-transaction-crash-child.mjs',
  'project-production-boundary-support.mjs',
])

function productionSources() {
  const entrypoints = readdirSync(path.join(ROOT, 'scripts'))
    .filter((name) => name.endsWith('.mjs') && !name.endsWith('.test.mjs'))
    .map((name) => path.join(ROOT, 'scripts', name))
  const library = readdirSync(LIB)
    .filter(
      (name) => name.endsWith('.mjs') && !name.endsWith('.test.mjs') && !TEST_HELPERS.has(name)
    )
    .map((name) => path.join(LIB, name))
  return [...entrypoints, ...library].map((file) => [file, readFileSync(file, 'utf8')])
}

function requiredScriptSources() {
  return [LIB, MEASURE].flatMap((directory) =>
    readdirSync(directory)
      .filter((name) => name.endsWith('.mjs'))
      .map((name) => {
        const file = path.join(directory, name)
        return [file, readFileSync(file, 'utf8')]
      })
  )
}

test('obsolete planner modules are absent with no live static import', () => {
  const sources = productionSources()
  for (const name of OBSOLETE_PRODUCTION_MODULES) {
    assert.equal(existsSync(path.join(LIB, name)), false, name)
    const importer = sources.find(([, source]) =>
      new RegExp(`(?:from|import\\()\\s*['"][^'"]*${name.replace('.', '\\.')}`).test(source)
    )
    assert.equal(importer, undefined, `${name} still imported by ${importer?.[0]}`)
  }
})

test('production has no compatibility modules or opaque adapter mechanisms', () => {
  const names = readdirSync(LIB)
  assert.deepEqual(
    names.filter((name) => /^project-plan-.*\.mjs$/.test(name)),
    []
  )
  assert.equal(existsSync(path.join(LIB, 'project-plan.mjs')), false)
  assert.equal(existsSync(path.join(LIB, 'project-legacy-provider.mjs')), false)
  const localeSources = productionSources().filter(([file]) =>
    path.basename(file).startsWith('project-locale-')
  )
  const forbidden = /exactContentStep|moveAndRewriteStep|expectedBefore|switch\s*\([^)]*pathname/
  assert.deepEqual(
    localeSources.filter(([, source]) => forbidden.test(source)).map(([file]) => file),
    []
  )
  const compatibilityTokens =
    /\bstep\.write\s*\(|exactContentStep|moveAndRewriteStep|buildProjectLegacySteps|buildLegacyCollisionGraph|materializeLegacySteps|SCAFFOLD_MEASUREMENT_SCENARIOS|legacy-step-/
  assert.deepEqual(
    productionSources()
      .filter(([, source]) => compatibilityTokens.test(source))
      .map(([file]) => file),
    []
  )
})

test('locale adapters cannot hide whole functions or suites in replacement literals', () => {
  const localeSources = productionSources().filter(([file]) =>
    path.basename(file).startsWith('project-locale-')
  )
  assert.deepEqual(structuralCopyCandidates(localeSources), [])
  const hiddenSuite = [
    ['hidden.mjs', "const fixture = `describe('copied', () => {\n  it('x', () => {})\n})`"],
  ]
  assert.deepEqual(structuralCopyCandidates(hiddenSuite), [{ file: 'hidden.mjs', line: 1 }])
})

test('production contains one M4 executor and one engine call site', () => {
  const sources = productionSources()
  const executorImports = sources.filter(([, source]) =>
    /import\s*\{[^}]*applyFilesystemTransaction[^}]*\}\s*from\s*['"]\.\/filesystem-transaction\.mjs['"]/.test(
      source
    )
  )
  assert.deepEqual(
    executorImports.map(([file]) => path.basename(file)),
    ['init-engine.mjs']
  )
  const engine = readFileSync(path.join(LIB, 'init-engine.mjs'), 'utf8')
  assert.equal(engine.match(/\bapplyFilesystem\s*\(/g)?.length, 1)
})

test('the superseded console path registry is absent', () => {
  assert.equal(existsSync(path.join(LIB, 'admin-console-owned-paths.json')), false)
})

test('required script tests are portable without a historical git object', () => {
  const fullSha = new RegExp(`[0-9a-f]{${20 + 20}}`, 'i')
  const shellArchive = /git archive\s+(?!HEAD\b)/
  const argumentArchive = /['"]archive['"]\s*,\s*(?!['"]HEAD['"])/
  const offenders = requiredScriptSources()
    .filter(
      ([, source]) =>
        (fullSha.test(source) && /archive/.test(source)) ||
        shellArchive.test(source) ||
        argumentArchive.test(source)
    )
    .map(([file]) => path.relative(ROOT, file))
  assert.deepEqual(offenders, [])
})
