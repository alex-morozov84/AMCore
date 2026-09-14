// Execution inputs shared by the real scaffold end-to-end tests and the
// opt-in baseline runner. Expected generated output deliberately stays in the
// tests: sharing expectations with the runner would make validation circular.

export const STORYBOOK_MANUAL_VERIFY_STEPS = [
  ['typecheck'],
  ['lint'],
  ['--filter', 'web', 'build'],
  ['--filter', 'api', 'test'],
  ['--filter', 'web', 'test'],
]

export const ADMIN_CONSOLE_VERIFY_STEPS = [
  ['typecheck'],
  ['lint'],
  ['--filter', 'web', 'test'],
  ['--filter', 'web', 'build'],
]

export const ADMIN_CONSOLE_SINGLE_LOCALE_BUILD_STEPS = [
  ['--filter', 'shared', 'build'],
  ['--filter', 'web', 'build'],
]

export const SINGLE_LOCALE_EN_SCENARIO = {
  name: 'single-locale-en',
  flags: ['--mode=single', '--locale=en', '--yes'],
  installBefore: true,
  skipVerify: false,
  topology: 'single-locale (en), default Storybook/console/route-progress',
}

export const ROUTE_PROGRESS_DISABLED_SCENARIO = {
  name: 'route-progress-disabled',
  flags: ['--route-progress=disabled', '--yes'],
  installBefore: true,
  skipVerify: false,
  topology: 'multi-locale, route-progress default flipped off (non-destructive)',
}

export const STORYBOOK_DISABLED_INSTALL_BEFORE_SCENARIO = {
  name: 'storybook-disabled-install-before',
  flags: ['--storybook=disabled', '--yes'],
  installBefore: true,
  skipVerify: false,
  topology: 'multi-locale, Storybook removed; CLI verification is skipped pending install',
}

export const STORYBOOK_DISABLED_MANUAL_SCENARIO = {
  name: 'storybook-disabled-manual-verify-after',
  flags: ['--storybook=disabled', '--yes'],
  installBefore: false,
  installAfter: true,
  skipVerify: true,
  postApplySteps: STORYBOOK_MANUAL_VERIFY_STEPS,
  topology: 'multi-locale, Storybook removed and verified after dependency install',
}

export const ADMIN_CONSOLE_ENABLED_SCENARIOS = [
  {
    name: 'admin-console-path-panel',
    flags: ['--admin-console=path', '--admin-console-slug=panel', '--yes'],
    installBefore: true,
    skipVerify: true,
    postApplySteps: ADMIN_CONSOLE_VERIFY_STEPS,
    topology: 'multi-locale, console enabled, path topology, custom slug',
  },
  {
    name: 'admin-console-host-panel',
    flags: ['--admin-console=host', '--admin-console-slug=panel', '--yes'],
    installBefore: true,
    skipVerify: true,
    postApplySteps: ADMIN_CONSOLE_VERIFY_STEPS,
    topology: 'multi-locale, console enabled, host topology, custom slug',
  },
]

export const ADMIN_CONSOLE_SINGLE_LOCALE_SCENARIOS = [
  {
    name: 'admin-console-single-locale-ru-host-panel',
    flags: [
      '--mode=single',
      '--locale=ru',
      '--admin-console=host',
      '--admin-console-slug=panel',
      '--yes',
    ],
    installBefore: true,
    skipVerify: true,
    postApplySteps: ADMIN_CONSOLE_SINGLE_LOCALE_BUILD_STEPS,
    topology: 'single-locale (ru), console enabled, host topology, custom slug',
  },
  {
    name: 'admin-console-single-locale-en-disabled',
    flags: ['--mode=single', '--locale=en', '--admin-console=disabled', '--yes'],
    installBefore: true,
    skipVerify: true,
    postApplySteps: ADMIN_CONSOLE_SINGLE_LOCALE_BUILD_STEPS,
    topology: 'single-locale (en), console disabled',
  },
]

export const SCAFFOLD_MEASUREMENT_SCENARIOS = [
  SINGLE_LOCALE_EN_SCENARIO,
  ROUTE_PROGRESS_DISABLED_SCENARIO,
  STORYBOOK_DISABLED_INSTALL_BEFORE_SCENARIO,
  STORYBOOK_DISABLED_MANUAL_SCENARIO,
  ...ADMIN_CONSOLE_ENABLED_SCENARIOS,
  ...ADMIN_CONSOLE_SINGLE_LOCALE_SCENARIOS,
]
