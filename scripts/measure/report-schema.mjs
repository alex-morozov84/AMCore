// Versioned, dependency-free schema/validator for the scaffolding baseline
// report (BACKLOG item 14, PR1). No schema-validation library is added here
// deliberately — root `scripts/*` tooling stays dependency-light per
// ADR-071, and this report's shape is small and stable enough that a plain
// hand-rolled walk is clearer than a new dependency for one internal file.
//
// Bumping SCHEMA_VERSION is required whenever a field is added, removed, or
// changes meaning — comparisons across baseline runs must never silently mix
// two incompatible report shapes.
export const SCHEMA_VERSION = '1.0.0'

const isString = (v) => typeof v === 'string'
const isBoolean = (v) => typeof v === 'boolean'
const isNumber = (v) => typeof v === 'number' && Number.isFinite(v)
const isNullableString = (v) => v === null || isString(v)
const isArray = (v) => Array.isArray(v)
const isObject = (v) => typeof v === 'object' && v !== null

const STAGE_SHAPE = { label: isString, ranAt: isString, ok: isBoolean, durationMs: isNumber }

const SCENARIO_SHAPE = {
  scenarioName: isString,
  flags: isArray,
  startedAt: isString,
  repoSha: isString,
  repoDirty: isBoolean,
  fixtureSha: isString,
  cliSha: isString,
  comparable: isBoolean,
  comparabilityReason: isNullableString,
  counters: isObject,
  stages: isArray,
  wallTimeMs: isNumber,
  peakDiskUsageBytes: isNumber,
  finalDiskUsageBytes: isNumber,
  success: isBoolean,
  failedStage: isNullableString,
  diagnosticsPath: isNullableString,
  fingerprint: (v) => v === null || (isObject(v) && isString(v.treeHash)),
}

// Only `scenarios`/`transformInventory` array-ness is checked at this level
// — each element's own shape is walked separately in `validateReport` so a
// deep error names its exact path (`scenarios[1].stages[0]: ...`) instead of
// being swallowed into one generic "scenarios has an unexpected shape".
const REPORT_SHAPE = {
  schemaVersion: isString,
  generatedAt: isString,
  environment: isString,
  nodeVersion: isString,
  pnpmVersion: isString,
  scenarios: isArray,
  transformInventory: isArray,
  topology: isObject,
}

/** Walks one object against a `{field: predicate}` shape, returning a list of field-level errors. */
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

/**
 * Validates a full baseline report. Returns `{ valid, errors }` — every
 * error names its exact field path so a schema drift is actionable, not a
 * bare "invalid report" message.
 */
export function validateReport(report) {
  const errors = validateShape(report, REPORT_SHAPE)
  if (errors.length > 0) return { valid: false, errors }

  const scenarioErrors = report.scenarios.flatMap((scenario, index) => validateScenario(scenario, index))
  if (scenarioErrors.length > 0) return { valid: false, errors: scenarioErrors }

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
