import assert from 'node:assert/strict'
import { test } from 'node:test'

import { SCAFFOLD_COVERING_SCENARIOS } from './scaffold-covering-recipes.mjs'
import * as scenarioSteps from './scaffold-scenario-recipes.mjs'
import * as verificationSteps from './scaffold-verification-steps.mjs'

const isWebBuild = (step) =>
  step.join(' ') === '--filter web build' || step.join(' ').startsWith('exec turbo run build')
const isBudget = (step) => step.join(' ') === 'check:route-budgets'

/** Every web build in a step list is immediately followed by the route budget check. */
function assertBudgetAfterBuilds(name, steps) {
  const builds = steps.flatMap((step, index) => (isWebBuild(step) ? [index] : []))
  for (const index of builds)
    assert.ok(isBudget(steps[index + 1] ?? []), `${name}: no budget check after step ${index}`)
  assert.equal(
    steps.filter(isBudget).length,
    builds.length,
    `${name}: budget checks must follow web builds`
  )
  return builds.length
}

test('every exported verification step list checks budgets after each web build', () => {
  for (const [name, steps] of Object.entries({ ...verificationSteps, ...scenarioSteps })) {
    if (!Array.isArray(steps) || !steps.every(Array.isArray)) continue
    assertBudgetAfterBuilds(name, steps)
  }
})

test('all six PR covering recipes build web and check its budgets', () => {
  assert.equal(SCAFFOLD_COVERING_SCENARIOS.length, 6)
  for (const recipe of SCAFFOLD_COVERING_SCENARIOS)
    assert.ok(assertBudgetAfterBuilds(recipe.name, recipe.postApplySteps) > 0, recipe.name)
})
