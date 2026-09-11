#!/usr/bin/env node
// `pnpm init:project` — one-time project choices for a downstream fork.
// Three independent dimensions, each with its own reinitialize
// guard, usable alone or in any combination:
//   --mode=single --locale=<code>   removes apps/web's locale routing (destructive)
//   --storybook=disabled            removes the Storybook surface entirely (destructive)
//   --route-progress=disabled       flips the route-progress bar's default off (non-destructive)
// Unlike init:brand, none is repeatable: re-running a dimension already
// applied is refused by its own assert* guard (see project-config.mjs,
// project-config-storybook.mjs, project-config-route-progress.mjs). Flag
// parsing/validation lives in project-flags.mjs (line-count guidance).
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInitCommand, runProjectVerification } from './lib/init-engine.mjs'
import {
  assertKnownLocale,
  assertMultiLocaleAppStructure,
  prismaFollowUpMessage,
} from './lib/project-config.mjs'
import {
  assertStorybookEnabled,
  storybookInstallFollowUpMessage,
} from './lib/project-config-storybook.mjs'
import { assertRouteProgressEnabled } from './lib/project-config-route-progress.mjs'
import { parseProjectFlags } from './lib/project-flags.mjs'
import { buildProjectSteps } from './lib/project-plan.mjs'
import { buildStorybookDisableSteps } from './lib/project-plan-storybook.mjs'
import { buildRouteProgressFlagSteps } from './lib/project-plan-route-progress-flag.mjs'
import { buildRouteProgressContextSteps } from './lib/project-plan-route-progress-context.mjs'
import { combinedTargets, buildCombinedSteps } from './lib/project-plan-combined.mjs'

// Testability seams for scripts/*.test.mjs — see init-brand.mjs's header for
// why these three are inert unless NODE_ENV=test is also set.
const isTestEnv = process.env.NODE_ENV === 'test'

const ROOT =
  isTestEnv && process.env.AMCORE_INIT_ROOT
    ? path.resolve(process.env.AMCORE_INIT_ROOT)
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const testVerifyOverride =
  isTestEnv && process.env.AMCORE_INIT_FAKE_VERIFY_FAIL
    ? () => [{ label: 'fake', ok: false, output: 'boom' }]
    : isTestEnv && process.env.AMCORE_INIT_SKIP_VERIFY
      ? () => []
      : undefined

async function main() {
  const flags = parseProjectFlags(process.argv.slice(2))
  const routeProgress = Boolean(flags['route-progress'])

  if (flags.mode) {
    assertKnownLocale(ROOT, flags.locale)
    assertMultiLocaleAppStructure(ROOT)
  }
  if (flags.storybook) {
    assertStorybookEnabled(ROOT)
  }
  if (routeProgress) {
    assertRouteProgressEnabled(ROOT)
  }

  // Whenever 2+ dimensions are active, each independently wants to edit one
  // or more of the same shared targets (PROJECT_CONTEXT.md; apps/web/
  // eslint.config.mjs for --mode + --storybook specifically) — see
  // project-plan-combined.mjs's header. Drop those targets from each
  // dimension's own steps and use the combined replacement instead.
  const dims = {
    locale: flags.mode ? flags.locale : undefined,
    storybook: flags.storybook,
    routeProgress,
  }
  const overlap = new Set(combinedTargets(ROOT, dims))

  const steps = [
    ...(flags.mode
      ? buildProjectSteps(ROOT, { locale: flags.locale }).filter((s) => !overlap.has(s.target))
      : []),
    ...(flags.storybook
      ? buildStorybookDisableSteps(ROOT).filter((s) => !overlap.has(s.target))
      : []),
    ...(routeProgress
      ? [
          ...buildRouteProgressFlagSteps(ROOT),
          ...buildRouteProgressContextSteps(ROOT).filter((s) => !overlap.has(s.target)),
        ]
      : []),
    ...buildCombinedSteps(ROOT, dims),
  ]

  if (flags.mode) {
    console.log(prismaFollowUpMessage(flags.locale))
    console.log()
  }
  if (flags.storybook) {
    console.log(storybookInstallFollowUpMessage())
    console.log()
  }

  const dimensions = [
    flags.mode && `single-locale (--locale=${flags.locale})`,
    flags.storybook && 'Storybook-disable',
    routeProgress && 'route-progress-disable',
  ].filter(Boolean)

  // --storybook edits apps/web/package.json's dependency list, which
  // leaves pnpm-lock.yaml stale the moment apply writes — automated
  // typecheck/lint/build/test would fail on that mismatch before doing any
  // real work, not because the transform is wrong. Skipped in favor of the
  // printed manual follow-up above; see storybookInstallFollowUpMessage's
  // doc comment for why running `pnpm install` here isn't the fix either.
  const defaultVerify = flags.storybook ? () => [] : runProjectVerification

  // --route-progress is non-destructive (owner decision, 2026-09-09): no
  // file is moved or deleted, only a source flag's value and a context
  // record. The confirm message says so explicitly rather than reusing the
  // other two dimensions' "cannot be undone" wording, which would be untrue
  // for a --route-progress-only apply.
  const destructive = Boolean(flags.mode || flags.storybook)
  const confirmMessage = destructive
    ? `Apply the ${dimensions.join(' + ')} transform? ` +
      'This moves/deletes files and cannot be undone by re-running this command.'
    : `Apply the ${dimensions.join(' + ')} transform? ` +
      'This only edits a source flag and PROJECT_CONTEXT.md — reversible by hand at any time.'

  await runInitCommand({
    cwd: ROOT,
    flags,
    steps,
    confirmMessage,
    verify: testVerifyOverride ?? defaultVerify,
  })
}

main().catch((error) => {
  console.error(`init:project failed: ${error.message}`)
  process.exitCode = 1
})
