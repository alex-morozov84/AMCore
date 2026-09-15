import {
  applyConsoleContext,
  applyLocaleContext,
  applyRouteProgressContext,
  applyStorybookContext,
} from './project-shared-context-operations.mjs'
import {
  removeConsoleMessages,
  removeConsolePackage,
  removeStorybookPackage,
  STORYBOOK_PACKAGE_PATHS,
} from './project-shared-json-operations.mjs'

const absent = (location) => ({ location, value: 'absent' })
const field = (name, value) => ({ location: `markdown:field:${name}`, value })
const block = (name) => absent(`markdown:block:${name}`)

function consoleClaims(params) {
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

export const PROJECT_SHARED_CORE_DEFINITIONS = [
  [
    'context-locale',
    {
      claims: ({ locale }) => [
        field('i18n_mode', 'single'),
        field('base_locale', locale),
        field('supported_locales', `[${locale}]`),
      ],
      apply: (text, { locale }) => applyLocaleContext(text, locale),
    },
  ],
  [
    'context-storybook',
    {
      claims: () => [field('frontend_storybook', 'disabled'), block('frontend-storybook-guide')],
      apply: applyStorybookContext,
    },
  ],
  [
    'context-route-progress',
    {
      claims: () => [field('frontend_route_progress', 'disabled')],
      apply: applyRouteProgressContext,
    },
  ],
  ['context-console', { claims: consoleClaims, apply: applyConsoleContext }],
  [
    'package-storybook',
    {
      claims: () => STORYBOOK_PACKAGE_PATHS.map((name) => absent(`json:${name}`)),
      apply: removeStorybookPackage,
    },
  ],
  [
    'package-console',
    {
      claims: () => [absent('json:scripts.test:e2e:console-real-stack')],
      apply: removeConsolePackage,
    },
  ],
  ['messages-console', { claims: () => [absent('json:console')], apply: removeConsoleMessages }],
]
