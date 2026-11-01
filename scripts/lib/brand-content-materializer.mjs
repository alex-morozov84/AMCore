import { readFileSync } from 'node:fs'
import path from 'node:path'

import { brandContentDefinition } from './brand-content-operations.mjs'
import { registerBrandStructuralOperations } from './brand-structural-operations.mjs'
import { canonicalStringify } from './path-algebra-canonical.mjs'
import { createOperationRegistry } from './path-algebra-operation-registry.mjs'
import {
  applyStructuralPlan,
  planStructuralComposition,
} from './path-algebra-structural-compose.mjs'

function conflict(pathname, location, left, right) {
  throw new Error(
    `semantic claim conflict on "${pathname}" at "${location}": "${left}" != "${right}"`
  )
}

function claimsFor(fact) {
  const definition = brandContentDefinition(fact.operationKey)
  if (!definition) throw new Error(`unknown shared content operation "${fact.operationKey}"`)
  if (definition.paramsSchema && definition.paramsSchema(fact.params) !== true) {
    throw new Error(`invalid operation params for "${fact.operationKey}"`)
  }
  const claims = definition.claims(fact.params)
  if (!Array.isArray(claims) || claims.length === 0) {
    throw new Error(`shared content operation "${fact.operationKey}" has no semantic claims`)
  }
  return { definition, claims }
}

function validateClaims(pathname, facts) {
  const locations = new Map()
  for (const fact of facts) {
    const { claims } = claimsFor(fact)
    for (const claim of claims) {
      if (!claim.location) throw new Error(`empty semantic location for "${fact.operationKey}"`)
      const value = canonicalStringify(claim.value)
      const prior = locations.get(claim.location)
      if (prior !== undefined && prior !== value) conflict(pathname, claim.location, prior, value)
      locations.set(claim.location, value)
    }
  }
}

function dedupeFacts(facts) {
  const seen = new Set()
  return facts.filter((fact) => {
    const identity = canonicalStringify([fact.operationKey, fact.params])
    if (seen.has(identity)) return false
    seen.add(identity)
    return true
  })
}

function materializeText(root, pathname, facts) {
  const uniqueFacts = dedupeFacts(facts)
  validateClaims(pathname, uniqueFacts)
  const before = readFileSync(path.join(root, pathname), 'utf8')
  const after = [...uniqueFacts]
    .sort((left, right) => left.operationKey.localeCompare(right.operationKey))
    .reduce((text, fact) => claimsFor(fact).definition.apply(text, fact.params), before)
  return { before, after }
}

export function createBrandStructuralRegistry() {
  const registry = createOperationRegistry()
  registerBrandStructuralOperations(registry)
  return registry
}

function materializeStructural(root, pathname, facts, registry) {
  const structural = facts.map((fact) => ({ ...fact, kind: 'structural' }))
  const [plan] = planStructuralComposition(registry, structural)
  const before = readFileSync(path.join(root, pathname), 'utf8')
  return { before, after: applyStructuralPlan(registry, plan, before) }
}

export function materializeBrandContentPath(root, pathname, facts) {
  const registry = createBrandStructuralRegistry()
  const structural = facts.filter((fact) => registry.has(fact.operationKey))
  if (structural.length && structural.length !== facts.length) {
    throw new Error(`mixed structural/text operations on "${pathname}"`)
  }
  const text = structural.length
    ? materializeStructural(root, pathname, facts, registry)
    : materializeText(root, pathname, facts)
  return {
    kind: 'edit',
    target: path.join(root, pathname),
    changed: text.before !== text.after,
    ...text,
  }
}
