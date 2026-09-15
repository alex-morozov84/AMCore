import path from 'node:path'

import { buildProjectSteps } from './project-plan.mjs'
import { buildStorybookDisableSteps } from './project-plan-storybook.mjs'
import { buildRouteProgressFlagSteps } from './project-plan-route-progress-flag.mjs'
import { buildRouteProgressContextSteps } from './project-plan-route-progress-context.mjs'
import {
  buildAdminConsoleDisableSteps,
  buildAdminConsoleEnableSteps,
} from './project-plan-admin-console.mjs'

export const EXPECTED_SHARED_COLLISION_GRAPH = Object.freeze({
  'PROJECT_CONTEXT.md': ['console:edit', 'locale:edit', 'route-progress:edit', 'storybook:edit'],
  'README.md': ['console:edit', 'storybook:edit'],
  'apps/web/eslint.config.mjs': ['locale:edit', 'storybook:edit'],
  'apps/web/messages/en.json': ['console:edit', 'locale:delete'],
  'apps/web/messages/ru.json': ['console:edit', 'locale:delete'],
  'apps/web/package.json': ['console:edit', 'storybook:edit'],
  'docs/README.md': ['console:edit', 'storybook:edit'],
  'docs/frontend/README.md': ['console:edit', 'storybook:edit'],
  'docs/frontend/architecture-and-conventions.md': ['console:edit', 'storybook:edit'],
})

function providerVariants(root) {
  return {
    locale: [
      ...buildProjectSteps(root, { locale: 'en' }),
      ...buildProjectSteps(root, { locale: 'ru' }),
    ],
    storybook: buildStorybookDisableSteps(root),
    'route-progress': [
      ...buildRouteProgressFlagSteps(root),
      ...buildRouteProgressContextSteps(root),
    ],
    console: [
      ...buildAdminConsoleDisableSteps(root),
      ...buildAdminConsoleDisableSteps(root, { keptLocale: 'en' }),
      ...buildAdminConsoleDisableSteps(root, { keptLocale: 'ru' }),
      ...buildAdminConsoleEnableSteps(root, { mode: 'path', slug: 'panel' }),
      ...buildAdminConsoleEnableSteps(root, { mode: 'host', slug: 'panel' }),
    ],
  }
}

function relative(root, target) {
  return path.relative(root, target).split(path.sep).join('/')
}

export function buildLegacyCollisionGraph(root) {
  const targets = new Map()
  for (const [provider, steps] of Object.entries(providerVariants(root))) {
    for (const step of steps) {
      const target = relative(root, step.target)
      const contributors = targets.get(target) ?? new Map()
      const kinds = contributors.get(provider) ?? new Set()
      kinds.add(step.kind)
      contributors.set(provider, kinds)
      targets.set(target, contributors)
    }
  }
  return Object.fromEntries(
    [...targets]
      .filter(([, contributors]) => contributors.size > 1)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([target, contributors]) => [
        target,
        [...contributors]
          .flatMap(([provider, kinds]) => [...kinds].map((kind) => `${provider}:${kind}`))
          .sort(),
      ])
  )
}

export function assertExpectedCollisionGraph(graph) {
  const actual = JSON.stringify(graph)
  const expected = JSON.stringify(EXPECTED_SHARED_COLLISION_GRAPH)
  if (actual !== expected) throw new Error(`legacy collision graph changed: ${actual}`)
}
