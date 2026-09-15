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

function printFollowUp(flags) {
  if (flags.mode) {
    console.log(prismaFollowUpMessage(flags.locale))
    console.log()
  }
  if (flags.storybook) {
    console.log(storybookInstallFollowUpMessage())
    console.log()
  }
}

// --storybook leaves pnpm-lock.yaml stale, so verification follows the manual
// install requested by storybookInstallFollowUpMessage instead.
function buildVerification(flags, assertApplied) {
  const defaultVerify = flags.storybook ? () => [] : runProjectVerification
  return (root) => {
    assertApplied()
    return (testVerifyOverride ?? defaultVerify)(root)
  }
}

// --route-progress is non-destructive: it changes only a source flag and the
// matching context record, so its confirm message does not claim irreversibility.
async function main() {
  const flags = parseProjectFlags(process.argv.slice(2))
  if (flags.help) {
    console.log(PROJECT_HELP)
    return
  }
  const slug = flags['admin-console-slug'] ?? DEFAULT_ADMIN_CONSOLE_SLUG
  const { operationPlan, confirmMessage, assertApplied } = prepareProjectInit(ROOT, flags, slug)
  printFollowUp(flags)
  await runInitCommand({
    cwd: ROOT,
    flags,
    operationPlan,
    confirmMessage,
    verify: buildVerification(flags, assertApplied),
  })
}

main().catch((error) => {
  console.error(`init:project failed: ${error.message}`)
  process.exitCode = 1
})
