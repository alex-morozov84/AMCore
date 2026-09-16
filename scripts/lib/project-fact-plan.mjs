import {
  assertConsoleOwnershipApplied,
  buildProjectConsoleFacts,
} from './project-console-facts.mjs'
import { assertProjectionResiduals } from './ownership-residual.mjs'
import { materializeConsoleSteps } from './project-console-steps.mjs'
import { buildProjectDesiredState } from './project-desired-state.mjs'
import { buildRouteProgressFacts } from './project-route-progress-facts.mjs'
import { buildProjectSharedContentFacts } from './project-shared-content-facts.mjs'
import { buildProjectSharedContentSteps } from './project-shared-content.mjs'

function assertDisabledProjection(root, desiredState, console, steps) {
  if (!console.validation || desiredState.adminConsole.enabled) return
  const virtual = console.virtualSurface(
    root,
    console.validation,
    console.facts,
    steps,
    console.omittedPaths
  )
  assertProjectionResiduals(
    [{ manifest: console.validation.manifest, inventory: console.validation.inventory }],
    console.validation.projection,
    virtual.files,
    virtual.contents
  )
}

export function buildProjectFactPlan(root, flags, adminConsoleSlug) {
  const desiredState = buildProjectDesiredState(root, flags, adminConsoleSlug)
  const console = buildProjectConsoleFacts(root, desiredState)
  const contentFacts = console.facts.filter((fact) => fact.kind === 'content')
  const sharedContentFacts = [
    ...buildProjectSharedContentFacts(desiredState),
    ...buildRouteProgressFacts(root, desiredState),
    ...contentFacts,
  ]
  const sharedContentSteps = buildProjectSharedContentSteps(root, sharedContentFacts)
  const consoleSteps = materializeConsoleSteps(root, console.facts, sharedContentSteps)
  assertDisabledProjection(root, desiredState, console, [...sharedContentSteps, ...consoleSteps])
  return {
    desiredState,
    sharedContentFacts,
    sharedContentSteps,
    consoleFacts: console.facts,
    consoleSteps,
    assertApplied:
      console.validation && !desiredState.adminConsole.enabled
        ? () => assertConsoleOwnershipApplied(root, console.validation)
        : () => {},
  }
}
