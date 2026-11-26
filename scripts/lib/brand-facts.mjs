import { readFileSync } from 'node:fs'
import path from 'node:path'

import { readMarkdownField } from './actions.mjs'
import { buildBrandAssetFacts } from './brand-asset-facts.mjs'
import { productMetadata } from './product-metadata.mjs'
import { TEAM_PROCESS_FIELD } from './team-process.mjs'
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
    answers.workflowReference && {
      label: 'Workflow reference',
      value: answers.workflowReference,
      insertAfterLabel: 'Workflow mode',
    },
    answers.teamProcess && {
      label: TEAM_PROCESS_FIELD,
      value: answers.teamProcess,
      insertAfterLabel: 'Workflow mode',
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
  const initial =
    answers.productName && readMarkdownField(before, 'Mode')?.includes('upstream-starter')
  const fields = answeredContextFields({
    ...answers,
    purpose: answers.purpose ?? (initial && answers.productSetup ? 'To be defined.' : undefined),
    upstreamSyncPolicy:
      answers.upstreamSyncPolicy ?? (initial && answers.productSetup ? 'Decide later.' : undefined),
  })
  if (initial) {
    fields.unshift({ label: 'Mode', value: '`downstream-product`' })
  }
  const version = readMarkdownField(before, 'initialized_from_amcore_version')
  if (
    answers.productSetup &&
    answers.productName &&
    fields.some((field) => field.label === 'Mode') &&
    !answers.amcoreVersion
  )
    throw new Error('Git could not determine the source version')
  if (
    answers.productName &&
    answers.amcoreVersion &&
    version?.startsWith('N/A') &&
    fields.some((field) => field.label === 'Mode')
  ) {
    fields.push({ label: 'initialized_from_amcore_version', value: answers.amcoreVersion })
  }
  return fields
}

function semanticFacts(root, input, metadata) {
  const answers = input
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
  for (const locale of ['en', 'ru']) {
    const name = metadata ? metadata.names[locale] : answers.productName
    const description = metadata
      ? metadata.descriptions[locale]
      : locale === 'en'
        ? answers.productDescription
        : undefined
    const fields = {}
    if (name) fields['meta.title'] = name
    if (description) fields['meta.description'] = description
    if (Object.keys(fields).length)
      facts.push(
        content(
          locale === 'en' ? BRAND_PATHS.enMessages : BRAND_PATHS.ruMessages,
          `brand.messages-${locale}-meta`,
          fields
        )
      )
  }
  if (answers.themeMode)
    facts.push(content(BRAND_PATHS.theme, 'brand.set-theme-default', { theme: answers.themeMode }))
  return facts
}

export function buildBrandFacts(root, desiredState) {
  const input = desiredState.answers
  const { answers, metadata } = input.productSetup
    ? productMetadata(root, input)
    : { answers: input }
  return [...semanticFacts(root, answers, metadata), ...buildBrandAssetFacts(desiredState.answers)]
}
