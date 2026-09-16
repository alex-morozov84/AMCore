import {
  insertAt,
  insertProvider,
  insertTarget,
  relative,
  take,
  takeOwned,
} from './project-display-helpers.mjs'
import { ROUTE_PROGRESS_SOURCE_PATH } from './project-route-progress-ownership.mjs'

const combinedOrder = [
  'PROJECT_CONTEXT.md',
  'apps/web/eslint.config.mjs',
  'apps/web/package.json',
  'docs/frontend/architecture-and-conventions.md',
  'docs/frontend/brand-theme-and-tokens.md',
  'docs/frontend/README.md',
  'README.md',
  'docs/README.md',
]

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

function insertStorybookProvider(plan, root, storybookSteps) {
  if (!storybookSteps.length) return
  const localeDelete = plan.findIndex(
    (step) => step.kind === 'delete' && relative(root, step.target) === 'apps/web/src/app/[locale]'
  )
  insertAt(plan, localeDelete < 0 ? plan.length : localeDelete, storybookSteps)
}

function insertConsole(plan, root, singles) {
  const context = singles.get('PROJECT_CONTEXT.md')
  const enabled = context?.semanticFacts[0].params.enabled
  if (enabled) insertProvider(plan, 'console', true, take(singles, 'PROJECT_CONTEXT.md'))
  insertTarget(plan, root, 'docs/operations/deployment.md', [
    ...takeOwned(singles, 'console', 'apps/web/messages/en.json', 'apps/web/messages/ru.json'),
    ...take(singles, 'apps/web/package.json'),
  ])
  const brandPath = 'docs/frontend/brand-theme-and-tokens.md'
  if (!plan.some((step) => relative(root, step.target) === brandPath)) {
    insertProvider(plan, 'console', false, take(singles, brandPath))
  }
  if (plan.some((step) => relative(root, step.target) === brandPath)) {
    insertTarget(
      plan,
      root,
      brandPath,
      take(singles, 'docs/frontend/architecture-and-conventions.md', 'docs/frontend/README.md')
    )
  }
  insertTarget(
    plan,
    root,
    'docs/operations/README.md',
    take(singles, 'README.md', 'docs/README.md')
  )
  if (context && !enabled)
    insertProvider(plan, 'console', false, take(singles, 'PROJECT_CONTEXT.md'))
}

function insertConsoleProvider(plan, root, consoleSteps) {
  if (!consoleSteps.length) return
  const localeDelete = plan.findIndex(
    (step) => step.kind === 'delete' && relative(root, step.target) === 'apps/web/src/app/[locale]'
  )
  insertAt(plan, localeDelete < 0 ? plan.length : localeDelete, consoleSteps)
}

function insertRouteProgress(plan, root, singles) {
  const steps = take(singles, ROUTE_PROGRESS_SOURCE_PATH, 'PROJECT_CONTEXT.md')
  if (!steps.length) return
  const boundary = plan.findIndex(
    (step) =>
      step.provider === 'console' ||
      (step.kind === 'delete' && relative(root, step.target) === 'apps/web/src/app/[locale]')
  )
  insertAt(plan, boundary < 0 ? plan.length : boundary, steps)
}

export function buildProjectDisplaySteps(
  root,
  legacySteps,
  semanticSteps,
  storybookSteps = [],
  consoleSteps = []
) {
  const plan = [...legacySteps]
  insertStorybookProvider(plan, root, storybookSteps)
  insertConsoleProvider(plan, root, consoleSteps)
  const storybookOwned = new Set(storybookSteps)
  const { singles, combined } = partitionSemantic(
    root,
    semanticSteps.filter((step) => !storybookOwned.has(step))
  )
  if (legacySteps.some((step) => step.provider === 'locale')) insertLocale(plan, root, singles)
  if (storybookSteps.length) insertStorybook(plan, root, singles)
  insertRouteProgress(plan, root, singles)
  if (plan.some((step) => step.provider === 'console')) insertConsole(plan, root, singles)
  if (singles.size) throw new Error(`unplaced semantic display steps: ${[...singles.keys()]}`)
  plan.push(...take(combined, ...combinedOrder))
  if (combined.size) throw new Error(`unplaced combined display steps: ${[...combined.keys()]}`)
  return plan
}
