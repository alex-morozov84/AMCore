import path from 'node:path'

const combinedOrder = [
  'PROJECT_CONTEXT.md',
  'apps/web/eslint.config.mjs',
  'apps/web/package.json',
  'docs/frontend/architecture-and-conventions.md',
  'docs/frontend/README.md',
  'README.md',
  'docs/README.md',
]

function relative(root, target) {
  return path.relative(root, target).split(path.sep).join('/')
}

function insertAt(plan, index, steps) {
  if (steps.length) plan.splice(index, 0, ...steps)
}

function targetIndex(plan, root, target) {
  const index = plan.findIndex((step) => relative(root, step.target) === target)
  if (index < 0) throw new Error(`display-plan anchor is missing: ${target}`)
  return index
}

function insertTarget(plan, root, target, steps, offset = 0) {
  if (steps.length) insertAt(plan, targetIndex(plan, root, target) + offset, steps)
}

function providerBoundary(plan, provider, before) {
  const indexes = plan.flatMap((step, index) => (step.provider === provider ? [index] : []))
  if (!indexes.length) throw new Error(`display-plan provider is missing: ${provider}`)
  return before ? indexes[0] : indexes.at(-1) + 1
}

function insertProvider(plan, provider, before, steps) {
  if (steps.length) insertAt(plan, providerBoundary(plan, provider, before), steps)
}

function partitionSemantic(root, semanticSteps) {
  const singles = new Map()
  const combined = new Map()
  for (const step of semanticSteps) {
    const target = relative(root, step.target)
    const isMessage = target.startsWith('apps/web/messages/')
    const destination = step.semanticFacts.length > 1 && !isMessage ? combined : singles
    destination.set(target, step)
  }
  return { singles, combined }
}

function take(map, ...targets) {
  return targets.flatMap((target) => {
    const step = map.get(target)
    map.delete(target)
    return step ? [step] : []
  })
}

function takeOwned(map, dimension, ...targets) {
  return targets.flatMap((target) => {
    const step = map.get(target)
    if (step?.semanticFacts[0].dimension !== dimension) return []
    map.delete(target)
    return [step]
  })
}

function insertLocale(plan, root, singles) {
  insertProvider(plan, 'locale', true, take(singles, 'PROJECT_CONTEXT.md'))
  insertTarget(
    plan,
    root,
    'apps/web/src/i18n/request.ts',
    take(singles, 'apps/web/eslint.config.mjs'),
    1
  )
  insertTarget(
    plan,
    root,
    'apps/web/src/global.d.ts',
    takeOwned(singles, 'locale', 'apps/web/messages/en.json', 'apps/web/messages/ru.json'),
    1
  )
}

function insertStorybook(plan, root, singles) {
  insertTarget(
    plan,
    root,
    'apps/web/vitest.config.ts',
    take(singles, 'apps/web/package.json', 'apps/web/eslint.config.mjs')
  )
  insertTarget(
    plan,
    root,
    'docs/frontend/shared-ui-and-shadcn.md',
    take(
      singles,
      'docs/README.md',
      'docs/frontend/README.md',
      'docs/frontend/architecture-and-conventions.md'
    )
  )
  insertTarget(plan, root, 'AGENTS.md', take(singles, 'README.md'))
  insertProvider(plan, 'storybook', false, take(singles, 'PROJECT_CONTEXT.md'))
}

function insertConsole(plan, root, singles) {
  const context = singles.get('PROJECT_CONTEXT.md')
  const enabled = context?.semanticFacts[0].params.enabled
  if (enabled) insertProvider(plan, 'console', true, take(singles, 'PROJECT_CONTEXT.md'))
  insertTarget(plan, root, 'docs/operations/deployment.md', [
    ...takeOwned(singles, 'console', 'apps/web/messages/en.json', 'apps/web/messages/ru.json'),
    ...take(singles, 'apps/web/package.json'),
  ])
  insertTarget(
    plan,
    root,
    'docs/frontend/brand-theme-and-tokens.md',
    take(singles, 'docs/frontend/architecture-and-conventions.md', 'docs/frontend/README.md')
  )
  insertTarget(
    plan,
    root,
    'docs/operations/README.md',
    take(singles, 'README.md', 'docs/README.md')
  )
  if (context && !enabled)
    insertProvider(plan, 'console', false, take(singles, 'PROJECT_CONTEXT.md'))
}

export function buildProjectDisplaySteps(root, legacySteps, semanticSteps) {
  const plan = [...legacySteps]
  const { singles, combined } = partitionSemantic(root, semanticSteps)
  if (legacySteps.some((step) => step.provider === 'locale')) insertLocale(plan, root, singles)
  if (legacySteps.some((step) => step.provider === 'storybook'))
    insertStorybook(plan, root, singles)
  if (legacySteps.some((step) => step.provider === 'route-progress')) {
    insertProvider(plan, 'route-progress', false, take(singles, 'PROJECT_CONTEXT.md'))
  }
  if (legacySteps.some((step) => step.provider === 'console')) insertConsole(plan, root, singles)
  if (singles.size) throw new Error(`unplaced semantic display steps: ${[...singles.keys()]}`)
  plan.push(...take(combined, ...combinedOrder))
  if (combined.size) throw new Error(`unplaced combined display steps: ${[...combined.keys()]}`)
  return plan
}
