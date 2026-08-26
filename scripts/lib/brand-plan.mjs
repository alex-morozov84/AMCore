// Builds the non-destructive init:brand plan (ADR-071). Every builder here
// takes (root, answers) and only contributes steps for the answers it was
// actually given — omitting a field leaves that file untouched, which is
// what makes the whole command safe to re-run. Split across
// brand-plan-files.mjs (package.json/manifest/messages/theme) and
// brand-plan-assets.mjs (logo/icon copies) to stay under ~150 lines/file.
import { readFileSync } from 'node:fs'
import { fileStep, markdownFieldsTransform, readMarkdownField } from './init-engine.mjs'
import { resolvePaths } from './brand-config.mjs'
import {
  buildPackageJsonSteps,
  buildManifestSteps,
  buildMessagesSteps,
  buildThemeSteps,
} from './brand-plan-files.mjs'
import { buildAssetSteps } from './brand-plan-assets.mjs'

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
