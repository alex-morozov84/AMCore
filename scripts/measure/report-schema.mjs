// Versioned dependency-free validator for comparable baseline reports.
// Bump the version whenever a field or its meaning changes.
import { isOperationInventory, validateOperationInventory } from './operation-report-schema.mjs'

export const SCHEMA_VERSION = '1.3.0'

const isString = (v) => typeof v === 'string'
const isBoolean = (v) => typeof v === 'boolean'
const isNumber = (v) => typeof v === 'number' && Number.isFinite(v)
const isNonNegativeInt = (v) => Number.isInteger(v) && v >= 0
const isNullableString = (v) => v === null || isString(v)
const isArray = (v) => Array.isArray(v)
const isObject = (v) => typeof v === 'object' && v !== null
const isStringArray = (v) => isArray(v) && v.every(isString)

const STAGE_SHAPE = { label: isString, ranAt: isString, ok: isBoolean, durationMs: isNumber }

const COUNTER_FIELDS = [
  'repoCopies',
  'installs',
  'typecheckRuns',
  'lintRuns',
  'buildRuns',
  'testRuns',
]
const isCounters = (v) => isObject(v) && COUNTER_FIELDS.every((field) => isNonNegativeInt(v[field]))

const isFingerprint = (v) =>
  v === null ||
  (isObject(v) &&
    isString(v.treeHash) &&
    isNonNegativeInt(v.fileCount) &&
    isObject(v.significantValues) &&
    Object.values(v.significantValues).every(isNullableString))

const SCENARIO_SHAPE = {
  scenarioName: isString,
  flags: isStringArray,
  startedAt: isString,
  repoSha: isString,
  repoDirty: isBoolean,
  fixtureSha: isString,
  cliSha: isString,
  comparable: isBoolean,
  comparabilityReason: isNullableString,
  counters: isCounters,
  stages: isArray,
  wallTimeMs: isNumber,
  peakDiskUsageBytes: isNumber,
  finalDiskUsageBytes: isNumber,
  success: isBoolean,
  failedStage: isNullableString,
  diagnosticsPath: isNullableString,
  fingerprint: isFingerprint,
}

const DOMAIN_FIELDS = ['docs', 'tests', 'ci', 'proxy']
const isDomain = (v) => isObject(v) && DOMAIN_FIELDS.every((field) => typeof v[field] === 'boolean')
const isHistogram = (v) =>
  isObject(v) && Object.values(v).every((count) => Number.isInteger(count) && count > 0)

const TRANSFORM_INVENTORY_ITEM_SHAPE = {
  modulePath: isString,
  dimension: isString,
  histogram: isHistogram,
  primaryShape: isString,
  unclassifiedReason: isNullableString,
  domain: isDomain,
}

const isCandidateGroup = (v) => isArray(v) && v.length > 1 && v.every(isString)
const isTopology = (v) =>
  isObject(v) &&
  isArray(v.candidateEquivalentGroups) &&
  v.candidateEquivalentGroups.every(isCandidateGroup)

const REPORT_SHAPE = {
  schemaVersion: isString,
  generatedAt: isString,
  environment: isString,
  nodeVersion: isString,
  pnpmVersion: isString,
  scenarios: isArray,
  transformInventory: isArray,
  operationInventory: isOperationInventory,
  topology: isTopology,
}

function validateShape(obj, shape) {
  if (!isObject(obj)) return ['expected an object']
  const errors = []
  for (const [field, check] of Object.entries(shape)) {
    if (!(field in obj)) errors.push(`missing required field "${field}"`)
    else if (!check(obj[field])) errors.push(`field "${field}" has an unexpected shape/type`)
  }
  return errors
}

function validateScenario(scenario, index) {
  const errors = validateShape(scenario, SCENARIO_SHAPE).map((err) => `scenarios[${index}]: ${err}`)
  if (isArray(scenario?.stages)) {
    scenario.stages.forEach((stage, stageIndex) => {
      validateShape(stage, STAGE_SHAPE).forEach((err) =>
        errors.push(`scenarios[${index}].stages[${stageIndex}]: ${err}`)
      )
    })
  }
  return errors
}

function validateTransformInventory(transformInventory) {
  return transformInventory.flatMap((item, index) =>
    validateShape(item, TRANSFORM_INVENTORY_ITEM_SHAPE).map(
      (err) => `transformInventory[${index}]: ${err}`
    )
  )
}

/**
 * Validates a full baseline report. Returns `{ valid, errors }` — every
 * error names its exact field path so a schema drift is actionable, not a
 * bare "invalid report" message.
 */
export function validateReport(report) {
  const errors = validateShape(report, REPORT_SHAPE)
  if (errors.length > 0) return { valid: false, errors }

  const scenarioErrors = report.scenarios.flatMap((scenario, index) =>
    validateScenario(scenario, index)
  )
  if (scenarioErrors.length > 0) return { valid: false, errors: scenarioErrors }

  const inventoryErrors = validateTransformInventory(report.transformInventory)
  if (inventoryErrors.length > 0) return { valid: false, errors: inventoryErrors }

  const operationErrors = validateOperationInventory(report.operationInventory)
  if (operationErrors.length > 0) return { valid: false, errors: operationErrors }

  if (report.schemaVersion !== SCHEMA_VERSION) {
    return {
      valid: false,
      errors: [
        `schemaVersion "${report.schemaVersion}" does not match this tool's ` +
          `SCHEMA_VERSION "${SCHEMA_VERSION}" — regenerate the report, do not compare across versions`,
      ],
    }
  }
  return { valid: true, errors: [] }
}
