// Collects init:product's answers — from flags (non-interactive/scripted use,
// including a cold agent) or from @clack/prompts (interactive, TTY only).
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { EngineError, readMarkdownField } from './actions.mjs'
import { DEFAULT_TEAM_PROCESS, teamProcessError } from './team-process.mjs'
import { clack } from './init-engine.mjs'
import { validateAnswers } from './brand-validate.mjs'
import { productQuestions } from './product-questions.mjs'
const SETUP_LANGUAGE_OPTIONS = [
  { value: 'en', label: 'English' },
  { value: 'ru', label: 'Русский' },
]

const FLAG_TO_ANSWER = {
  locales: 'locales',
  'default-locale': 'defaultLocale',
  'name-en': 'nameEn',
  'name-ru': 'nameRu',
  'description-en': 'descriptionEn',
  'description-ru': 'descriptionRu',
  'theme-availability': 'themeAvailability',
  'route-progress': 'routeProgress',
  'console-mode': 'consoleMode',
  'ci-mode': 'ciMode',
  'workflow-reference': 'workflowReference',
  'team-process': 'teamProcess',
  'product-name': 'productName',
  purpose: 'purpose',
  'upstream-sync-policy': 'upstreamSyncPolicy',
  'workflow-mode': 'workflowMode',
  'theme-mode': 'themeMode',
  'package-name': 'packageName',
  'icon-192': 'icon192Src',
  'icon-512': 'icon512Src',
  'icon-512-maskable': 'icon512MaskableSrc',
}

export const BRAND_FLAG_OPTIONS = {
  ...Object.fromEntries(
    [...Object.keys(FLAG_TO_ANSWER), 'setup-language'].map((flag) => [flag, { type: 'string' }])
  ),
  'non-interactive': { type: 'boolean' },
  help: { type: 'boolean' },
}

/** `git describe` for a tagged commit, else the short SHA, else undefined (e.g. no git). */
export function detectAmcoreVersion(cwd) {
  const tryGit = (args) => {
    try {
      return execFileSync('git', args, {
        cwd,
        encoding: 'utf8',
        timeout: 5000,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim()
    } catch {
      return undefined
    }
  }
  return tryGit(['describe', '--tags', '--exact-match']) ?? tryGit(['rev-parse', '--short', 'HEAD'])
}

function answersFromFlags(flags) {
  const answers = {}
  for (const [flag, key] of Object.entries(FLAG_TO_ANSWER)) {
    if (flags[flag] !== undefined) answers[key] = flags[flag]
  }
  return answers
}

export async function collectAnswers({ root, flags }) {
  const amcoreVersion = detectAmcoreVersion(root)
  const interactive = process.stdin.isTTY && process.stdout.isTTY && !flags['non-interactive']
  const answers = answersFromFlags(flags)
  let language = flags['setup-language']
  if (language && !SETUP_LANGUAGE_OPTIONS.some(({ value }) => value === language))
    throw new Error('Expected setup language en or ru')
  if (!language && interactive) {
    clack.note('Setup language / Язык настройки')
    language = await clack.select({
      message: 'Choose an option / Выберите вариант',
      options: SETUP_LANGUAGE_OPTIONS,
      initialValue: 'en',
    })
    if (clack.isCancel(language)) process.exit(1)
  }
  const tr = (en, ru) => (language === 'ru' ? ru : en)
  if (answers.teamProcess !== undefined) {
    const error = teamProcessError(root, answers.teamProcess, tr)
    if (error) throw new EngineError(`--team-process: ${error}`)
  }
  if (interactive) await productQuestions(root, answers, language ?? 'en')
  const context = readFileSync(join(root, 'PROJECT_CONTEXT.md'), 'utf8')
  if (readMarkdownField(context, 'Mode')?.includes('upstream-starter'))
    answers.teamProcess ??= DEFAULT_TEAM_PROCESS
  validateAnswers(answers, language)
  return { ...answers, amcoreVersion, language: language ?? 'en', interactive }
}
