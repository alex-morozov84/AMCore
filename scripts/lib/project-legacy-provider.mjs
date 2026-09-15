import path from 'node:path'

import { buildProjectSteps } from './project-plan.mjs'
import { buildWebLocaleDirCleanupSteps } from './project-plan-web-structure.mjs'
import { buildStorybookDisableSteps } from './project-plan-storybook.mjs'
import { buildRouteProgressFlagSteps } from './project-plan-route-progress-flag.mjs'
import {
  buildAdminConsoleDisableSteps,
  buildAdminConsoleEnableSteps,
} from './project-plan-admin-console.mjs'
import { buildAdminConsoleSingleLocaleSteps } from './project-plan-admin-console-single-locale.mjs'
import { buildAdminConsoleSingleLocaleProxySteps } from './project-plan-admin-console-single-locale-proxy.mjs'
import { SHARED_CONTENT_PATHS } from './project-shared-content-facts.mjs'

function singleConsoleChoice(flags, slug) {
  if (!flags.mode) return undefined
  if (flags['admin-console'] === 'disabled') return { mode: 'disabled', slug }
  return { mode: flags['admin-console'] ?? 'path', slug }
}

function explicitAdminSteps(root, flags, slug) {
  if (!flags['admin-console']) return []
  if (flags['admin-console'] === 'disabled') return buildAdminConsoleDisableSteps(root)
  return buildAdminConsoleEnableSteps(
    root,
    { mode: flags['admin-console'], slug },
    { moveRoute: !flags.mode, rewriteProxy: !(flags.mode && flags['admin-console'] === 'host') }
  )
}

function assertExclusive(root, steps) {
  const shared = new Set(SHARED_CONTENT_PATHS)
  const collision = steps.find((step) => {
    const relative = path.relative(root, step.target).split(path.sep).join('/')
    return shared.has(relative)
  })
  if (collision) throw new Error(`legacy provider emitted shared path: ${collision.target}`)
}

function owned(provider, steps) {
  return steps.map((step) => ({ ...step, provider }))
}

export function buildProjectLegacySteps(root, flags, adminConsoleSlug) {
  const consoleChoice = singleConsoleChoice(flags, adminConsoleSlug)
  const locale = flags.mode
    ? buildProjectSteps(root, { locale: flags.locale, deferLocaleCleanup: Boolean(consoleChoice) })
    : []
  const consoleRoutes =
    consoleChoice?.mode === 'disabled'
      ? []
      : consoleChoice
        ? buildAdminConsoleSingleLocaleSteps(root, consoleChoice.slug)
        : []
  const steps = [
    ...owned('locale', locale),
    ...owned('storybook', flags.storybook ? buildStorybookDisableSteps(root) : []),
    ...owned('route-progress', flags['route-progress'] ? buildRouteProgressFlagSteps(root) : []),
    ...owned('console', explicitAdminSteps(root, flags, adminConsoleSlug)),
    ...owned('console', consoleRoutes),
    ...(consoleChoice?.mode === 'host'
      ? owned('console', buildAdminConsoleSingleLocaleProxySteps(root, consoleChoice.slug))
      : []),
    ...owned('locale', consoleChoice ? buildWebLocaleDirCleanupSteps(root) : []),
  ]
  assertExclusive(root, steps)
  return steps
}
