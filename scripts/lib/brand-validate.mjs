import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { readPngDimensions, EngineError } from './actions.mjs'
import { WORKFLOW_MODES, THEME_MODES, THEME_PERSISTENCE_MODES } from './brand-config.mjs'

const ENUM_ANSWERS = [
  { key: 'workflowMode', allowed: WORKFLOW_MODES, flag: '--workflow-mode' },
  { key: 'themeMode', allowed: THEME_MODES, flag: '--theme-mode' },
  { key: 'themePersistence', allowed: THEME_PERSISTENCE_MODES, flag: '--theme-persistence' },
]

const SINGLE_LINE_ANSWERS = [
  'productName',
  'purpose',
  'productDescription',
  'upstreamSyncPolicy',
  'packageName',
]

// npm's own package-name rule (see npm/validate-npm-package-name), applied
// here because the prompt promises "npm-safe" and a flag must not be able
// to bypass that promise: lowercase, URL-safe characters, optional scope.
const NPM_PACKAGE_NAME = /^(?:@[a-z0-9-*~][a-z0-9-*._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/

/**
 * Fails closed on anything a flag can smuggle past the interactive
 * prompts' own constraints: an out-of-range enum value, a newline in a
 * field every downstream target (a markdown bullet, a TS string literal)
 * treats as single-line, or a `packageName` that isn't a valid npm package
 * name (the prompt promises "npm-safe").
 */
export function validateAnswers(answers) {
  for (const { key, allowed, flag } of ENUM_ANSWERS) {
    if (answers[key] !== undefined && !allowed.includes(answers[key])) {
      throw new EngineError(`${flag}=${answers[key]} is not one of: ${allowed.join(', ')}`)
    }
  }
  for (const key of SINGLE_LINE_ANSWERS) {
    if (typeof answers[key] === 'string' && /[\r\n]/.test(answers[key])) {
      throw new EngineError(`"${key}" cannot contain a newline`)
    }
  }
  if (answers.packageName !== undefined) {
    if (answers.packageName.length > 214 || !NPM_PACKAGE_NAME.test(answers.packageName)) {
      throw new EngineError(
        `--package-name=${answers.packageName} is not a valid npm package name ` +
          '(lowercase, URL-safe characters only, optionally scoped as @scope/name)'
      )
    }
  }
}

/** Fails closed with a concrete message rather than a raw fs/decode error. */
export function validatePngSource(srcPath, expected) {
  if (!existsSync(srcPath)) {
    throw new EngineError(`file not found: ${srcPath}`)
  }
  if (path.extname(srcPath).toLowerCase() !== '.png') {
    throw new EngineError(`expected a .png file, got: ${srcPath}`)
  }
  if (!expected) return
  const { width, height } = readPngDimensions(readFileSync(srcPath))
  if (width !== expected.width || height !== expected.height) {
    throw new EngineError(
      `${srcPath} is ${width}x${height}, expected ${expected.width}x${expected.height} — ` +
        'see apps/web/public/icons/README.md'
    )
  }
}
