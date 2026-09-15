const absent = (name) => ({ location: `markdown:block:${name}`, value: 'absent' })
const claims = (...names) => Object.freeze(names.map(absent))

export const STORYBOOK_ROOT_CLAIMS = claims(
  'root-doc-map-storybook-row',
  'root-doc-map-testing-storybook-copy',
  'root-tooling-storybook-copy',
  'root-scaffolding-flags-storybook-copy',
  'root-scaffolding-structure-storybook-copy',
  'root-capability-a11y-storybook-copy',
  'root-capability-workshop-row'
)

export const CONSOLE_ROOT_CLAIMS = claims(
  'root-console-guide',
  'root-doc-map-console-row',
  'root-capability-console-row',
  'root-project-tree-console-row'
)

export const STORYBOOK_DOCS_INDEX_CLAIMS = claims(
  'docs-index-storybook-intent-row',
  'docs-index-scaffolding-storybook-copy',
  'docs-index-testing-storybook-copy',
  'docs-index-brand-storybook-copy'
)

export const CONSOLE_DOCS_INDEX_CLAIMS = claims(
  'docs-index-console-intent-row',
  'docs-index-console-guide'
)

export const STORYBOOK_FRONTEND_INDEX_CLAIMS = claims(
  'frontend-index-storybook-row',
  'frontend-index-storybook-start-link',
  'frontend-index-scaffolding-storybook-copy'
)
