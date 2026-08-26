// Shared engine for the Track 10 init tooling (ADR-071): common flags,
// plan+diff printing, and the apply orchestration (safety guards -> confirm
// -> write -> verify). `init-brand.mjs` (and later `init-project.mjs`)
// build a plan with `plan-steps.mjs`/`actions.mjs` and hand it to
// `runInitCommand`.
import { parseArgs } from 'node:util'
import * as clack from '@clack/prompts'
import { assertCleanGitTree, assertNotMaintainerCheckout, SafetyError } from './safety.mjs'
import { unifiedDiff } from './diff.mjs'
import { runVerification } from './verify.mjs'

export * from './actions.mjs'
export * from './content-blocks.mjs'
export * from './plan-steps.mjs'
export { SafetyError, clack, runVerification }

export function parseCommonFlags(argv, extraOptions = {}) {
  const { values } = parseArgs({
    args: argv,
    options: {
      'dry-run': { type: 'boolean', default: false },
      yes: { type: 'boolean', default: false },
      'force-maintainer-checkout': { type: 'string' },
      ...extraOptions,
    },
    strict: true,
    allowPositionals: false,
  })
  return values
}

export function printPlan(steps) {
  const changed = steps.filter((step) => step.changed)
  if (changed.length === 0) {
    console.log('Nothing to do — every value already matches.')
    return changed
  }
  console.log(`Plan (${changed.length} change(s)):`)
  for (const step of changed) {
    console.log(`  - [${step.kind}] ${step.target}: ${step.summary}`)
    if (step.kind === 'edit') {
      console.log(
        indent(
          unifiedDiff(step.before, step.after, { fromLabel: step.target, toLabel: step.target })
        )
      )
    }
  }
  return changed
}

function indent(text) {
  return text
    .split('\n')
    .map((line) => `      ${line}`)
    .join('\n')
}

function reportVerification(results) {
  console.log('\nRunning post-apply verification...')
  for (const result of results) {
    console.log(`  - ${result.label}: ${result.ok ? 'OK' : 'FAILED'}`)
    if (!result.ok) console.log(indent(result.output))
  }
  if (results.some((result) => !result.ok)) {
    console.log('\nVerification failed — review the changes above before committing.')
    process.exitCode = 1
  }
}

/**
 * Prints the plan (with diffs), then — unless `--dry-run` — runs the
 * apply-mode safety guards, confirms (unless `--yes`), writes, and runs
 * `verify`. `--dry-run` returns before any guard runs, so it is always
 * safe, including in the AMCore maintainer checkout.
 */
export async function runInitCommand({
  cwd,
  flags,
  steps,
  confirmMessage,
  verify = runVerification,
}) {
  const changed = printPlan(steps)
  if (changed.length === 0) return
  if (flags['dry-run']) {
    console.log('\n--dry-run: no files were written.')
    return
  }

  assertCleanGitTree(cwd)
  assertNotMaintainerCheckout(cwd, flags['force-maintainer-checkout'])

  if (!flags.yes) {
    const ok = await clack.confirm({ message: confirmMessage ?? 'Apply these changes?' })
    if (clack.isCancel(ok) || !ok) {
      console.log('Aborted — no files were written.')
      return
    }
  }

  for (const step of changed) step.write()
  console.log(`\nApplied ${changed.length} change(s).`)
  reportVerification(verify(cwd))
}
