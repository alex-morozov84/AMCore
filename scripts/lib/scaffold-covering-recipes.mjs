import {
  CONSOLE_VERIFY_STEPS,
  FULL_VERIFY_STEPS,
  WEB_BUILD_STEPS,
} from './scaffold-verification-steps.mjs'

function row(name, flags, factors, postApplySteps, replaces = []) {
  return {
    name,
    flags: [...flags, '--yes'],
    installAfter: true,
    skipVerify: true,
    postApplySteps,
    topology: `${factors.localeTopology}-locale, console ${factors.console}`,
    factors,
    replaces,
  }
}

export const SCAFFOLD_COVERING_SCENARIOS = [
  row(
    'coverage-multi-path',
    ['--admin-console=path', '--admin-console-slug=panel', '--storybook=disabled'],
    {
      localeTopology: 'multi',
      locales: ['en', 'ru'],
      console: 'path',
      storybook: 'disabled',
      routeProgress: 'enabled',
      proxy: 'none',
    },
    FULL_VERIFY_STEPS,
    [
      'admin-console-path-panel',
      'storybook-disabled-install-before',
      'storybook-disabled-manual-verify-after',
    ]
  ),
  row(
    'coverage-multi-host-route-off',
    [
      '--admin-console=host',
      '--admin-console-slug=panel',
      '--storybook=disabled',
      '--route-progress=disabled',
    ],
    {
      localeTopology: 'multi',
      locales: ['en', 'ru'],
      console: 'host',
      storybook: 'disabled',
      routeProgress: 'disabled',
      proxy: 'multi-host',
    },
    CONSOLE_VERIFY_STEPS,
    ['admin-console-host-panel']
  ),
  row(
    'coverage-multi-disabled',
    ['--admin-console=disabled'],
    {
      localeTopology: 'multi',
      locales: ['en', 'ru'],
      console: 'disabled',
      storybook: 'enabled',
      routeProgress: 'enabled',
      proxy: 'none',
    },
    WEB_BUILD_STEPS
  ),
  row(
    'coverage-single-en-path-route-off',
    [
      '--mode=single',
      '--locale=en',
      '--admin-console=path',
      '--admin-console-slug=panel',
      '--route-progress=disabled',
    ],
    {
      localeTopology: 'single',
      locales: ['en'],
      console: 'path',
      storybook: 'enabled',
      routeProgress: 'disabled',
      proxy: 'none',
    },
    WEB_BUILD_STEPS
  ),
  row(
    'coverage-single-ru-host',
    ['--mode=single', '--locale=ru', '--admin-console=host', '--admin-console-slug=panel'],
    {
      localeTopology: 'single',
      locales: ['ru'],
      console: 'host',
      storybook: 'enabled',
      routeProgress: 'enabled',
      proxy: 'single-host',
    },
    WEB_BUILD_STEPS,
    ['admin-console-single-locale-ru-host-panel']
  ),
  row(
    'coverage-single-en-disabled-route-off',
    [
      '--mode=single',
      '--locale=en',
      '--admin-console=disabled',
      '--storybook=disabled',
      '--route-progress=disabled',
    ],
    {
      localeTopology: 'single',
      locales: ['en'],
      console: 'disabled',
      storybook: 'disabled',
      routeProgress: 'disabled',
      proxy: 'none',
    },
    FULL_VERIFY_STEPS,
    ['single-locale-en', 'route-progress-disabled', 'admin-console-single-locale-en-disabled']
  ),
]
