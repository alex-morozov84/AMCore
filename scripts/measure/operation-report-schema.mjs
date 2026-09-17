const isString = (value) => typeof value === 'string'
const isNullableString = (value) => value === null || isString(value)
const isNonNegativeInt = (value) => Number.isInteger(value) && value >= 0
const isObject = (value) => typeof value === 'object' && value !== null
const isStringArray = (value) => Array.isArray(value) && value.every(isString)

const OPERATION_SHAPE = {
  scenarioName: isString,
  operationIndex: isNonNegativeInt,
  kind: isString,
  adapterClass: isString,
  modulePath: isNullableString,
  moduleAttributionReason: isNullableString,
  source: isNullableString,
  sourceType: isString,
  target: isString,
  targetType: isString,
  summary: isString,
}

const EXACT_COPY_EDGE_SHAPE = {
  upstreamSource: isString,
  upstreamSourceCount: isNonNegativeInt,
  scenarios: isStringArray,
}

const MIGRATION_COUNTS_SHAPE = {
  productionProviders: isNonNegativeInt,
  ownershipManifests: isNonNegativeInt,
  semanticFacts: isNonNegativeInt,
  semanticClaims: isNonNegativeInt,
  finalFilesystemOperations: isNonNegativeInt,
}

function validateShape(value, shape, prefix) {
  if (!isObject(value)) return [`${prefix}: expected an object`]
  const errors = []
  for (const [field, check] of Object.entries(shape)) {
    if (!(field in value)) errors.push(`${prefix}: missing required field "${field}"`)
    else if (!check(value[field]))
      errors.push(`${prefix}: field "${field}" has an unexpected shape/type`)
  }
  return errors
}

export function isOperationInventory(value) {
  return isObject(value) && Array.isArray(value.operations) && Array.isArray(value.exactCopyEdges)
}

export function validateOperationInventory(inventory) {
  const operations = inventory.operations.flatMap((item, index) =>
    validateShape(item, OPERATION_SHAPE, `operationInventory.operations[${index}]`)
  )
  const edges = inventory.exactCopyEdges.flatMap((item, index) =>
    validateShape(item, EXACT_COPY_EDGE_SHAPE, `operationInventory.exactCopyEdges[${index}]`)
  )
  const migration = inventory.migrationCounts
    ? validateShape(
        inventory.migrationCounts,
        MIGRATION_COUNTS_SHAPE,
        'operationInventory.migrationCounts'
      )
    : []
  return [...operations, ...edges, ...migration]
}
