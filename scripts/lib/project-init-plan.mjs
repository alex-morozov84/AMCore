// init:project's dimension checks and composed plan preparation.
import {
  assertKnownLocale,
  assertMultiLocaleAppStructure,
} from './project-config.mjs'
import { assertStorybookEnabled } from './project-config-storybook.mjs'
import { assertRouteProgressEnabled } from './project-config-route-progress.mjs'
import { assertAdminConsoleTransition } from './project-config-admin-console.mjs'
import { buildProjectSteps } from './project-plan.mjs'
import { buildStorybookDisableSteps } from './project-plan-storybook.mjs'
import { buildRouteProgressFlagSteps } from './project-plan-route-progress-flag.mjs'
import { buildRouteProgressContextSteps } from './project-plan-route-progress-context.mjs'
import {
  buildAdminConsoleDisableSteps,
  buildAdminConsoleEnableSteps,
} from './project-plan-admin-console.mjs'
import { combinedTargets, buildCombinedSteps } from './project-plan-combined.mjs'

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

function dimensionsFor(flags, adminConsoleSlug) {
  return {
    locale: flags.mode ? flags.locale : undefined,
    storybook: flags.storybook,
    routeProgress: Boolean(flags['route-progress']),
    adminConsole: flags['admin-console']
      ? { mode: flags['admin-console'], slug: adminConsoleSlug }
      : undefined,
  }
}

function ownSteps(root, flags, adminConsoleSlug, overlap) {
  const withoutOverlap = (steps) => steps.filter((step) => !overlap.has(step.target))
  const adminSteps = flags['admin-console']
    ? flags['admin-console'] === 'disabled'
      ? buildAdminConsoleDisableSteps(root)
      : buildAdminConsoleEnableSteps(root, {
          mode: flags['admin-console'],
          slug: adminConsoleSlug,
        })
    : []

  return [
    ...(flags.mode ? withoutOverlap(buildProjectSteps(root, { locale: flags.locale })) : []),
    ...(flags.storybook ? withoutOverlap(buildStorybookDisableSteps(root)) : []),
    ...(flags['route-progress']
      ? [...buildRouteProgressFlagSteps(root), ...withoutOverlap(buildRouteProgressContextSteps(root))]
      : []),
    ...withoutOverlap(adminSteps),
  ]
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
  const dims = dimensionsFor(flags, adminConsoleSlug)
  const overlap = new Set(combinedTargets(root, dims))
  return {
    steps: [...ownSteps(root, flags, adminConsoleSlug, overlap), ...buildCombinedSteps(root, dims)],
    confirmMessage: confirmation(flags, adminConsoleSlug),
  }
}
