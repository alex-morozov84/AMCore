// Builds the non-destructive init:brand plan (ADR-071). Every function here
// takes (root, answers) and only contributes steps for the answers it was
// actually given — omitting a field leaves that file untouched, which is
// what makes the whole command safe to re-run.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  fileStep,
  copyFileStep,
  markdownFieldsTransform,
  linePatchesTransform,
  jsonPatchTransform,
  readMarkdownField,
} from './init-engine.mjs'
import { resolvePaths, resolveIconSpecs } from './brand-config.mjs'
import { validatePngSource } from './brand-validate.mjs'

export function buildBrandSteps(root, answers) {
  return [
    ...buildContextSteps(root, answers),
    ...buildPackageJsonSteps(root, answers),
    ...buildManifestSteps(root, answers),
    ...buildMessagesSteps(root, answers),
    ...buildThemeSteps(root, answers),
    ...buildAssetSteps(root, answers),
  ]
}

function buildContextSteps(root, answers) {
  const { projectContext } = resolvePaths(root)
  const before = readFileSync(projectContext, 'utf8')
  const ops = []

  const currentMode = readMarkdownField(before, 'Mode')
  if (answers.productName && currentMode?.includes('upstream-starter')) {
    ops.push({ label: 'Mode', value: '`downstream-product`' })
  }
  if (answers.productName) ops.push({ label: 'Product', value: answers.productName })
  if (answers.purpose) ops.push({ label: 'Purpose', value: answers.purpose })
  if (answers.upstreamSyncPolicy) {
    ops.push({
      label: 'Upstream sync policy',
      value: answers.upstreamSyncPolicy,
      insertAfterLabel: 'Canonical upstream',
    })
  }
  if (answers.workflowMode) {
    ops.push({
      label: 'Workflow mode',
      value: `\`${answers.workflowMode}\` — see "Workflow Modes" below.`,
    })
  }
  if (answers.themePersistence) {
    ops.push({
      label: 'theme_persistence',
      value: answers.themePersistence,
      insertAfterLabel: 'Workflow mode',
    })
  }

  const currentVersion = readMarkdownField(before, 'initialized_from_amcore_version')
  if (answers.amcoreVersion && currentVersion?.startsWith('N/A')) {
    ops.push({ label: 'initialized_from_amcore_version', value: answers.amcoreVersion })
  }

  if (ops.length === 0) return []
  const summary = `update ${ops.map((op) => op.label).join(', ')}`
  return [fileStep(projectContext, markdownFieldsTransform(ops), summary)]
}

function buildPackageJsonSteps(root, answers) {
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

function buildManifestSteps(root, answers) {
  const { manifest } = resolvePaths(root)
  const ops = []
  if (answers.productName) {
    ops.push({ regex: /^\s*name: '([^']*)',$/m, value: answers.productName })
    ops.push({ regex: /^\s*short_name: '([^']*)',$/m, value: answers.productName })
  }
  if (answers.productDescription) {
    ops.push({ regex: /^\s*description: '([^']*)',$/m, value: answers.productDescription })
  }
  if (ops.length === 0) return []
  return [fileStep(manifest, linePatchesTransform(ops), 'update PWA name/short_name/description')]
}

function buildMessagesSteps(root, answers) {
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

function buildThemeSteps(root, answers) {
  if (!answers.themeMode) return []
  const { theme } = resolvePaths(root)
  const ops = [
    {
      regex: /^export const DEFAULT_THEME_SETTING: ThemeSetting = '([^']*)'$/m,
      value: answers.themeMode,
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

function buildAssetSteps(root, answers) {
  const { logoDark, logoLight } = resolvePaths(root)
  const steps = []

  if (answers.logoDarkSrc) {
    validatePngSource(answers.logoDarkSrc)
    steps.push(
      copyFileStep(
        answers.logoDarkSrc,
        logoDark,
        `copy ${path.basename(answers.logoDarkSrc)} -> logo-dark.png`
      )
    )
  }
  if (answers.logoLightSrc) {
    validatePngSource(answers.logoLightSrc)
    steps.push(
      copyFileStep(
        answers.logoLightSrc,
        logoLight,
        `copy ${path.basename(answers.logoLightSrc)} -> logo-light.png`
      )
    )
  }
  for (const spec of resolveIconSpecs(root)) {
    const src = answers[spec.answerKey]
    if (!src) continue
    validatePngSource(src, { width: spec.width, height: spec.height })
    steps.push(
      copyFileStep(src, spec.dest, `copy ${path.basename(src)} -> ${path.basename(spec.dest)}`)
    )
  }
  return steps
}
