#!/usr/bin/env node
// `pnpm init:project` — one-time project choices for a downstream fork.
// Four independent dimensions, each with its own reinitialize
// guard, usable alone or in any combination:
//   --mode=single --locale=<code>   removes apps/web's locale routing (destructive)
//   --storybook=disabled            removes the Storybook surface entirely (destructive)
//   --route-progress=disabled       flips the route-progress bar's default off (non-destructive)
//   --admin-console=disabled|path|host chooses the console topology (destructive)
// Unlike init:brand, none is repeatable: re-running a dimension already
// applied is refused by its own assert* guard (see project-config.mjs,
// project-config-storybook.mjs, project-config-route-progress.mjs). Flag
// parsing/validation lives in project-flags.mjs (line-count guidance).
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInitCommand, runProjectVerification } from './lib/init-engine.mjs'
import { prismaFollowUpMessage } from './lib/project-config.mjs'
import { storybookInstallFollowUpMessage } from './lib/project-config-storybook.mjs'
import { DEFAULT_ADMIN_CONSOLE_SLUG } from './lib/project-config-admin-console.mjs'
import { parseProjectFlags, PROJECT_HELP } from './lib/project-flags.mjs'
import { prepareProjectInit } from './lib/project-init-plan.mjs'

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
  if (flags.help) {
    console.log(PROJECT_HELP)
    return
  }
  const adminConsoleSlug = flags['admin-console-slug'] ?? DEFAULT_ADMIN_CONSOLE_SLUG
  const { operationPlan, confirmMessage } = prepareProjectInit(ROOT, flags, adminConsoleSlug)

  if (flags.mode) {
    console.log(prismaFollowUpMessage(flags.locale))
    console.log()
  }
  if (flags.storybook) {
    console.log(storybookInstallFollowUpMessage())
    console.log()
  }

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
  await runInitCommand({
    cwd: ROOT,
    flags,
    operationPlan,
    confirmMessage,
    verify: testVerifyOverride ?? defaultVerify,
  })
}

main().catch((error) => {
  console.error(`init:project failed: ${error.message}`)
  process.exitCode = 1
})
