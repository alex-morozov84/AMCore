import { createOperationRegistry } from './path-algebra-operation-registry.mjs'
import { registerProjectConfigOperations } from './project-config-operations.mjs'
import {
  projectConsoleContentDefinition,
  registerConsoleStructuralOperations,
} from './project-console-content.mjs'
import { registerRouteProgressStructuralOperations } from './project-route-progress-content.mjs'
import { projectSharedContentDefinition } from './project-shared-content-operations.mjs'
import { projectStorybookContentDefinition } from './project-storybook-content.mjs'
import { registerStorybookStructuralOperations } from './project-storybook-vitest-content.mjs'

function structuralRegistry() {
  const registry = createOperationRegistry()
  registerProjectConfigOperations(registry)
  registerConsoleStructuralOperations(registry)
  registerRouteProgressStructuralOperations(registry)
  registerStorybookStructuralOperations(registry)
  return registry
}

function structuralClaimCount(registry, fact) {
  return registry.get(fact.operationKey).deriveSemanticWrites(fact.params).length
}

function textClaimCount(fact) {
  const definition =
    projectSharedContentDefinition(fact.operationKey) ??
    projectConsoleContentDefinition(fact.operationKey) ??
    projectStorybookContentDefinition(fact.operationKey)
  if (!definition) throw new Error(`unknown shared content operation "${fact.operationKey}"`)
  return definition.claims(fact.params).length
}

export function countProjectSemanticClaims(facts) {
  const registry = structuralRegistry()
  return facts.reduce(
    (total, fact) =>
      total +
      (fact.kind === 'delete'
        ? fact.claims.length
        : registry.has(fact.operationKey)
          ? structuralClaimCount(registry, fact)
          : textClaimCount(fact)),
    0
  )
}
