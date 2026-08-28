#!/usr/bin/env node
// `pnpm init:project --mode=single --locale=<code>` (Track 10, ADR-071) — the
// one-time, destructive structural transform that removes locale routing
// from a downstream fork. See ai/models-talk.md's FINAL PLAN and
// ai/decisions/adr-071-*.md for the full design. Unlike init:brand, this is
// not repeatable: re-running after a successful apply is refused by
// assertMultiLocaleAppStructure (see its doc comment).
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
import { buildProjectSteps } from './lib/project-plan.mjs'

// Testability seams for scripts/*.test.mjs — see init-brand.mjs's header for
// why these three are inert unless NODE_ENV=test is also set.
const isTestEnv = process.env.NODE_ENV === 'test'

const ROOT =
  isTestEnv && process.env.AMCORE_INIT_ROOT
    ? path.resolve(process.env.AMCORE_INIT_ROOT)
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const verify =
  isTestEnv && process.env.AMCORE_INIT_FAKE_VERIFY_FAIL
    ? () => [{ label: 'fake', ok: false, output: 'boom' }]
    : isTestEnv && process.env.AMCORE_INIT_SKIP_VERIFY
      ? () => []
      : undefined

function parseProjectFlags(argv) {
  const flags = parseCommonFlags(argv, {
    mode: { type: 'string' },
    locale: { type: 'string' },
  })
  if (!flags.mode) throw new EngineError('--mode is required, e.g. --mode=single')
  if (!PROJECT_MODES.includes(flags.mode)) {
    throw new EngineError(`--mode=${flags.mode} is not one of: ${PROJECT_MODES.join(', ')}`)
  }
  if (!flags.locale) throw new EngineError('--locale is required, e.g. --locale=en')
  return flags
}

async function main() {
  const flags = parseProjectFlags(process.argv.slice(2))
  assertKnownLocale(ROOT, flags.locale)
  assertMultiLocaleAppStructure(ROOT)
  const steps = buildProjectSteps(ROOT, { locale: flags.locale })

  console.log(prismaFollowUpMessage(flags.locale))
  console.log()

  await runInitCommand({
    cwd: ROOT,
    flags,
    steps,
    confirmMessage:
      `Apply the single-locale (--locale=${flags.locale}) transform? ` +
      'This moves and deletes many apps/web files and cannot be undone by re-running this command.',
    verify: verify ?? runProjectVerification,
  })
}

main().catch((error) => {
  console.error(`init:project failed: ${error.message}`)
  process.exitCode = 1
})
