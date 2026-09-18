import { fail } from './errors.mjs'

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('output_invalid', `${label} must be an object`)
  }
}

function keys(value, required, optional, label) {
  object(value, label)
  const allowed = new Set([...required, ...optional])
  const missing = required.filter((key) => !(key in value))
  const unknown = Object.keys(value).filter((key) => !allowed.has(key))
  if (missing.length || unknown.length) {
    fail('output_invalid', `${label} missing [${missing}] or unknown [${unknown}] fields`)
  }
}

function stringsOrNull(value, fields, label) {
  for (const field of fields) {
    if (value[field] !== null && typeof value[field] !== 'string') {
      fail('output_invalid', `${label}.${field} must be a string or null`)
    }
  }
}

function validateProvenance(value) {
  const fields = [
    'event',
    'baseRef',
    'baseSha',
    'headSha',
    'mergeBaseSha',
    'diffRange',
    'declarationSha256',
    'trustSource',
  ]
  keys(value, fields, [], 'provenance')
  stringsOrNull(value, fields, 'provenance')
  if (value.trustSource !== 'merge-base') fail('output_invalid', 'untrusted selector output')
}

function validateLane(value, required, execution, label) {
  keys(value, ['actualExecution', 'required'], [], label)
  if (value.required !== required || value.actualExecution !== execution) {
    fail('output_invalid', `${label} has invalid execution semantics`)
  }
}

function validateLanes(value) {
  keys(value, ['exhaustiveBackstop', 'generatedFull', 'universalFast'], [], 'lanes')
  validateLane(value.universalFast, true, 'run', 'lanes.universalFast')
  keys(value.generatedFull, ['actualExecution', 'required'], [], 'lanes.generatedFull')
  if (typeof value.generatedFull.required !== 'boolean') {
    fail('output_invalid', 'generatedFull.required must be boolean')
  }
  if (value.generatedFull.actualExecution !== 'run-shadow') {
    fail('output_invalid', 'generatedFull must remain run-shadow')
  }
  validateLane(value.exhaustiveBackstop, false, 'scheduled-or-manual', 'lanes.exhaustive')
}

function stringArray(value, label) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    fail('output_invalid', `${label} must be a string array`)
  }
}

function validateReason(value, index) {
  keys(value, ['code', 'paths'], ['detail', 'inputId'], `reasons[${index}]`)
  if (typeof value.code !== 'string') fail('output_invalid', 'reason code must be a string')
  stringArray(value.paths, `reasons[${index}].paths`)
}

function validateMatch(value, index) {
  keys(value, ['graphs', 'inputIds', 'path', 'status'], ['oldPath'], `matchedInputs[${index}]`)
  stringArray(value.graphs, `matchedInputs[${index}].graphs`)
  stringArray(value.inputIds, `matchedInputs[${index}].inputIds`)
}

function validateUnknown(value, index) {
  keys(value, ['path', 'reason', 'status'], ['oldPath'], `unknownInputs[${index}]`)
}

function validateObservation(value) {
  const fields = [
    'actuallyRan',
    'generatedStepOutcome',
    'runAttempt',
    'runId',
    'selectorDegraded',
    'selectorTrustSource',
    'wouldRun',
  ]
  keys(value, fields, [], 'observation')
  if (typeof value.actuallyRan !== 'boolean' || typeof value.wouldRun !== 'boolean') {
    fail('output_invalid', 'observation run fields must be boolean')
  }
}

export function validateDecision(value, allowObservation = false) {
  const required = [
    'diagnostics',
    'lanes',
    'matchedInputs',
    'mode',
    'provenance',
    'reasons',
    'schemaVersion',
    'selectorVersion',
    'unknownInputs',
  ]
  keys(value, required, allowObservation ? ['observation'] : [], 'decision')
  if (value.schemaVersion !== '1.0.0' || value.mode !== 'shadow') {
    fail('output_invalid', 'unsupported selector output version or mode')
  }
  if (value.selectorVersion !== null && typeof value.selectorVersion !== 'string') {
    fail('output_invalid', 'selectorVersion must be a string or null')
  }
  validateProvenance(value.provenance)
  validateLanes(value.lanes)
  value.reasons.forEach(validateReason)
  value.matchedInputs.forEach(validateMatch)
  value.unknownInputs.forEach(validateUnknown)
  stringArray(value.diagnostics, 'diagnostics')
  if (value.observation) validateObservation(value.observation)
  return value
}
