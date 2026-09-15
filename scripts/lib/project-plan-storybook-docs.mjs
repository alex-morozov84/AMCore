// init:project --storybook=disabled: deletes docs/frontend/storybook.md
// itself and aggregates every step that updates a file referencing it.
import path from 'node:path'
import { deleteFileStep } from './init-engine.mjs'
import { buildStorybookDocsMiscSteps } from './project-plan-storybook-docs-misc.mjs'
import { buildStorybookDocsTestingSteps } from './project-plan-storybook-docs-testing.mjs'
import { buildStorybookDocsAgentsSteps } from './project-plan-storybook-docs-agents.mjs'
import { buildStorybookDocsContributingSteps } from './project-plan-storybook-docs-contributing.mjs'
import { buildStorybookDocsCiSecuritySteps } from './project-plan-storybook-docs-ci-security.mjs'

export function buildStorybookDocsSteps(root) {
  return [
    deleteFileStep(
      path.join(root, 'docs/frontend/storybook.md'),
      'delete docs/frontend/storybook.md'
    ),
    ...buildStorybookDocsMiscSteps(root),
    ...buildStorybookDocsTestingSteps(root),
    ...buildStorybookDocsAgentsSteps(root),
    ...buildStorybookDocsContributingSteps(root),
    ...buildStorybookDocsCiSecuritySteps(root),
  ]
}
