import { buildProjectSharedContentFacts } from './project-shared-content-facts.mjs'

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

function state(selected, overrides = {}) {
  return {
    selected: {
      locale: false,
      storybook: false,
      routeProgress: false,
      adminConsole: false,
      ...selected,
    },
    locale: { mode: 'multi', base: 'en' },
    storybook: 'enabled',
    routeProgress: 'enabled',
    adminConsole: { enabled: true, mode: 'path', slug: 'admin' },
    ...overrides,
  }
}

function providerVariants() {
  return [
    state({ locale: true }, { locale: { mode: 'single', base: 'en' } }),
    state({ locale: true }, { locale: { mode: 'single', base: 'ru' } }),
    state({ storybook: true }, { storybook: 'disabled' }),
    state({ routeProgress: true }, { routeProgress: 'disabled' }),
    state({ adminConsole: true }, { adminConsole: { enabled: false } }),
    state({ adminConsole: true }, { adminConsole: { enabled: true, mode: 'host', slug: 'panel' } }),
  ]
}

export function buildLegacyCollisionGraph() {
  const targets = new Map()
  for (const desired of providerVariants()) {
    for (const fact of buildProjectSharedContentFacts(desired)) {
      const provider = fact.dimension
      const target = fact.path
      const contributors = targets.get(target) ?? new Map()
      const kinds = contributors.get(provider) ?? new Set()
      kinds.add(fact.kind === 'delete' ? 'delete' : 'edit')
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
