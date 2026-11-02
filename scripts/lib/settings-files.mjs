import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// One validated reader for `locales.json` and `admin-console.json`, for every script that decides
// something from them (edge generators, placement check, inventory, stands, audits). The rules
// mirror the Zod schemas in `packages/shared/src/constants/{locales,admin-console}.ts`; a shared
// fixture (`settings-contract.fixture.json`) is run against both sides so they cannot drift. A script
// must not write any output from a settings file this reader refuses.

const CONFIG_DIR = 'packages/shared/src/config'
const ALIAS_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/
const MODES = ['disabled', 'path', 'host']

// The catalogue list is a code constant in the shared package; read it from there instead of
// copying it. Guarded by a test that compares it with the real export.
function readCatalogues() {
  const source = readFileSync(
    new URL('../../packages/shared/src/constants/locales.ts', import.meta.url),
    'utf8'
  )
  const match = source.match(/export const LOCALE_CATALOGUES = \[([^\]]*)\] as const/)
  const list = match ? [...match[1].matchAll(/'([^']+)'/g)].map((item) => item[1]) : []
  if (list.length === 0) throw new Error('LOCALE_CATALOGUES not found in the shared package')
  return list
}

export const LOCALE_CATALOGUES = readCatalogues()
/** First path segments no alias may take: framework roots and every catalogue locale, served or not. */
export const RESERVED_ROOT_SEGMENTS = ['api', '_next', '_vercel', ...LOCALE_CATALOGUES]

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)

function shapeProblems(value, keys) {
  if (!isRecord(value)) return ['(not an object)']
  const problems = []
  for (const key of Object.keys(value))
    if (!keys.includes(key)) problems.push(`${key} (unrecognized_keys)`)
  for (const key of keys) if (!(key in value)) problems.push(`${key} (required)`)
  return problems
}

/** Problems of an alias value: shape and reserved roots. Empty means usable. */
export function aliasProblems(alias, path = 'alias') {
  if (typeof alias !== 'string' || !ALIAS_PATTERN.test(alias)) return [`${path} (invalid_format)`]
  return RESERVED_ROOT_SEGMENTS.includes(alias) ? [`${path} (ALIAS_RESERVED)`] : []
}

/** Same rules as `localeSettingsSchema`. Returns problems; an empty list means valid. */
export function validateLocaleSettings(value) {
  const problems = shapeProblems(value, ['version', 'enabled', 'default'])
  if (!isRecord(value)) return problems
  if (value.version !== 1) problems.push('version (invalid_value)')
  const known = (item) => typeof item === 'string' && LOCALE_CATALOGUES.includes(item)
  if (!Array.isArray(value.enabled) || value.enabled.length === 0) {
    problems.push('enabled (invalid_value)')
  } else {
    if (!value.enabled.every(known)) problems.push('enabled (invalid_value)')
    if (new Set(value.enabled).size !== value.enabled.length)
      problems.push('enabled (LOCALE_DUPLICATE)')
  }
  if ('default' in value) {
    if (!known(value.default)) problems.push('default (invalid_value)')
    else if (Array.isArray(value.enabled) && !value.enabled.includes(value.default))
      problems.push('default (LOCALE_DEFAULT_NOT_ENABLED)')
  }
  return problems
}

/** Same rules as `adminConsoleSettingsSchema`. */
export function validateAdminConsoleSettings(value) {
  const problems = shapeProblems(value, ['version', 'mode', 'alias'])
  if (!isRecord(value)) return problems
  if (value.version !== 1) problems.push('version (invalid_value)')
  if (!MODES.includes(value.mode)) problems.push('mode (invalid_value)')
  if ('alias' in value) problems.push(...aliasProblems(value.alias))
  return problems
}

function readSettings(root, name, validate) {
  const file = `${CONFIG_DIR}/${name}.json`
  let value
  try {
    value = JSON.parse(readFileSync(join(root, file), 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`${file} is missing`)
    throw new Error(`Invalid ${file}: ${error instanceof SyntaxError ? 'not JSON' : error.message}`)
  }
  const problems = validate(value)
  if (problems.length > 0) throw new Error(`Invalid ${file}: ${problems.join(', ')}`)
  return value
}

export const readLocaleSettings = (root) => readSettings(root, 'locales', validateLocaleSettings)
export const readAdminConsoleSettings = (root) =>
  readSettings(root, 'admin-console', validateAdminConsoleSettings)
