import { readFileSync } from 'node:fs'
import path from 'node:path'

import { canonicalStringify } from './path-algebra-canonical.mjs'
import { createOperationRegistry } from './path-algebra-operation-registry.mjs'
import {
  applyStructuralPlan,
  planStructuralComposition,
} from './path-algebra-structural-compose.mjs'
import { registerProjectConfigOperations } from './project-config-operations.mjs'
import {
  projectConsoleContentDefinition,
  registerConsoleStructuralOperations,
} from './project-console-content.mjs'
import { registerRouteProgressStructuralOperations } from './project-route-progress-content.mjs'
import { projectSharedContentDefinition } from './project-shared-content-operations.mjs'

function conflict(pathname, location, left, right) {
  throw new Error(
    `semantic claim conflict on "${pathname}" at "${location}": "${left}" != "${right}"`
  )
}

function claimsFor(fact) {
  const definition =
    projectSharedContentDefinition(fact.operationKey) ??
    projectConsoleContentDefinition(fact.operationKey)
  if (!definition) throw new Error(`unknown shared content operation "${fact.operationKey}"`)
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

function structuralRegistry() {
  const registry = createOperationRegistry()
  registerProjectConfigOperations(registry)
  registerConsoleStructuralOperations(registry)
  registerRouteProgressStructuralOperations(registry)
  return registry
}

function materializeStructural(root, pathname, facts, registry) {
  const structural = facts.map((fact) => ({ ...fact, kind: 'structural' }))
  const [plan] = planStructuralComposition(registry, structural)
  const before = readFileSync(path.join(root, pathname), 'utf8')
  return { before, after: applyStructuralPlan(registry, plan, before) }
}

export function materializeProjectContentPath(root, pathname, facts) {
  if (facts.some((fact) => fact.kind === 'delete')) {
    if (facts.length !== 1) throw new Error(`delete/content collision on "${pathname}"`)
    const [fact] = facts
    const expected = `filesystem:path:${pathname}`
    if (fact.claims?.length !== 1 || fact.claims[0].location !== expected) {
      throw new Error(`delete fact for "${pathname}" requires its filesystem semantic claim`)
    }
    return { kind: 'delete', target: path.join(root, pathname), changed: true }
  }
  const registry = structuralRegistry()
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
