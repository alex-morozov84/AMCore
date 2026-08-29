#!/usr/bin/env node
// `pnpm init:project` (Track 10, ADR-071) — one-time, destructive structural
// transforms for a downstream fork. See ai/models-talk.md's FINAL PLAN and
// ai/decisions/adr-071-*.md for the full design. Two independent dimensions,
// each with its own reinitialize guard, usable alone or together:
//   --mode=single --locale=<code>   removes apps/web's locale routing
//   --storybook=disabled            removes the Storybook surface entirely
// Unlike init:brand, neither is repeatable: re-running a dimension already
// applied is refused by its own assert* guard (see project-config.mjs and
// project-config-storybook.mjs).
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  EngineError,
  parseCommonFlags,
  runInitCommand,
  runProjectVerification,
} from './lib/init-engine.mjs'
import {
  PROJECT_MODES,
  assertKnownLocale,
  assertMultiLocaleAppStructure,
  prismaFollowUpMessage,
} from './lib/project-config.mjs'
import {
  STORYBOOK_VALUES,
  assertStorybookEnabled,
  storybookInstallFollowUpMessage,
} from './lib/project-config-storybook.mjs'
import { buildProjectSteps } from './lib/project-plan.mjs'
import { buildStorybookDisableSteps } from './lib/project-plan-storybook.mjs'
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

function parseProjectFlags(argv) {
  const flags = parseCommonFlags(argv, {
    mode: { type: 'string' },
    locale: { type: 'string' },
    storybook: { type: 'string' },
  })

  if (!flags.mode && !flags.storybook) {
    throw new EngineError(
      'at least one of --mode or --storybook is required, e.g. --mode=single --locale=en, ' +
        'or --storybook=disabled, or both together'
    )
  }

  if (flags.mode) {
    if (!PROJECT_MODES.includes(flags.mode)) {
      throw new EngineError(`--mode=${flags.mode} is not one of: ${PROJECT_MODES.join(', ')}`)
    }
    if (!flags.locale) {
      throw new EngineError('--locale is required when --mode is given, e.g. --locale=en')
    }
  }

  if (flags.storybook && !STORYBOOK_VALUES.includes(flags.storybook)) {
    throw new EngineError(
      `--storybook=${flags.storybook} is not one of: ${STORYBOOK_VALUES.join(', ')}`
    )
  }

  return flags
}

async function main() {
  const flags = parseProjectFlags(process.argv.slice(2))

  if (flags.mode) {
    assertKnownLocale(ROOT, flags.locale)
    assertMultiLocaleAppStructure(ROOT)
  }
  if (flags.storybook) {
    assertStorybookEnabled(ROOT)
  }

  // --mode and --storybook, when both given, each independently want to
  // edit PROJECT_CONTEXT.md and apps/web/eslint.config.mjs — see
  // project-plan-combined.mjs's header. Drop those targets from each
  // dimension's own steps and use the combined replacement instead.
  const both = Boolean(flags.mode && flags.storybook)
  const overlap = both ? new Set(combinedTargets(ROOT)) : new Set()

  const steps = [
    ...(flags.mode
      ? buildProjectSteps(ROOT, { locale: flags.locale }).filter((s) => !overlap.has(s.target))
      : []),
    ...(flags.storybook
      ? buildStorybookDisableSteps(ROOT).filter((s) => !overlap.has(s.target))
      : []),
    ...(both ? buildCombinedSteps(ROOT, flags.locale) : []),
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
  ].filter(Boolean)

  // --storybook edits apps/web/package.json's dependency list, which
  // leaves pnpm-lock.yaml stale the moment apply writes — automated
  // typecheck/lint/build/test would fail on that mismatch before doing any
  // real work, not because the transform is wrong. Skipped in favor of the
  // printed manual follow-up above; see storybookInstallFollowUpMessage's
  // doc comment for why running `pnpm install` here isn't the fix either.
  const defaultVerify = flags.storybook ? () => [] : runProjectVerification

  await runInitCommand({
    cwd: ROOT,
    flags,
    steps,
    confirmMessage:
      `Apply the ${dimensions.join(' + ')} transform? ` +
      'This moves/deletes files and cannot be undone by re-running this command.',
    verify: testVerifyOverride ?? defaultVerify,
  })
}

main().catch((error) => {
  console.error(`init:project failed: ${error.message}`)
  process.exitCode = 1
})
