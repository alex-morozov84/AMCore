// init:brand steps for package.json, apps/web's PWA manifest, the en/ru
// message catalogues (app/layout.tsx's actual metadata source — see
// ai/models-talk.md), and the theme-mode constant.
import {
  fileStep,
  linePatchesTransform,
  jsonPatchTransform,
  escapeTsSingleQuoteInner,
} from './init-engine.mjs'
import { resolvePaths } from './brand-config.mjs'

export function buildPackageJsonSteps(root, answers) {
  const { rootPackageJson } = resolvePaths(root)
  const patches = {}
  if (answers.packageName) patches.name = answers.packageName
  if (answers.productDescription) patches.description = answers.productDescription
  if (Object.keys(patches).length === 0) return []
  return [
    fileStep(
      rootPackageJson,
      jsonPatchTransform(patches),
      `update ${Object.keys(patches).join(', ')}`
    ),
  ]
}

// Matches the *escaped* content of an existing single-quoted TS literal:
// a run of (non-quote, non-backslash) chars or (backslash + any char —
// i.e. an escape sequence) repeated. A naive `[^']*` stops at the first
// escaped quote a previous run wrote (e.g. `Bob\'s App`), which breaks
// re-running init:brand on any value containing an apostrophe.
const tsFieldRegex = (name) => new RegExp(`^\\s*${name}: '((?:[^'\\\\]|\\\\.)*)',$`, 'm')

export function buildManifestSteps(root, answers) {
  const { manifest } = resolvePaths(root)
  const ops = []
  if (answers.productName) {
    const escaped = escapeTsSingleQuoteInner(answers.productName)
    ops.push({ regex: tsFieldRegex('name'), value: escaped })
    ops.push({ regex: tsFieldRegex('short_name'), value: escaped })
  }
  if (answers.productDescription) {
    ops.push({
      regex: tsFieldRegex('description'),
      value: escapeTsSingleQuoteInner(answers.productDescription),
    })
  }
  if (ops.length === 0) return []
  return [fileStep(manifest, linePatchesTransform(ops), 'update PWA name/short_name/description')]
}

export function buildMessagesSteps(root, answers) {
  const { enMessages, ruMessages } = resolvePaths(root)
  const steps = []

  const enPatches = {}
  if (answers.productName) enPatches['meta.title'] = answers.productName
  if (answers.productDescription) enPatches['meta.description'] = answers.productDescription
  if (Object.keys(enPatches).length > 0) {
    steps.push(
      fileStep(
        enMessages,
        jsonPatchTransform(enPatches),
        `update ${Object.keys(enPatches).join(', ')}`
      )
    )
  }

  if (answers.productName) {
    const summary =
      'update meta.title (meta.description not auto-translated — update ru.json by hand)'
    steps.push(
      fileStep(ruMessages, jsonPatchTransform({ 'meta.title': answers.productName }), summary)
    )
  }
  return steps
}

export function buildThemeSteps(root, answers) {
  if (!answers.themeMode) return []
  const { theme } = resolvePaths(root)
  const ops = [
    {
      regex: /^export const DEFAULT_THEME_SETTING: ThemeSetting = '((?:[^'\\]|\\.)*)'$/m,
      value: escapeTsSingleQuoteInner(answers.themeMode),
    },
  ]
  return [
    fileStep(
      theme,
      linePatchesTransform(ops),
      `set DEFAULT_THEME_SETTING to '${answers.themeMode}'`
    ),
  ]
}
