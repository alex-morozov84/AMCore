import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

const ROOT = path.resolve('.')
const LIB = path.join(ROOT, 'scripts/lib')
const MEASURE = path.join(ROOT, 'scripts/measure')
const DELETED = [
  'project-plan-combined.mjs',
  'project-plan-combined-console-storybook-docs.mjs',
  'project-plan-context.mjs',
  'project-plan-web-messages.mjs',
  'project-plan-route-progress-context.mjs',
  'project-plan-admin-console-context.mjs',
  'project-plan-storybook-context.mjs',
  'project-plan-storybook-package.mjs',
  'project-plan-storybook-eslint.mjs',
  'project-plan-storybook-docs-root.mjs',
  'project-plan-route-progress-flag.mjs',
  'project-plan-storybook-docs-readme.mjs',
  'project-plan-storybook-docs-frontend-readme.mjs',
  'project-plan-admin-console-disable-discovery-docs.mjs',
  'project-plan-admin-console-disable-docs.mjs',
  'project-plan-admin-console-disable-web.mjs',
  'project-plan-admin-console-single-locale-proxy-assets.mjs',
  'project-plan-admin-console-single-locale-proxy.mjs',
  'project-plan-admin-console-single-locale.mjs',
  'project-plan-admin-console.mjs',
  'project-plan-storybook.mjs',
  'project-plan-storybook-files.mjs',
  'project-plan-storybook-ci.mjs',
  'project-plan-storybook-vitest.mjs',
  'project-plan-storybook-docs.mjs',
  'project-plan-storybook-docs-agents.mjs',
  'project-plan-storybook-docs-contributing.mjs',
  'project-plan-storybook-docs-testing.mjs',
  'project-plan-storybook-docs-ci-security.mjs',
  'project-plan-storybook-docs-misc.mjs',
]

function productionSources() {
  const entrypoints = readdirSync(path.join(ROOT, 'scripts'))
    .filter((name) => name.endsWith('.mjs') && !name.endsWith('.test.mjs'))
    .map((name) => path.join(ROOT, 'scripts', name))
  const library = readdirSync(LIB)
    .filter((name) => name.endsWith('.mjs') && !name.endsWith('.test.mjs'))
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
  for (const name of DELETED) {
    assert.equal(existsSync(path.join(LIB, name)), false, name)
    const importer = sources.find(([, source]) =>
      new RegExp(`(?:from|import\\()\\s*['"][^'"]*${name.replace('.', '\\.')}`).test(source)
    )
    assert.equal(importer, undefined, `${name} still imported by ${importer?.[0]}`)
  }
})

test('locale production has no legacy modules or opaque adapter mechanisms', () => {
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
})

test('production contains no step.write call and one engine M4 call site', () => {
  const sources = productionSources()
  assert.deepEqual(
    sources.filter(([, source]) => /\bstep\.write\s*\(/.test(source)).map(([file]) => file),
    []
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
