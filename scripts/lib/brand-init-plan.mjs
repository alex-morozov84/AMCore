import { buildBrandDesiredState } from './brand-desired-state.mjs'
import { buildBrandFacts } from './brand-facts.mjs'
import { materializeBrandSteps } from './brand-materializer.mjs'
import { buildScaffoldOperationPlan } from './scaffold-operation-plan.mjs'

export function prepareBrandInit(root, answers) {
  const desiredState = buildBrandDesiredState(answers)
  const facts = buildBrandFacts(root, desiredState)
  const materializedSteps = materializeBrandSteps(root, facts)
  const operationPlan = buildScaffoldOperationPlan({ root, materializedSteps })
  return { desiredState, facts, materializedSteps, operationPlan }
}
