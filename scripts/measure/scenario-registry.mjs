// Static inventory of the scaffolding suite's real install-bearing
// scenarios (BACKLOG item 14, PR1 §C) — declares INPUT only (flags, install
// timing, extra manual verify commands some test files run outside the CLI
// itself). Which verification stages actually ran, their counts, and
// success are never assumed here — `instrumented-run.mjs` measures that live
// from each real run, per PR1's "classifier must not generate the
// expectations it then checks as truth" constraint.
//
// Every entry cites the exact test file/lines it mirrors so a reviewer can
// diff this registry against the real suite by hand; `scenario-registry.test.mjs`
// additionally asserts each citation's flag string still appears verbatim in
// that file, so silent drift fails a fast test instead of only being caught
// by someone re-reading both files side by side.
export const SCENARIOS = [
  {
    name: 'single-locale-en',
    flags: ['--mode=single', '--locale=en', '--yes'],
    installBefore: true,
    skipVerify: false,
    topology: 'single-locale (en), default Storybook/console/route-progress',
    citation: 'scripts/init-project.test.mjs:60-64',
  },
  {
    name: 'route-progress-disabled',
    flags: ['--route-progress=disabled', '--yes'],
    installBefore: true,
    skipVerify: false,
    topology: 'multi-locale, route-progress default flipped off (non-destructive)',
    citation: 'scripts/init-project-route-progress.test.mjs:50-56',
  },
  {
    name: 'storybook-disabled-install-before',
    flags: ['--storybook=disabled', '--yes'],
    installBefore: true,
    skipVerify: false,
    topology: 'multi-locale, Storybook removed — CLI verify is a documented no-op ' +
      '(init-project.mjs: `defaultVerify = flags.storybook ? () => [] : ...`)',
    citation: 'scripts/init-project-storybook.test.mjs:100-118',
  },
  {
    name: 'storybook-disabled-manual-verify-after',
    flags: ['--storybook=disabled', '--yes'],
    installBefore: false,
    installAfter: true,
    skipVerify: true,
    postApplySteps: [['typecheck'], ['lint'], ['--filter', 'web', 'test'], ['--filter', 'web', 'build']],
    topology: 'multi-locale, Storybook removed, verified manually after the follow-up pnpm install',
    citation: 'scripts/init-project-storybook.test.mjs:131-148',
  },
  {
    name: 'admin-console-path-panel',
    flags: ['--admin-console=path', '--admin-console-slug=panel', '--yes'],
    installBefore: true,
    skipVerify: true,
    postApplySteps: [['typecheck'], ['lint'], ['--filter', 'web', 'test'], ['--filter', 'web', 'build']],
    topology: 'multi-locale, console enabled, path topology, custom slug',
    citation: 'scripts/init-project-admin-console.test.mjs:28-37,151-159',
  },
  {
    name: 'admin-console-host-panel',
    flags: ['--admin-console=host', '--admin-console-slug=panel', '--yes'],
    installBefore: true,
    skipVerify: true,
    postApplySteps: [['typecheck'], ['lint'], ['--filter', 'web', 'test'], ['--filter', 'web', 'build']],
    topology: 'multi-locale, console enabled, host topology, custom slug',
    citation: 'scripts/init-project-admin-console.test.mjs:28-37,151-159',
  },
  {
    // The declarative SCENARIOS table in this test file parameterizes
    // --locale per case (`--locale=${locale}`), so no single flag string is
    // ever literal — cited for context, not for the drift-detector's exact
    // per-flag match (see scenario-registry.test.mjs).
    name: 'admin-console-single-locale-ru-host-panel',
    flags: ['--mode=single', '--locale=ru', '--admin-console=host', '--admin-console-slug=panel', '--yes'],
    installBefore: true,
    skipVerify: true,
    postApplySteps: [
      ['--filter', 'shared', 'build'],
      ['--filter', 'web', 'build'],
    ],
    topology: 'single-locale (ru), console enabled, host topology, custom slug',
    citation: 'scripts/init-project-admin-console-single-locale.test.mjs:87-96',
  },
  {
    name: 'admin-console-single-locale-en-disabled',
    flags: ['--mode=single', '--locale=en', '--admin-console=disabled', '--yes'],
    installBefore: true,
    skipVerify: true,
    postApplySteps: [
      ['--filter', 'shared', 'build'],
      ['--filter', 'web', 'build'],
    ],
    topology: 'single-locale (en), console disabled',
    citation: 'scripts/init-project-admin-console-single-locale.test.mjs:87-96',
  },
]
