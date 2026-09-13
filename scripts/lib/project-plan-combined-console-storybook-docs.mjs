// Exact-doc composition when Storybook and Operations Console are both disabled.
import path from 'node:path'
import { fileStep } from './init-engine.mjs'
import {
  removeConsoleDocsIndexLinks,
  removeConsoleRootGuideLink,
} from './project-plan-admin-console-disable-discovery-docs.mjs'
import { removeStorybookDocsReadme } from './project-plan-storybook-docs-readme.mjs'
import { removeStorybookDocsRoot } from './project-plan-storybook-docs-root.mjs'

export function consoleStorybookDocsTargets(root) {
  return [path.join(root, 'README.md'), path.join(root, 'docs/README.md')]
}

export function buildConsoleStorybookDocsSteps(root) {
  return [
    fileStep(
      path.join(root, 'README.md'),
      (content) => removeConsoleRootGuideLink(removeStorybookDocsRoot(content)),
      'README.md: remove Storybook and console guide links'
    ),
    fileStep(
      path.join(root, 'docs/README.md'),
      (content) => removeConsoleDocsIndexLinks(removeStorybookDocsReadme(content)),
      'docs/README.md: remove Storybook and console guide links'
    ),
  ]
}
