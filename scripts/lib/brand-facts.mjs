import { readFileSync } from 'node:fs'
import path from 'node:path'

import { readMarkdownField } from './actions.mjs'
import { buildBrandAssetFacts } from './brand-asset-facts.mjs'
import { BRAND_PATHS } from './brand-ownership.mjs'

const content = (path, operationKey, params) => ({
  kind: 'content',
  dimension: 'brand-identity',
  path,
  operationKey,
  params,
})

function answeredContextFields(answers) {
  return [
    answers.productName && { label: 'Product', value: answers.productName },
    answers.purpose && { label: 'Purpose', value: answers.purpose },
    answers.upstreamSyncPolicy && {
      label: 'Upstream sync policy',
      value: answers.upstreamSyncPolicy,
      insertAfterLabel: 'Canonical upstream',
    },
    answers.workflowMode && {
      label: 'Workflow mode',
      value: `\`${answers.workflowMode}\` — see "Workflow Modes" below.`,
    },
    answers.themePersistence && {
      label: 'theme_persistence',
      value: answers.themePersistence,
      insertAfterLabel: 'Workflow mode',
    },
  ].filter(Boolean)
}

function contextFields(root, answers) {
  const before = readFileSync(path.join(root, BRAND_PATHS.context), 'utf8')
  const fields = answeredContextFields(answers)
  if (answers.productName && readMarkdownField(before, 'Mode')?.includes('upstream-starter')) {
    fields.unshift({ label: 'Mode', value: '`downstream-product`' })
  }
  const version = readMarkdownField(before, 'initialized_from_amcore_version')
  if (answers.amcoreVersion && version?.startsWith('N/A')) {
    fields.push({ label: 'initialized_from_amcore_version', value: answers.amcoreVersion })
  }
  return fields
}

function semanticFacts(root, answers) {
  const facts = []
  const fields = contextFields(root, answers)
  if (fields.length) facts.push(content(BRAND_PATHS.context, 'brand.context-fields', { fields }))
  const packageFields = {}
  if (answers.packageName) packageFields.name = answers.packageName
  if (answers.productDescription) packageFields.description = answers.productDescription
  if (Object.keys(packageFields).length)
    facts.push(content(BRAND_PATHS.package, 'brand.package-fields', packageFields))
  const manifest = {}
  if (answers.productName) manifest.name = manifest.short_name = answers.productName
  if (answers.productDescription) manifest.description = answers.productDescription
  if (Object.keys(manifest).length)
    facts.push(content(BRAND_PATHS.manifest, 'brand.set-manifest-fields', manifest))
  const en = {}
  if (answers.productName) en['meta.title'] = answers.productName
  if (answers.productDescription) en['meta.description'] = answers.productDescription
  if (Object.keys(en).length)
    facts.push(content(BRAND_PATHS.enMessages, 'brand.messages-en-meta', en))
  if (answers.productName)
    facts.push(
      content(BRAND_PATHS.ruMessages, 'brand.messages-ru-meta', {
        'meta.title': answers.productName,
      })
    )
  if (answers.themeMode)
    facts.push(content(BRAND_PATHS.theme, 'brand.set-theme-default', { theme: answers.themeMode }))
  return facts
}

export function buildBrandFacts(root, desiredState) {
  return [
    ...semanticFacts(root, desiredState.answers),
    ...buildBrandAssetFacts(desiredState.answers),
  ]
}
