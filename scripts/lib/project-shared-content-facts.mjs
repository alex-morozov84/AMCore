import { STORYBOOK_CONTENT_PATHS } from './storybook-ownership.mjs'

export const SHARED_CONTENT_PATHS = Object.freeze([
  ...new Set([
    'PROJECT_CONTEXT.md',
    'apps/web/src/shared/lib/route-progress/route-progress-flag.ts',
    'apps/web/eslint.config.mjs',
    'apps/web/package.json',
    'README.md',
    'docs/README.md',
    'docs/frontend/README.md',
    'docs/frontend/architecture-and-conventions.md',
    'apps/web/messages/en.json',
    'apps/web/messages/ru.json',
    ...STORYBOOK_CONTENT_PATHS,
  ]),
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

function routeProgressFacts(state) {
  return state.selected.routeProgress
    ? [content('route-progress', 'PROJECT_CONTEXT.md', 'context-route-progress')]
    : []
}

export function buildProjectSharedContentFacts(state) {
  return [...localeFacts(state), ...routeProgressFacts(state)]
}
