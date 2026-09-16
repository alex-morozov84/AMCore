import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { filesForFacts, filesInRoots } from './ownership-facts.mjs'
import { assertProjectionResiduals } from './ownership-residual.mjs'
import { storybookOwnership } from './storybook-ownership.mjs'

export const STORYBOOK_RESIDUAL_PATTERNS = Object.freeze({
  'docs/frontend/brand-theme-and-tokens.md': [
    './storybook.md#downstream-disabling-storybook',
    'The Storybook transform uses the same ownership contract',
  ],
  'docs/frontend/testing.md': ['path in Storybook instead', 'pnpm --filter web test:storybook'],
  'docs/operations-console/development.md': ['Storybook', 'test:storybook'],
  '.github/workflows/ci.yml': [
    'storybook job below',
    "storybook's 20",
    "storybook job's identical",
  ],
  'docs/frontend/route-progress.md': ['Storybook\n(`shared/ui/RouteProgressBar`)'],
  'apps/web/.gitignore': ['storybook-static', '*storybook.log'],
  'apps/web/vitest.config.ts': ['@storybook/', "name: 'storybook'", 'msw-storybook-addon'],
})

function surfaceFiles(validation) {
  return new Set(
    [...validation.inventory.surface].filter(([, kind]) => kind === 'file').map(([file]) => file)
  )
}

function removeDeleted(files, facts) {
  for (const fact of facts.filter((item) => item.kind === 'delete')) {
    for (const file of [...files]) {
      if (file === fact.path || file.startsWith(`${fact.path}/`)) files.delete(file)
    }
  }
}

function contentsFor(root, files) {
  return new Map([...files].map((file) => [file, readFileSync(path.join(root, file), 'utf8')]))
}

function assertOwnedFilesAbsent(validation, files) {
  const owned = new Set([
    ...filesInRoots(validation.inventory),
    ...filesForFacts(validation.inventory, storybookOwnership.facts.verification),
    ...filesForFacts(validation.inventory, storybookOwnership.facts.documentation),
  ])
  const residuals = [...owned].filter((file) => files.has(file))
  if (residuals.length) throw new Error(`Storybook projection left owned files: ${residuals}`)
}

function assertNoResidualPatterns(files, contents) {
  const residuals = []
  for (const [file, patterns] of Object.entries(STORYBOOK_RESIDUAL_PATTERNS)) {
    if (!files.has(file)) continue
    const content = contents.get(file) ?? ''
    for (const pattern of patterns) {
      if (content.includes(pattern)) residuals.push(`${file}:${pattern}`)
    }
  }
  if (residuals.length) throw new Error(`Storybook residual references: ${residuals.join(', ')}`)
}

export function virtualStorybookSurface(root, validation, facts, steps) {
  const files = surfaceFiles(validation)
  removeDeleted(files, facts)
  const contents = contentsFor(root, files)
  for (const step of steps.filter((item) => item.kind === 'edit')) {
    const relative = path.relative(root, step.target).split(path.sep).join('/')
    if (files.has(relative)) contents.set(relative, step.after)
  }
  return { files, contents }
}

export function assertStorybookProjection(validation, files, contents) {
  assertOwnedFilesAbsent(validation, files)
  assertNoResidualPatterns(files, contents)
  assertProjectionResiduals(
    [{ manifest: storybookOwnership, inventory: validation.inventory }],
    validation.projection,
    files,
    contents
  )
}

export function assertStorybookOwnershipApplied(root, validation) {
  const files = new Set(
    [...surfaceFiles(validation)].filter((file) => existsSync(path.join(root, file)))
  )
  assertStorybookProjection(validation, files, contentsFor(root, files))
}
