import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

// The served locales come from packages/shared/src/config/locales.json; the catalogues live in
// one constant. A second hand-written list of locale codes in production code would silently
// ignore the setting, so it is a failure. Tests, stories and e2e files may spell locales out.
const ALLOWED = new Set(['packages/shared/src/constants/locales.ts'])
const LIST = /\[\s*['"`](?:en|ru)['"`]\s*,\s*['"`](?:en|ru)['"`]\s*\]/
const NOT_PRODUCTION =
  /(^|\/)(e2e|test|tests|__tests__|fixtures)\/|\.(test|spec|stories)\.[cm]?[jt]sx?$/

function trackedSources() {
  const out = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    }
  )
  return out
    .split('\0')
    .filter((file) => /\.[cm]?[jt]sx?$/.test(file) && !NOT_PRODUCTION.test(file))
    .filter((file) => /^(apps|packages|scripts)\//.test(file))
}

test('production code has no second hand-written list of locale codes', () => {
  const offenders = trackedSources().filter(
    (file) => !ALLOWED.has(file) && LIST.test(readFileSync(file, 'utf8'))
  )
  assert.deepEqual(
    offenders,
    [],
    'derive the list from SUPPORTED_LOCALES or LOCALE_CATALOGUES in @amcore/shared'
  )
})

test('the one allowed definition still exists', () => {
  assert.match(readFileSync('packages/shared/src/constants/locales.ts', 'utf8'), LIST)
})
