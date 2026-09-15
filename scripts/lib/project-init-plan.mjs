// init:project's dimension checks and composed plan preparation.
import { assertKnownLocale, assertMultiLocaleAppStructure } from './project-config.mjs'
import { assertStorybookEnabled } from './project-config-storybook.mjs'
import { assertRouteProgressEnabled } from './project-config-route-progress.mjs'
import { assertAdminConsoleTransition } from './project-config-admin-console.mjs'
import { buildProjectFactPlan } from './project-fact-plan.mjs'
import { buildProjectDisplaySteps } from './project-display-plan.mjs'
import { buildProjectLegacySteps } from './project-legacy-provider.mjs'
import { SHARED_CONTENT_PATHS } from './project-shared-content-facts.mjs'
import { buildScaffoldOperationPlan } from './scaffold-operation-plan.mjs'

function assertDimensions(root, flags, adminConsoleSlug) {
  if (flags.mode) {
    assertKnownLocale(root, flags.locale)
    assertMultiLocaleAppStructure(root)
  }
  if (flags.storybook) assertStorybookEnabled(root)
  if (flags['route-progress']) assertRouteProgressEnabled(root)
  if (flags['admin-console']) {
    assertAdminConsoleTransition(root, flags['admin-console'], adminConsoleSlug)
  }
}

function confirmation(flags, adminConsoleSlug) {
  const selected = [
    flags.mode && `single-locale (--locale=${flags.locale})`,
    flags.storybook && 'Storybook-disable',
    flags['route-progress'] && 'route-progress-disable',
    flags['admin-console'] &&
      `admin-console-${flags['admin-console']} (--admin-console-slug=${adminConsoleSlug})`,
  ].filter(Boolean)
  const destructive = Boolean(flags.mode || flags.storybook || flags['admin-console'])
  const consequence = destructive
    ? 'This moves/deletes files and cannot be undone by re-running this command.'
    : 'This only edits a source flag and PROJECT_CONTEXT.md — reversible by hand at any time.'
  return `Apply the ${selected.join(' + ')} transform? ${consequence}`
}

export function prepareProjectInit(root, flags, adminConsoleSlug) {
  assertDimensions(root, flags, adminConsoleSlug)
  const factPlan = buildProjectFactPlan(root, flags, adminConsoleSlug)
  const legacySteps = buildProjectLegacySteps(root, flags, adminConsoleSlug)
  const materializationSteps = buildProjectDisplaySteps(
    root,
    legacySteps,
    factPlan.sharedContentSteps
  )
  const operationPlan = buildScaffoldOperationPlan({
    root,
    legacySteps,
    semanticSteps: factPlan.sharedContentSteps,
    forbiddenLegacyTargets: SHARED_CONTENT_PATHS,
    materializationSteps,
  })
  return {
    ...factPlan,
    legacySteps,
    operationPlan,
    steps: operationPlan.displaySteps,
    confirmMessage: confirmation(flags, adminConsoleSlug),
  }
}
