import { globSync } from 'node:fs'
import path from 'node:path'

import { STORYBOOK_STORY_GLOB } from './storybook-ownership-facts.mjs'

export function materializeStorybookSteps(root, facts) {
  return facts
    .filter((fact) => fact.kind === 'delete')
    .map((fact) => ({
      kind: 'delete',
      target: path.join(root, fact.path),
      changed: true,
      provider: 'storybook',
      modulePath: 'scripts/lib/project-storybook-facts.mjs',
      summary: `delete ${fact.path}`,
      semanticFacts: [fact],
    }))
}

const LEGACY_CONTENT_ORDER = [
  '.github/workflows/ci.yml',
  '.github/workflows/dependency-review.yml',
  'apps/web/vitest.config.ts',
]

const LEGACY_DOC_ORDER = [
  'docs/frontend/shared-ui-and-shadcn.md',
  'docs/frontend/testing.md',
  'AGENTS.md',
  'CONTRIBUTING.md',
  'docs/operations/ci-security.md',
]

const SHARED_INSERT_PATHS = new Set([
  'PROJECT_CONTEXT.md',
  'apps/web/eslint.config.mjs',
  'apps/web/package.json',
  'README.md',
  'docs/README.md',
  'docs/frontend/README.md',
  'docs/frontend/architecture-and-conventions.md',
])

function relative(root, target) {
  return path.relative(root, target).split(path.sep).join('/')
}

export function buildStorybookDisplaySteps(root, deleteSteps, contentSteps) {
  const ownedContent = contentSteps
    .filter((step) => step.semanticFacts.every((fact) => fact.dimension === 'storybook'))
    .filter((step) => !SHARED_INSERT_PATHS.has(relative(root, step.target)))
  for (const step of ownedContent) step.provider = 'storybook'
  const content = new Map(ownedContent.map((step) => [relative(root, step.target), step]))
  const deletes = new Map(deleteSteps.map((step) => [relative(root, step.target), step]))
  const take = (map, pathname) => {
    const step = map.get(pathname)
    map.delete(pathname)
    return step ? [step] : []
  }
  const rootAndStories = ['apps/web/.storybook', ...globSync(STORYBOOK_STORY_GLOB, { cwd: root })]
  const plan = [
    ...LEGACY_CONTENT_ORDER.flatMap((item) => take(content, item)),
    ...rootAndStories.flatMap((item) => take(deletes, item)),
    ...take(deletes, 'docs/frontend/storybook.md'),
    ...LEGACY_DOC_ORDER.flatMap((item) => take(content, item)),
    ...[...content.keys()].sort().flatMap((item) => take(content, item)),
  ]
  if (content.size || deletes.size) throw new Error('unplaced Storybook display steps')
  return plan
}
