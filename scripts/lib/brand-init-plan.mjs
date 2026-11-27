import { materializeProductSettings } from './product-settings-plan.mjs'
import { buildBrandDesiredState } from './brand-desired-state.mjs'
import { buildBrandFacts } from './brand-facts.mjs'
import { materializeBrandSteps } from './brand-materializer.mjs'
import { buildBrandWritePlan } from './brand-write-plan.mjs'

export function prepareBrandInit(root, answers) {
  const desiredState = buildBrandDesiredState(answers)
  const facts = buildBrandFacts(root, desiredState)
  const materializedSteps = [
    ...materializeBrandSteps(root, facts),
    ...materializeProductSettings(root, answers),
  ]
  const operationPlan = buildBrandWritePlan({ root, materializedSteps })
  return { desiredState, facts, materializedSteps, operationPlan }
}
