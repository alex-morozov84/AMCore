// Collects init:brand's answers — from flags (non-interactive/scripted use,
// including a cold agent) or from @clack/prompts (interactive, TTY only).
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { clack, readMarkdownField, readCapturedField } from './init-engine.mjs'
import {
  resolvePaths,
  WORKFLOW_MODES,
  THEME_MODES,
  THEME_PERSISTENCE_MODES,
} from './brand-config.mjs'
import { validateAnswers } from './brand-validate.mjs'

const FLAG_TO_ANSWER = {
  'product-name': 'productName',
  purpose: 'purpose',
  'product-description': 'productDescription',
  'upstream-sync-policy': 'upstreamSyncPolicy',
  'workflow-mode': 'workflowMode',
  'theme-mode': 'themeMode',
  'theme-persistence': 'themePersistence',
  'package-name': 'packageName',
  'logo-dark': 'logoDarkSrc',
  'logo-light': 'logoLightSrc',
  'icon-192': 'icon192Src',
  'icon-512': 'icon512Src',
  'icon-512-maskable': 'icon512MaskableSrc',
}

export const BRAND_FLAG_OPTIONS = Object.fromEntries(
  Object.keys(FLAG_TO_ANSWER).map((flag) => [flag, { type: 'string' }])
)

export function hasAnyValueFlag(flags) {
  return Object.keys(FLAG_TO_ANSWER).some((flag) => flags[flag] !== undefined)
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
  const answers =
    !process.stdin.isTTY || hasAnyValueFlag(flags)
      ? answersFromFlags(flags)
      : await promptAnswers(root)
  validateAnswers(answers)
  return { ...answers, amcoreVersion }
}

async function promptAnswers(root) {
  const paths = resolvePaths(root)
  const context = readFileSync(paths.projectContext, 'utf8')
  const manifest = readFileSync(paths.manifest, 'utf8')

  clack.intro('AMCore — init:brand')
  const raw = await clack.group(
    {
      productName: () =>
        clack.text({
          message: 'Product name (leave empty to keep current)',
          initialValue: readMarkdownField(context, 'Product'),
        }),
      productDescription: () =>
        clack.text({
          message: 'Product description / PWA tagline (leave empty to keep current)',
          initialValue: readCapturedField(manifest, /description: '((?:[^'\\]|\\.)*)',/),
        }),
      purpose: () =>
        clack.text({
          message: 'Purpose, one sentence (leave empty to keep current)',
          initialValue: readMarkdownField(context, 'Purpose'),
        }),
      upstreamSyncPolicy: () =>
        clack.text({
          message:
            'Upstream sync policy — how/whether you pull AMCore updates (leave empty to keep current)',
          initialValue: readMarkdownField(context, 'Upstream sync policy'),
        }),
      workflowMode: () =>
        clack.select({
          message: 'Workflow mode',
          options: optionsOf(WORKFLOW_MODES),
          initialValue: 'strict',
        }),
      themeMode: () =>
        clack.select({
          message: 'Theme mode',
          options: optionsOf(THEME_MODES),
          initialValue: 'system',
        }),
      themePersistence: () =>
        clack.select({
          message: 'Theme persistence strategy',
          options: optionsOf(THEME_PERSISTENCE_MODES),
          initialValue: 'local-storage',
        }),
      packageName: () =>
        clack.text({ message: 'Root package.json name (npm-safe, leave empty to keep current)' }),
      logoDarkSrc: () =>
        clack.text({ message: 'New logo-dark.png source path (leave empty to skip)' }),
      logoLightSrc: () =>
        clack.text({ message: 'New logo-light.png source path (leave empty to skip)' }),
      icon192Src: () =>
        clack.text({ message: 'New icon-192x192.png source path (leave empty to skip)' }),
      icon512Src: () =>
        clack.text({ message: 'New icon-512x512.png source path (leave empty to skip)' }),
      icon512MaskableSrc: () =>
        clack.text({ message: 'New icon-512x512-maskable.png source path (leave empty to skip)' }),
    },
    {
      onCancel: () => {
        clack.cancel('Cancelled.')
        process.exit(1)
      },
    }
  )
  for (const key of Object.keys(raw)) {
    if (raw[key] === '') delete raw[key]
  }
  return raw
}

function optionsOf(values) {
  return values.map((value) => ({ value, label: value }))
}
