// Static inventory of the scaffolding suite's real install-bearing
// scenarios (BACKLOG item 14, PR1 §C). Every scenario's manual-verify
// command list and loop cardinality is *derived* from
// scripts/lib/scaffold-scenario-recipes.mjs — the exact same arrays the real
// end-to-end tests iterate over — instead of being retyped here, so this
// registry cannot drift from what the suite actually runs (BACKLOG item 14,
// PR1 correction: a hand-typed copy previously omitted a verify step and
// reordered the rest, undetected by either copy's own tests).
//
// Only `flags`/`installBefore`/`skipVerify`/`topology` for the three
// scenarios that use the CLI's own internal verify (no manual command list
// to share) remain hand-declared here; their citation is still checked by
// scenario-registry.test.mjs's drift detector.
import {
  STORYBOOK_MANUAL_VERIFY_STEPS,
  ADMIN_CONSOLE_VERIFY_STEPS,
  ADMIN_CONSOLE_ENABLED_TOPOLOGIES,
  ADMIN_CONSOLE_SINGLE_LOCALE_BUILD_STEPS,
  ADMIN_CONSOLE_SINGLE_LOCALE_REPRESENTATIVE_SCENARIOS,
} from '../lib/scaffold-scenario-recipes.mjs'

const CLI_VERIFIED_SCENARIOS = [
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
    topology:
      'multi-locale, Storybook removed — CLI verify is a documented no-op ' +
      '(init-project.mjs: `defaultVerify = flags.storybook ? () => [] : ...`)',
    citation: 'scripts/init-project-storybook.test.mjs:100-118',
  },
  {
    name: 'storybook-disabled-manual-verify-after',
    flags: ['--storybook=disabled', '--yes'],
    installBefore: false,
    installAfter: true,
    skipVerify: true,
    postApplySteps: STORYBOOK_MANUAL_VERIFY_STEPS,
    // postApplySteps is the shared STORYBOOK_MANUAL_VERIFY_STEPS recipe, not
    // a literal in this file — see scaffold-scenario-recipes.mjs.
    topology: 'multi-locale, Storybook removed, verified manually after the follow-up pnpm install',
    citation: 'scripts/init-project-storybook.test.mjs:133-141',
  },
]

const ADMIN_CONSOLE_SCENARIOS = ADMIN_CONSOLE_ENABLED_TOPOLOGIES.map(([mode, slug]) => ({
  name: `admin-console-${mode}-${slug}`,
  flags: [`--admin-console=${mode}`, `--admin-console-slug=${slug}`, '--yes'],
  installBefore: true,
  skipVerify: true,
  postApplySteps: ADMIN_CONSOLE_VERIFY_STEPS,
  topology: `multi-locale, console enabled, ${mode} topology, custom slug`,
  citation: 'scripts/init-project-admin-console.test.mjs (ADMIN_CONSOLE_ENABLED_TOPOLOGIES)',
}))

function singleLocaleName(locale, expected) {
  const mode = expected.mode ?? 'default'
  return `admin-console-single-locale-${locale}-${mode}${expected.slug ? `-${expected.slug}` : ''}`
}

const ADMIN_CONSOLE_SINGLE_LOCALE_SCENARIOS = ADMIN_CONSOLE_SINGLE_LOCALE_REPRESENTATIVE_SCENARIOS.map(
  ([locale, args, expected]) => ({
    name: singleLocaleName(locale, expected),
    flags: ['--mode=single', `--locale=${locale}`, ...args, '--yes'],
    installBefore: true,
    skipVerify: true,
    postApplySteps: ADMIN_CONSOLE_SINGLE_LOCALE_BUILD_STEPS,
    topology: `single-locale (${locale}), console ${expected.mode ?? 'enabled'}${expected.slug ? ', custom slug' : ''}`,
    citation:
      'scripts/init-project-admin-console-single-locale.test.mjs (ADMIN_CONSOLE_SINGLE_LOCALE_REPRESENTATIVE_SCENARIOS)',
  })
)

export const SCENARIOS = [
  ...CLI_VERIFIED_SCENARIOS,
  ...ADMIN_CONSOLE_SCENARIOS,
  ...ADMIN_CONSOLE_SINGLE_LOCALE_SCENARIOS,
]
