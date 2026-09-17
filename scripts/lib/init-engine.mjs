// Shared engine for the Track 10 init tooling (ADR-071): common flags,
// plan+diff printing, and the apply orchestration (safety guards -> confirm
// -> one filesystem transaction -> verify). Both CLIs hand a completely
// materialized plan to `runInitCommand` before anything is written.
import { parseArgs } from 'node:util'
import * as clack from '@clack/prompts'
import { assertCleanGitTree, assertNotMaintainerCheckout, SafetyError } from './safety.mjs'
import { unifiedDiff } from './diff.mjs'
import { runVerification, runProjectVerification } from './verify.mjs'
import { applyFilesystemTransaction } from './filesystem-transaction.mjs'

export { SafetyError, clack, runVerification, runProjectVerification }

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
  operationPlan,
  confirmMessage,
  verify = runVerification,
  applyFilesystem = applyFilesystemTransaction,
  requestConfirmation = clack.confirm,
  isCancellation = clack.isCancel,
}) {
  const plan = operationPlan
  if (!plan) throw new Error('runInitCommand requires a complete operationPlan')
  const changed = printPlan(plan.displaySteps)
  if (changed.length === 0) return
  if (flags['dry-run']) {
    console.log('\n--dry-run: no files were written.')
    return
  }

  assertCleanGitTree(cwd)
  assertNotMaintainerCheckout(cwd, flags['force-maintainer-checkout'])

  if (!flags.yes) {
    const ok = await requestConfirmation({ message: confirmMessage ?? 'Apply these changes?' })
    if (isCancellation(ok) || !ok) {
      console.log('Aborted — no files were written.')
      return
    }
  }

  applyFilesystem({ root: cwd, operations: plan.operationsForApply() })
  console.log(`\nApplied ${changed.length} change(s).`)
  reportVerification(verify(cwd))
}
