import { buildProjectSharedContentFacts } from './project-shared-content-facts.mjs'
import { buildStorybookContentFacts } from './project-storybook-facts.mjs'

export const EXPECTED_SHARED_COLLISION_GRAPH = Object.freeze({
  'PROJECT_CONTEXT.md': ['locale:edit', 'route-progress:edit', 'storybook:edit'],
  'apps/web/eslint.config.mjs': ['locale:edit', 'storybook:edit'],
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
    const facts = [
      ...buildProjectSharedContentFacts(desired),
      ...buildStorybookContentFacts(desired),
    ]
    for (const fact of facts) {
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
