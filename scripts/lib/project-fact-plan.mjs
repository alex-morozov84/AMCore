import { buildProjectDesiredState } from './project-desired-state.mjs'
import { buildProjectSharedContentFacts } from './project-shared-content-facts.mjs'
import { buildProjectSharedContentSteps } from './project-shared-content.mjs'

export function buildProjectFactPlan(root, flags, adminConsoleSlug) {
  const desiredState = buildProjectDesiredState(root, flags, adminConsoleSlug)
  const sharedContentFacts = buildProjectSharedContentFacts(desiredState)
  const sharedContentSteps = buildProjectSharedContentSteps(root, sharedContentFacts)
  return { desiredState, sharedContentFacts, sharedContentSteps }
}
