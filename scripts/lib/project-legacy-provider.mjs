import path from 'node:path'

import { buildProjectSteps } from './project-plan.mjs'
import { buildWebLocaleDirCleanupSteps } from './project-plan-web-structure.mjs'
import { SHARED_CONTENT_PATHS } from './project-shared-content-facts.mjs'

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

export function buildProjectLegacySteps(root, flags) {
  const locale = flags.mode
    ? buildProjectSteps(root, { locale: flags.locale, deferLocaleCleanup: true })
    : []
  const steps = [
    ...owned('locale', locale),
    ...owned('locale', flags.mode ? buildWebLocaleDirCleanupSteps(root) : []),
  ]
  assertExclusive(root, steps)
  return steps
}
