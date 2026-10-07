import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { execute } from './measure/instrumented-run.mjs'
import { SCAFFOLD_COVERING_SCENARIOS } from './lib/scaffold-covering-recipes.mjs'
import { SCAFFOLD_EXHAUSTIVE_SCENARIOS } from './lib/scaffold-scenario-recipes.mjs'
import { selectShard } from './lib/scaffold-ci-shards.mjs'
import { assertGeneratedScaffold } from './lib/scaffold-generated-assertions.mjs'
import { commit } from './lib/init-project-test-helpers.mjs'
import { createRealRepoCopy } from './lib/test-fixture.mjs'

const exhaustive = process.env.AMCORE_SCAFFOLD_MATRIX === 'exhaustive'
const shard = process.env.AMCORE_SCAFFOLD_SHARD
// Resolved at import time: an invalid shard fails before any repo copy or install.
const scenarios = selectShard(
  shard,
  exhaustive ? SCAFFOLD_EXHAUSTIVE_SCENARIOS : SCAFFOLD_COVERING_SCENARIOS,
  exhaustive
)

async function runScenario(scenario) {
  const copy = createRealRepoCopy()
  const started = performance.now()
  console.log(`[scaffolding] start ${scenario.name}`)
  try {
    commit(copy.root)
    const outcome = await execute(scenario, copy.root)
    assert.equal(outcome.success, true, `${scenario.name}: ${outcome.diagnosticsPath}`)
    await assertGeneratedScaffold(copy.root, scenario)
    if (!exhaustive) {
      assert.equal(outcome.counters.repoCopies, 1)
      assert.equal(outcome.counters.installs, 1)
      assert.equal(outcome.counters.buildRuns, 1)
    }
  } finally {
    copy.cleanup()
    console.log(
      `[scaffolding] finish ${scenario.name} (${Math.round(performance.now() - started)}ms)`
    )
  }
}

const label = exhaustive ? 'exhaustive backstop' : 'required covering array'
describe(`scaffolding ${label}${shard ? ` (shard ${shard})` : ''}`, () => {
  for (const scenario of scenarios) {
    test(scenario.name, { timeout: 15 * 60 * 1000 }, () => runScenario(scenario))
  }
})
