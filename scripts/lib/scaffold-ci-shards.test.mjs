import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { parse } from 'yaml'
import { SCAFFOLD_COVERING_SCENARIOS } from './scaffold-covering-recipes.mjs'
import { SCAFFOLD_CI_SHARDS, selectShard } from './scaffold-ci-shards.mjs'

const root = resolve(import.meta.dirname, '../..')
const REQUIRED_NAME = 'Scaffolding contract (full, real install/build/test)'
const workflow = (file) => parse(readFileSync(`${root}/.github/workflows/${file}`, 'utf8'))
const allNames = SCAFFOLD_COVERING_SCENARIOS.map((scenario) => scenario.name)

test('shards partition the six covering scenarios: exact union, no overlap, three each', () => {
  const lists = Object.values(SCAFFOLD_CI_SHARDS)
  assert.equal(lists.length, 2)
  for (const names of lists) assert.equal(new Set(names).size, 3)
  assert.deepEqual(lists.flat().sort(), [...allNames].sort())
  assert.equal(new Set(lists.flat()).size, allNames.length)
})

test('shard selection is unchanged when unset and fails closed otherwise', () => {
  assert.equal(
    selectShard(undefined, SCAFFOLD_COVERING_SCENARIOS, false),
    SCAFFOLD_COVERING_SCENARIOS
  )
  const picked = selectShard('b', SCAFFOLD_COVERING_SCENARIOS, false).map((s) => s.name)
  assert.deepEqual(picked.sort(), [...SCAFFOLD_CI_SHARDS.b].sort())
  for (const bad of ['', 'zzz', 'toString']) {
    assert.throws(
      () => selectShard(bad, SCAFFOLD_COVERING_SCENARIOS, false),
      /Unknown scaffold shard/
    )
  }
  assert.throws(() => selectShard('a', SCAFFOLD_COVERING_SCENARIOS, true), /covering array/)
  for (const names of [[], ['nope'], [allNames[0], allNames[0]]]) {
    assert.throws(() => selectShard('x', SCAFFOLD_COVERING_SCENARIOS, false, { x: names }))
  }
})

test('matrix runner rejects an invalid shard at import, before any install', () => {
  for (const env of [
    { AMCORE_SCAFFOLD_SHARD: 'zzz' },
    { AMCORE_SCAFFOLD_SHARD: 'a', AMCORE_SCAFFOLD_MATRIX: 'exhaustive' },
  ]) {
    const result = spawnSync(process.execPath, ['scripts/scaffold-verification-matrix.test.mjs'], {
      cwd: root,
      env: { ...process.env, NODE_TEST_CONTEXT: undefined, ...env },
      encoding: 'utf8',
      timeout: 60_000,
    })
    assert.notEqual(result.status, 0)
    assert.doesNotMatch(result.stdout, /\[scaffolding\] start/)
  }
})

test('CI runs both shards in parallel and publishes shard-only evidence from each', () => {
  const jobs = workflow('ci.yml').jobs
  const shard = jobs['scaffolding-generated-shard']
  assert.equal(shard.strategy['fail-fast'], false)
  const shards = shard.strategy.matrix.include.map((entry) => entry.shard)
  assert.deepEqual(shards.sort(), Object.keys(SCAFFOLD_CI_SHARDS).sort())
  assert.deepEqual(shard.strategy.matrix.include.map((entry) => entry['non-matrix-tests']).sort(), [
    false,
    true,
  ])
  assert.notEqual(shard.name, REQUIRED_NAME)
  const [run] = shard.steps.filter((step) => step.id === 'generated_scaffolding')
  assert.equal(run.env.AMCORE_SCAFFOLD_SHARD, '${{ matrix.shard }}')
  const evidence = shard.steps.find((step) => step.name?.startsWith('Upload shard evidence'))
  const diagnostics = shard.steps.find((step) => step.name === 'Upload shard diagnostics')
  for (const step of [evidence, diagnostics]) {
    assert.equal(step.if, 'always()')
    assert.match(
      step.with.name,
      /\$\{\{ matrix\.shard \}\}-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}$/
    )
  }
  assert.match(evidence.with.name, /^scaffold-shard-evidence-/)
  assert.match(evidence.with.path, /shadow-result\.json/)
  assert.match(evidence.with.path, /shard-scope\.json/)
  const scope = shard.steps.find((step) => step.name?.startsWith('Record shard scope'))
  assert.match(scope.run, /scope: "shard-only"/)
  assert.match(scope.run, /Shard \$\{scope\.shard\} only — not the whole matrix/)
  for (const step of shard.steps) assert.doesNotMatch(String(step.if ?? ''), /matrix\.shard\s*==/)
})

test('the required name belongs only to an aggregate that is green solely on full success', () => {
  const jobs = workflow('ci.yml').jobs
  const named = Object.entries(jobs).filter(([, job]) => job.name === REQUIRED_NAME)
  assert.deepEqual(
    named.map(([id]) => id),
    ['scaffolding-contract-full']
  )
  const gate = jobs['scaffolding-contract-full']
  assert.equal(gate.if, '${{ always() }}')
  assert.deepEqual(gate.needs, ['scaffolding-generated-shard'])
  assert.equal(
    gate.steps.some((step) => step.uses?.startsWith('actions/checkout')),
    false
  )
  for (const result of ['success', 'failure', 'cancelled', 'skipped']) {
    const outcome = spawnSync('bash', ['-c', gate.steps[0].run], {
      env: { ...process.env, SHARDS_RESULT: result },
      encoding: 'utf8',
    })
    assert.equal(outcome.status, result === 'success' ? 0 : 1, result)
  }
  assert.match(
    readFileSync(`${root}/.github/rulesets/main.json`, 'utf8'),
    /Scaffolding contract \(full, real install\/build\/test\)/
  )
})

test('exhaustive backstop is not sharded', () => {
  const text = readFileSync(`${root}/.github/workflows/scaffolding-exhaustive.yml`, 'utf8')
  assert.match(text, /pnpm test:scripts:exhaustive/)
  assert.doesNotMatch(text, /AMCORE_SCAFFOLD_SHARD/)
})
