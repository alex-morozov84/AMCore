// Shared engine for the Track 10 init tooling (ADR-071): common flags,
// plan+diff printing, and the apply orchestration (safety guards -> confirm
// -> one filesystem transaction -> verify). The CLI hands a completely
// materialized plan to `runInitCommand` before anything is written.
import { parseArgs } from 'node:util'
import * as clack from '@clack/prompts'
import { assertCleanGitTree, assertNotMaintainerCheckout, SafetyError } from './safety.mjs'
import { unifiedDiff } from './diff.mjs'
import { runVerification } from './verify.mjs'
import { applyFilesystemTransaction } from './filesystem-transaction.mjs'

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

export function printPlan(steps, ru = false) {
  const changed = steps.filter((step) => step.changed)
  if (changed.length === 0) {
    console.log(
      ru
        ? 'Изменений нет. Проверки не запускались.'
        : 'Nothing to do — every value already matches.'
    )
    return changed
  }
  console.log(ru ? `План. Изменений: ${changed.length}` : `Plan (${changed.length} change(s)):`)
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

function reportVerification(results, ru) {
  console.log(ru ? '\nПроверка записанных настроек…' : '\nRunning post-apply verification...')
  for (const result of results) {
    console.log(`  - ${result.label}: ${result.ok ? 'OK' : 'FAILED'}`)
    if (!result.ok) console.log(indent(result.output))
  }
  if (results.some((result) => !result.ok)) {
    console.log(
      ru
        ? '\nПроверка не прошла. Файлы записаны. Исправьте ошибки и повторите проверку.'
        : '\nVerification failed — review the changes above before committing.'
    )
    process.exitCode = 1
  }
}

async function chooseProductAction(question, steps, ru) {
  while (true) {
    clack.note(question)
    const choice = await clack.select({
      message: ru ? 'Выберите вариант' : 'Choose an option',
      initialValue: 'cancel',
      showInstructions: !ru,
      options: [
        { value: 'apply', label: ru ? 'Применить настройки' : 'Apply settings' },
        { value: 'diff', label: ru ? 'Показать изменения в файлах' : 'Show file changes' },
        { value: 'cancel', label: ru ? 'Выйти без записи' : 'Exit without writing' },
      ],
    })
    if (choice !== 'diff') return choice === 'apply'
    printPlan(steps, ru)
  }
}

export async function runInitCommand({
  cwd,
  flags,
  operationPlan,
  language,
  requireConsentFlag = false,
  onSuccess,
  confirmMessage,
  verify = runVerification,
  applyFilesystem = applyFilesystemTransaction,
  requestConfirmation = clack.confirm,
  isCancellation = clack.isCancel,
}) {
  const plan = operationPlan
  if (!plan) throw new Error('runInitCommand requires a complete operationPlan')
  const ru = language === 'ru'
  const useProductMenu = Boolean(language && !requireConsentFlag && !flags.yes && !flags['dry-run'])
  const changed = plan.displaySteps.filter((step) => step.changed)
  if (!useProductMenu || changed.length === 0) printPlan(plan.displaySteps, ru)
  if (changed.length === 0) return
  if (flags['dry-run']) {
    console.log(ru ? '\nПредпросмотр. Файлы не изменены.' : '\n--dry-run: no files were written.')
    return
  }

  if (requireConsentFlag && !flags.yes)
    throw new Error(
      ru ? 'Для записи без вопросов добавьте --yes.' : 'Use --yes to apply without prompts.'
    )
  assertCleanGitTree(cwd)
  assertNotMaintainerCheckout(cwd, flags['force-maintainer-checkout'])

  if (!flags.yes) {
    const question = confirmMessage ?? 'Apply these changes?'
    const ok = useProductMenu
      ? await chooseProductAction(question, changed, ru)
      : await requestConfirmation({ message: question })
    if (isCancellation(ok) || !ok) {
      console.log(ru ? 'Отменено. Файлы не изменены.' : 'Aborted — no files were written.')
      return
    }
  }

  if (plan.assertFresh) {
    plan.assertFresh()
    assertCleanGitTree(cwd)
  }
  applyFilesystem({ root: cwd, operations: plan.operationsForApply() })
  console.log(
    ru ? `\nЗаписано изменений: ${changed.length}.` : `\nApplied ${changed.length} change(s).`
  )
  const results = verify(cwd)
  reportVerification(results, ru)
  if (results.every((result) => result.ok)) onSuccess?.()
}
