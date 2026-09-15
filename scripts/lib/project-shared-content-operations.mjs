import { PROJECT_SHARED_CORE_DEFINITIONS } from './project-shared-core-operations.mjs'
import {
  removeStorybookArchitecture,
  removeStorybookDocsIndex,
  removeStorybookFrontendIndex,
} from './project-shared-storybook-indexes.mjs'
import { removeStorybookRoot } from './project-shared-storybook-root.mjs'
import {
  CONSOLE_DOCS_INDEX_CLAIMS,
  CONSOLE_ROOT_CLAIMS,
  STORYBOOK_DOCS_INDEX_CLAIMS,
  STORYBOOK_FRONTEND_INDEX_CLAIMS,
  STORYBOOK_ROOT_CLAIMS,
} from './project-shared-markdown-claims.mjs'
import {
  removeConsoleArchitectureSection,
  removeConsoleFrontendIndexRow,
} from './project-plan-admin-console-disable-docs.mjs'
import {
  removeConsoleDocsIndexLinks,
  removeConsoleRootGuideLink,
} from './project-plan-admin-console-disable-discovery-docs.mjs'

const absent = (location) => ({ location, value: 'absent' })
const block = (name) => absent(`markdown:block:${name}`)

const definitions = new Map([
  ...PROJECT_SHARED_CORE_DEFINITIONS,
  [
    'readme-storybook',
    {
      claims: () => STORYBOOK_ROOT_CLAIMS,
      apply: removeStorybookRoot,
    },
  ],
  [
    'readme-console',
    {
      claims: () => CONSOLE_ROOT_CLAIMS,
      apply: removeConsoleRootGuideLink,
    },
  ],
  [
    'docs-index-storybook',
    {
      claims: () => STORYBOOK_DOCS_INDEX_CLAIMS,
      apply: removeStorybookDocsIndex,
    },
  ],
  [
    'docs-index-console',
    {
      claims: () => CONSOLE_DOCS_INDEX_CLAIMS,
      apply: removeConsoleDocsIndexLinks,
    },
  ],
  [
    'frontend-index-storybook',
    {
      claims: () => STORYBOOK_FRONTEND_INDEX_CLAIMS,
      apply: removeStorybookFrontendIndex,
    },
  ],
  [
    'frontend-index-console',
    {
      claims: () => [block('frontend-index-console-contributions')],
      apply: removeConsoleFrontendIndexRow,
    },
  ],
  [
    'architecture-storybook',
    {
      claims: () => [block('architecture-storybook-bullet')],
      apply: removeStorybookArchitecture,
    },
  ],
  [
    'architecture-console',
    {
      claims: () => [block('architecture-console-section')],
      apply: removeConsoleArchitectureSection,
    },
  ],
])

export function projectSharedContentDefinition(operationKey) {
  return definitions.get(operationKey)
}
