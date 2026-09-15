import { jsonDeleteTransform, markdownFieldsTransform } from './plan-steps.mjs'
import { localeContextOps } from './project-plan-context.mjs'
import {
  removeStorybookDocLinkFromContext,
  storybookContextOps,
} from './project-plan-storybook-context.mjs'
import { routeProgressContextOps } from './project-plan-route-progress-context.mjs'
import { removeStorybookFromPackage } from './project-plan-storybook-package.mjs'
import { removeStorybookDocsRoot } from './project-plan-storybook-docs-root.mjs'
import { removeStorybookDocsReadme } from './project-plan-storybook-docs-readme.mjs'
import { removeStorybookFromFrontendReadme } from './project-plan-storybook-docs-frontend-readme.mjs'
import { removeStorybookArchitectureBullet } from './project-plan-storybook-docs-misc.mjs'
import { transformAdminConsoleContext } from './project-plan-admin-console-context.mjs'
import { removeConsolePackageScript } from './project-plan-admin-console-disable-web.mjs'
import {
  removeConsoleArchitectureSection,
  removeConsoleFrontendIndexRow,
} from './project-plan-admin-console-disable-docs.mjs'
import {
  removeConsoleDocsIndexLinks,
  removeConsoleRootGuideLink,
} from './project-plan-admin-console-disable-discovery-docs.mjs'

const absent = (location) => ({ location, value: 'absent' })
const field = (name, value) => ({ location: `markdown:field:${name}`, value })
const block = (name) => absent(`markdown:block:${name}`)

const STORYBOOK_PACKAGE_PATHS = [
  'scripts.test:storybook',
  'scripts.storybook',
  'scripts.build-storybook',
  'devDependencies.@storybook/addon-a11y',
  'devDependencies.@storybook/addon-docs',
  'devDependencies.@storybook/addon-themes',
  'devDependencies.@storybook/addon-vitest',
  'devDependencies.@storybook/nextjs-vite',
  'devDependencies.@vitest/browser-playwright',
  'devDependencies.eslint-plugin-storybook',
  'devDependencies.msw-storybook-addon',
  'devDependencies.storybook',
  'devDependencies.path-to-regexp',
]

function contextConsoleClaims(params) {
  return params.enabled
    ? [
        field('admin_console', 'enabled'),
        field('admin_console_mode', params.mode),
        field('admin_console_slug', params.slug),
      ]
    : [
        field('admin_console', 'disabled'),
        field('admin_console_mode', 'absent'),
        field('admin_console_slug', 'absent'),
      ]
}

function applyConsoleContext(text, params) {
  const choice = params.enabled ? { mode: params.mode, slug: params.slug } : { mode: 'disabled' }
  return transformAdminConsoleContext(text, choice)
}

const definitions = new Map([
  [
    'context-locale',
    {
      claims: ({ locale }) => [
        field('i18n_mode', 'single'),
        field('base_locale', locale),
        field('supported_locales', `[${locale}]`),
      ],
      apply: (text, { locale }) => markdownFieldsTransform(localeContextOps(locale))(text),
    },
  ],
  [
    'context-storybook',
    {
      claims: () => [field('frontend_storybook', 'disabled'), block('frontend-storybook-guide')],
      apply: (text) =>
        removeStorybookDocLinkFromContext(markdownFieldsTransform(storybookContextOps())(text)),
    },
  ],
  [
    'context-route-progress',
    {
      claims: () => [field('frontend_route_progress', 'disabled')],
      apply: (text) => markdownFieldsTransform(routeProgressContextOps())(text),
    },
  ],
  ['context-console', { claims: contextConsoleClaims, apply: applyConsoleContext }],
  [
    'package-storybook',
    {
      claims: () => STORYBOOK_PACKAGE_PATHS.map((name) => absent(`json:${name}`)),
      apply: removeStorybookFromPackage,
    },
  ],
  [
    'package-console',
    {
      claims: () => [absent('json:scripts.test:e2e:console-real-stack')],
      apply: removeConsolePackageScript,
    },
  ],
  [
    'readme-storybook',
    { claims: () => [block('root-storybook-contributions')], apply: removeStorybookDocsRoot },
  ],
  [
    'readme-console',
    { claims: () => [block('root-console-contributions')], apply: removeConsoleRootGuideLink },
  ],
  [
    'docs-index-storybook',
    {
      claims: () => [block('docs-index-storybook-contributions')],
      apply: removeStorybookDocsReadme,
    },
  ],
  [
    'docs-index-console',
    {
      claims: () => [block('docs-index-console-contributions')],
      apply: removeConsoleDocsIndexLinks,
    },
  ],
  [
    'frontend-index-storybook',
    {
      claims: () => [block('frontend-index-storybook-contributions')],
      apply: removeStorybookFromFrontendReadme,
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
      apply: removeStorybookArchitectureBullet,
    },
  ],
  [
    'architecture-console',
    {
      claims: () => [block('architecture-console-section')],
      apply: removeConsoleArchitectureSection,
    },
  ],
  [
    'messages-console',
    {
      claims: () => [absent('json:console')],
      apply: (text) => jsonDeleteTransform(['console'])(text),
    },
  ],
])

export function projectSharedContentDefinition(operationKey) {
  return definitions.get(operationKey)
}
