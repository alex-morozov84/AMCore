#!/usr/bin/env node
// `pnpm init:product` (Track 10, ADR-071) — repeatable, non-destructive brand/
// identity initializer for a downstream fork. The public safety and extension
// contract lives in docs/frontend/brand-theme-and-tokens.md.
import { readFileSync } from 'node:fs'
import { readMarkdownField } from './lib/actions.mjs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseCommonFlags, runInitCommand } from './lib/init-engine.mjs'
import { collectAnswers, BRAND_FLAG_OPTIONS } from './lib/brand-fields.mjs'
import { printProductSummary } from './lib/product-summary.mjs'
import { prepareBrandInit } from './lib/brand-init-plan.mjs'

// Testability seams for scripts/*.test.mjs: AMCORE_INIT_ROOT points the real
// entrypoint at a disposable fixture tree; AMCORE_INIT_SKIP_VERIFY skips
// pnpm typecheck/lint, which can't run meaningfully against a fixture that
// isn't a real pnpm/turbo workspace; AMCORE_INIT_FAKE_VERIFY_FAIL exercises
// the "verification failed" reporting/exit-code path without a real broken
// workspace. All three are inert unless NODE_ENV=test is also set, so they
// can't act as a real-run backdoor around the actual repo or verification.
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

async function main() {
  const flags = parseCommonFlags(process.argv.slice(2), BRAND_FLAG_OPTIONS)
  if (flags.help) {
    console.log(
      flags['setup-language'] === 'ru'
        ? 'pnpm init:product [--setup-language en|ru] [--non-interactive] [--dry-run|--yes]\nПараметры: docs/frontend/brand-theme-and-tokens.md#scripted-initialization'
        : 'pnpm init:product [--setup-language en|ru] [--non-interactive] [--dry-run|--yes]\nOptions: docs/frontend/brand-theme-and-tokens.md#scripted-initialization'
    )
    return
  }
  const answers = await collectAnswers({ root: ROOT, flags })
  const context = readFileSync(path.join(ROOT, 'PROJECT_CONTEXT.md'), 'utf8')
  if (
    answers.workflowMode === 'custom' &&
    !(answers.workflowReference || readMarkdownField(context, 'Workflow reference'))
  )
    throw new Error(
      answers.language === 'ru'
        ? 'Укажите путь или ссылку на правила команды.'
        : 'Provide --workflow-reference for a custom workflow.'
    )
  if (
    answers.interactive &&
    readMarkdownField(context, 'Mode')?.includes('upstream-starter') &&
    !(answers.productName || answers.nameEn || answers.nameRu)
  )
    throw new Error(
      answers.language === 'ru' ? 'Введите название продукта.' : 'Enter a product name.'
    )
  const { operationPlan } = prepareBrandInit(ROOT, { ...answers, productSetup: true })
  printProductSummary(ROOT, answers, operationPlan)
  await runInitCommand({
    cwd: ROOT,
    flags,
    operationPlan,
    confirmMessage:
      answers.language === 'ru' ? 'Применить настройки?' : 'Apply these product settings?',
    language: answers.language,
    requireConsentFlag: !answers.interactive,
    onSuccess: () =>
      console.log(
        answers.language === 'ru'
          ? 'Настройки записаны. Запустите Docker, выполните pnpm local из корня проекта и откройте адрес из терминала.'
          : 'Settings saved. Start Docker, run pnpm local from the project root, and open the printed address.'
      ),
    ...(verify ? { verify } : {}),
  })
}

main().catch((error) => {
  console.error(`init:product failed: ${error.message}`)
  process.exitCode = 1
})
