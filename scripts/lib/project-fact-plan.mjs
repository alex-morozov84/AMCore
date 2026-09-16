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
import { buildProjectStorybookFacts } from './project-storybook-facts.mjs'
import {
  buildStorybookDisplaySteps,
  materializeStorybookSteps,
} from './project-storybook-steps.mjs'

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

function assertStorybookDisabled(root, storybook, steps) {
  if (!storybook.validation) return
  const virtual = storybook.virtualSurface(root, storybook.validation, storybook.facts, steps)
  storybook.assertProjection(storybook.validation, virtual.files, virtual.contents)
}

export function buildProjectFactPlan(root, flags, adminConsoleSlug) {
  const desiredState = buildProjectDesiredState(root, flags, adminConsoleSlug)
  const console = buildProjectConsoleFacts(root, desiredState)
  const storybook = buildProjectStorybookFacts(root, desiredState)
  const contentFacts = console.facts.filter((fact) => fact.kind === 'content')
  const sharedContentFacts = [
    ...buildProjectSharedContentFacts(desiredState),
    ...buildRouteProgressFacts(root, desiredState),
    ...storybook.facts.filter((fact) => fact.kind === 'content'),
    ...contentFacts,
  ]
  const sharedContentSteps = buildProjectSharedContentSteps(root, sharedContentFacts)
  const storybookSteps = materializeStorybookSteps(root, storybook.facts)
  const storybookDisplaySteps = buildStorybookDisplaySteps(root, storybookSteps, sharedContentSteps)
  const consoleSteps = materializeConsoleSteps(root, console.facts, sharedContentSteps)
  const allSteps = [...sharedContentSteps, ...storybookSteps, ...consoleSteps]
  assertStorybookDisabled(root, storybook, allSteps)
  assertDisabledProjection(root, desiredState, console, allSteps)
  return {
    desiredState,
    sharedContentFacts,
    sharedContentSteps,
    storybookFacts: storybook.facts,
    storybookSteps,
    storybookDisplaySteps,
    consoleFacts: console.facts,
    consoleSteps,
    assertApplied: () => {
      storybook.assertApplied?.()
      if (console.validation && !desiredState.adminConsole.enabled) {
        assertConsoleOwnershipApplied(root, console.validation)
      }
    },
  }
}
