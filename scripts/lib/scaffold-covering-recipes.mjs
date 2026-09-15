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
    ['--admin-console=path', '--admin-console-slug=panel'],
    {
      localeTopology: 'multi',
      locales: ['en', 'ru'],
      console: 'path',
      storybook: 'enabled',
      routeProgress: 'enabled',
      proxy: 'none',
    },
    CONSOLE_VERIFY_STEPS,
    ['admin-console-path-panel']
  ),
  row(
    'coverage-multi-host-route-off',
    ['--admin-console=host', '--admin-console-slug=panel', '--route-progress=disabled'],
    {
      localeTopology: 'multi',
      locales: ['en', 'ru'],
      console: 'host',
      storybook: 'enabled',
      routeProgress: 'disabled',
      proxy: 'multi-host',
    },
    CONSOLE_VERIFY_STEPS,
    ['admin-console-host-panel']
  ),
  row(
    'coverage-multi-disabled-storybook-off',
    ['--admin-console=disabled', '--storybook=disabled'],
    {
      localeTopology: 'multi',
      locales: ['en', 'ru'],
      console: 'disabled',
      storybook: 'disabled',
      routeProgress: 'enabled',
      proxy: 'none',
    },
    FULL_VERIFY_STEPS,
    ['storybook-disabled-install-before', 'storybook-disabled-manual-verify-after']
  ),
  row(
    'coverage-single-en-path-storybook-route-off',
    [
      '--mode=single',
      '--locale=en',
      '--admin-console=path',
      '--admin-console-slug=panel',
      '--storybook=disabled',
      '--route-progress=disabled',
    ],
    {
      localeTopology: 'single',
      locales: ['en'],
      console: 'path',
      storybook: 'disabled',
      routeProgress: 'disabled',
      proxy: 'none',
    },
    WEB_BUILD_STEPS
  ),
  row(
    'coverage-single-ru-host-storybook-off',
    [
      '--mode=single',
      '--locale=ru',
      '--admin-console=host',
      '--admin-console-slug=panel',
      '--storybook=disabled',
    ],
    {
      localeTopology: 'single',
      locales: ['ru'],
      console: 'host',
      storybook: 'disabled',
      routeProgress: 'enabled',
      proxy: 'single-host',
    },
    WEB_BUILD_STEPS,
    ['admin-console-single-locale-ru-host-panel']
  ),
  row(
    'coverage-single-en-disabled-route-off',
    ['--mode=single', '--locale=en', '--admin-console=disabled', '--route-progress=disabled'],
    {
      localeTopology: 'single',
      locales: ['en'],
      console: 'disabled',
      storybook: 'enabled',
      routeProgress: 'disabled',
      proxy: 'none',
    },
    FULL_VERIFY_STEPS,
    ['single-locale-en', 'route-progress-disabled', 'admin-console-single-locale-en-disabled']
  ),
]
