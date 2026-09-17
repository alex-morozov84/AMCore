import path from 'node:path'

import { validateOwnership } from './ownership-validate.mjs'
import { brandOwnershipFor } from './brand-ownership.mjs'
import { materializeProjectContentPath } from './project-content-materializer.mjs'

function groupFacts(facts) {
  const groups = new Map()
  for (const fact of facts) groups.set(fact.path, [...(groups.get(fact.path) ?? []), fact])
  return groups
}

function summary(facts) {
  const [fact] = facts
  if (fact.operationKey === 'brand.context-fields') {
    return `update ${fact.params.fields.map((field) => field.label).join(', ')}`
  }
  if (fact.operationKey === 'brand.package-fields') {
    return `update ${Object.keys(fact.params).join(', ')}`
  }
  if (fact.operationKey === 'brand.set-manifest-fields') {
    return 'update PWA name/short_name/description'
  }
  if (fact.operationKey === 'brand.messages-en-meta') {
    return `update ${Object.keys(fact.params).join(', ')}`
  }
  if (fact.operationKey === 'brand.messages-ru-meta') {
    return 'update meta.title (meta.description not auto-translated — update ru.json by hand)'
  }
  if (fact.operationKey === 'brand.set-theme-default') {
    return `set DEFAULT_THEME_SETTING to '${fact.params.theme}'`
  }
  throw new Error(`unknown brand summary operation "${fact.operationKey}"`)
}

function semanticStep(root, pathname, facts) {
  return {
    ...materializeProjectContentPath(root, pathname, facts),
    adapterClass: 'semantic-brand-content',
    modulePath: 'scripts/lib/brand-materializer.mjs',
    summary: summary(facts),
    semanticFacts: facts,
  }
}

function assetStep(root, fact) {
  return {
    kind: 'copy',
    target: path.join(root, fact.path),
    bytes: Buffer.from(fact.bytes),
    mode: fact.mode,
    changed: true,
    adapterClass: 'immutable-asset-snapshot',
    modulePath: 'scripts/lib/brand-materializer.mjs',
    summary: fact.summary,
    semanticFacts: [fact],
  }
}

export function materializeBrandSteps(root, facts) {
  const groups = groupFacts(facts)
  const semanticPaths = [...groups]
    .filter(([, pathFacts]) => !pathFacts[0].asset)
    .map(([pathname]) => pathname)
  if (semanticPaths.length) validateOwnership(root, brandOwnershipFor(semanticPaths))
  return [...groups].map(([pathname, pathFacts]) =>
    pathFacts[0].asset ? assetStep(root, pathFacts[0]) : semanticStep(root, pathname, pathFacts)
  )
}
