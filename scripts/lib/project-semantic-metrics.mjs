import { createOperationRegistry } from './path-algebra-operation-registry.mjs'
import { registerProjectConfigOperations } from './project-config-operations.mjs'
import { projectSharedContentDefinition } from './project-shared-content-operations.mjs'

function eslintClaimCount(fact) {
  const registry = createOperationRegistry()
  registerProjectConfigOperations(registry)
  return registry.get(fact.operationKey).deriveSemanticWrites(fact.params).length
}

function textClaimCount(fact) {
  const definition = projectSharedContentDefinition(fact.operationKey)
  if (!definition) throw new Error(`unknown shared content operation "${fact.operationKey}"`)
  return definition.claims(fact.params).length
}

export function countProjectSemanticClaims(facts) {
  return facts.reduce(
    (total, fact) =>
      total +
      (fact.kind === 'delete'
        ? fact.claims.length
        : fact.path === 'apps/web/eslint.config.mjs'
          ? eslintClaimCount(fact)
          : textClaimCount(fact)),
    0
  )
}
