export const SHARED_CONTENT_PATHS = Object.freeze([
  'PROJECT_CONTEXT.md',
  'apps/web/eslint.config.mjs',
  'apps/web/package.json',
  'README.md',
  'docs/README.md',
  'docs/frontend/README.md',
  'docs/frontend/architecture-and-conventions.md',
  'apps/web/messages/en.json',
  'apps/web/messages/ru.json',
])

const content = (dimension, path, operationKey, params = {}) => ({
  kind: 'content',
  dimension,
  path,
  operationKey,
  params,
})

const remove = (dimension, path) => ({
  kind: 'delete',
  dimension,
  path,
  claims: [{ location: `filesystem:path:${path}`, value: 'absent' }],
})

function localeFacts(state) {
  if (!state.selected.locale) return []
  const removed = state.locale.base === 'en' ? 'ru' : 'en'
  return [
    content('locale', 'PROJECT_CONTEXT.md', 'context-locale', { locale: state.locale.base }),
    content('locale', 'apps/web/eslint.config.mjs', 'project-eslint-remove-navigation'),
    remove('locale', `apps/web/messages/${removed}.json`),
  ]
}

function storybookFacts(state) {
  if (!state.selected.storybook) return []
  return [
    content('storybook', 'PROJECT_CONTEXT.md', 'context-storybook'),
    content('storybook', 'apps/web/eslint.config.mjs', 'project-eslint-remove-storybook'),
    content('storybook', 'apps/web/package.json', 'package-storybook'),
    content('storybook', 'README.md', 'readme-storybook'),
    content('storybook', 'docs/README.md', 'docs-index-storybook'),
    content('storybook', 'docs/frontend/README.md', 'frontend-index-storybook'),
    content('storybook', 'docs/frontend/architecture-and-conventions.md', 'architecture-storybook'),
  ]
}

function routeProgressFacts(state) {
  return state.selected.routeProgress
    ? [content('route-progress', 'PROJECT_CONTEXT.md', 'context-route-progress')]
    : []
}

function consoleFacts(state) {
  if (!state.selected.adminConsole) return []
  const context = content('console', 'PROJECT_CONTEXT.md', 'context-console', state.adminConsole)
  if (state.adminConsole.enabled) return [context]
  const kept = state.selected.locale ? [state.locale.base] : ['en', 'ru']
  return [
    context,
    content('console', 'apps/web/package.json', 'package-console'),
    content('console', 'README.md', 'readme-console'),
    content('console', 'docs/README.md', 'docs-index-console'),
    content('console', 'docs/frontend/README.md', 'frontend-index-console'),
    content('console', 'docs/frontend/architecture-and-conventions.md', 'architecture-console'),
    ...kept.map((locale) =>
      content('console', `apps/web/messages/${locale}.json`, 'messages-console')
    ),
  ]
}

export function buildProjectSharedContentFacts(state) {
  return [
    ...localeFacts(state),
    ...storybookFacts(state),
    ...routeProgressFacts(state),
    ...consoleFacts(state),
  ]
}
