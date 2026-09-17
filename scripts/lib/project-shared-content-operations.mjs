import { PROJECT_SHARED_CORE_DEFINITIONS } from './project-shared-core-operations.mjs'
import { LOCALE_DATABASE_DEFAULT_DEFINITIONS } from './project-locale-database-default-operations.mjs'
import {
  removeStorybookArchitecture,
  removeStorybookDocsIndex,
  removeStorybookFrontendIndex,
} from './project-shared-storybook-indexes.mjs'
import { removeStorybookRoot } from './project-shared-storybook-root.mjs'
import {
  STORYBOOK_DOCS_INDEX_CLAIMS,
  STORYBOOK_FRONTEND_INDEX_CLAIMS,
  STORYBOOK_ROOT_CLAIMS,
} from './project-shared-markdown-claims.mjs'

const absent = (location) => ({ location, value: 'absent' })
const block = (name) => absent(`markdown:block:${name}`)

const definitions = new Map([
  ...PROJECT_SHARED_CORE_DEFINITIONS,
  ...LOCALE_DATABASE_DEFAULT_DEFINITIONS,
  [
    'readme-storybook',
    {
      claims: () => STORYBOOK_ROOT_CLAIMS,
      apply: removeStorybookRoot,
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
    'frontend-index-storybook',
    {
      claims: () => STORYBOOK_FRONTEND_INDEX_CLAIMS,
      apply: removeStorybookFrontendIndex,
    },
  ],
  [
    'architecture-storybook',
    {
      claims: () => [block('architecture-storybook-bullet')],
      apply: removeStorybookArchitecture,
    },
  ],
])

export function projectSharedContentDefinition(operationKey) {
  return definitions.get(operationKey)
}
