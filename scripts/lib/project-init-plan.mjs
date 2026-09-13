// init:project's dimension checks and composed plan preparation.
import {
  assertKnownLocale,
  assertMultiLocaleAppStructure,
} from './project-config.mjs'
import { assertStorybookEnabled } from './project-config-storybook.mjs'
import { assertRouteProgressEnabled } from './project-config-route-progress.mjs'
import { assertAdminConsoleTransition } from './project-config-admin-console.mjs'
import { buildProjectSteps } from './project-plan.mjs'
import { buildWebLocaleDirCleanupSteps } from './project-plan-web-structure.mjs'
import { buildStorybookDisableSteps } from './project-plan-storybook.mjs'
import { buildRouteProgressFlagSteps } from './project-plan-route-progress-flag.mjs'
import { buildRouteProgressContextSteps } from './project-plan-route-progress-context.mjs'
import {
  buildAdminConsoleDisableSteps,
  buildAdminConsoleEnableSteps,
} from './project-plan-admin-console.mjs'
import { buildAdminConsoleSingleLocaleSteps } from './project-plan-admin-console-single-locale.mjs'
import { buildAdminConsoleSingleLocaleProxySteps } from './project-plan-admin-console-single-locale-proxy.mjs'
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

function singleConsoleChoice(flags, slug) {
  if (!flags.mode) return undefined
  if (flags['admin-console'] === 'disabled') return { mode: 'disabled', slug }
  return { mode: flags['admin-console'] ?? 'path', slug }
}

function explicitAdminSteps(root, flags, slug) {
  if (!flags['admin-console']) return []
  if (flags['admin-console'] === 'disabled') {
    return buildAdminConsoleDisableSteps(root, { keptLocale: flags.mode ? flags.locale : undefined })
  }
  return buildAdminConsoleEnableSteps(
    root,
    { mode: flags['admin-console'], slug },
    { moveRoute: !flags.mode, rewriteProxy: !(flags.mode && flags['admin-console'] === 'host') }
  )
}

function ownSteps(root, flags, adminConsoleSlug, overlap) {
  const withoutOverlap = (steps) => steps.filter((step) => !overlap.has(step.target))
  const consoleChoice = singleConsoleChoice(flags, adminConsoleSlug)
  const localeSteps = flags.mode
    ? buildProjectSteps(root, { locale: flags.locale, deferLocaleCleanup: Boolean(consoleChoice) })
    : []
  const consoleRouteSteps = consoleChoice?.mode === 'disabled'
    ? []
    : consoleChoice
      ? buildAdminConsoleSingleLocaleSteps(root, consoleChoice.slug)
      : []

  return [
    ...withoutOverlap(localeSteps),
    ...(flags.storybook ? withoutOverlap(buildStorybookDisableSteps(root)) : []),
    ...(flags['route-progress']
      ? [...buildRouteProgressFlagSteps(root), ...withoutOverlap(buildRouteProgressContextSteps(root))]
      : []),
    ...withoutOverlap(explicitAdminSteps(root, flags, adminConsoleSlug)),
    ...consoleRouteSteps,
    ...(consoleChoice?.mode === 'host'
      ? buildAdminConsoleSingleLocaleProxySteps(root, consoleChoice.slug)
      : []),
    ...(consoleChoice ? buildWebLocaleDirCleanupSteps(root) : []),
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
