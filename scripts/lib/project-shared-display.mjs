const summaries = {
  'context-locale': 'update i18n_mode/base_locale/supported_locales for single-locale mode',
  'context-storybook':
    'update frontend_storybook for the disabled choice and drop the dead doc link',
  'context-route-progress': 'update frontend_route_progress for the disabled choice',
  'context-console': 'record the Operations Console scaffold choice',
  'project-eslint-remove-navigation':
    'remove the navigation-import ban and its navigation.ts-scoped exemption',
  'project-eslint-remove-storybook':
    'apps/web/eslint.config.mjs: remove the Storybook plugin import, ignore entry, and rules block',
  'package-storybook': 'apps/web/package.json: remove the Storybook scripts and devDependencies',
  'package-console': 'remove the console real-stack test command',
  'readme-storybook':
    'README.md: remove the Storybook doc-map row, index row, tooling mention, and onboarding-callout mentions',
  'readme-console': 'remove console guide link',
  'docs-index-storybook': 'docs/README.md: remove the Storybook index row and doc-map entry',
  'docs-index-console': 'remove console documentation index links',
  'frontend-index-storybook':
    'docs/frontend/README.md: remove the Storybook index row, Start-here bullet, and stale scaffolding mention',
  'frontend-index-console': 'remove the Operations Console frontend index entry',
  'architecture-storybook':
    'architecture-and-conventions.md: remove the Storybook "See also" bullet',
  'architecture-console': 'remove the Operations Console FSD section',
}

const combined = {
  'PROJECT_CONTEXT.md': 'update PROJECT_CONTEXT.md fields for the combined dimensions',
  'apps/web/eslint.config.mjs':
    'apps/web/eslint.config.mjs: remove the navigation ban and the Storybook plugin/rules',
  'apps/web/package.json':
    'apps/web/package.json: remove the Storybook and console-only test scripts',
  'README.md': 'README.md: remove Storybook and console guide links',
  'docs/README.md': 'docs/README.md: remove Storybook and console guide links',
  'docs/frontend/README.md':
    'docs/frontend/README.md: remove Storybook and console-only index entries',
  'docs/frontend/architecture-and-conventions.md':
    'architecture-and-conventions.md: remove Storybook and console-only documentation',
}

function messageSummary(fact) {
  const locale = fact.path.match(/\/([^/]+)\.json$/)?.[1]
  return fact.kind === 'delete'
    ? `delete the ${locale} message catalogue (single-locale mode keeps only ${locale === 'en' ? 'ru' : 'en'})`
    : `remove the ${locale} console message namespace`
}

export function sharedDisplaySummary(pathname, facts) {
  if (pathname.startsWith('apps/web/messages/')) return messageSummary(facts[0])
  if (facts.length > 1) return combined[pathname]
  return summaries[facts[0].operationKey]
}
