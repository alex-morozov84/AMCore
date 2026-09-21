import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { assertLocaleProjectionGuards } from './project-locale-fast-guards.mjs'

function fixture(file, source) {
  const root = mkdtempSync(path.join(tmpdir(), 'amcore-locale-guard-'))
  const target = path.join(root, file)
  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(target, source)
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

function expectFailure(file, source, pattern) {
  const copy = fixture(file, source)
  try {
    assert.throws(() => assertLocaleProjectionGuards(copy.root), pattern)
  } finally {
    copy.cleanup()
  }
}

test('current checkout has complete locale navigation and fixture coverage', () => {
  assert.doesNotThrow(() => assertLocaleProjectionGuards())
})

test('mutation: an unregistered navigation consumer fails with its file, import, and action', () => {
  expectFailure(
    'apps/web/src/widgets/forgotten.ts',
    "import { usePathname } from '@/i18n/navigation'\n",
    /forgotten\.ts: imports "@\/i18n\/navigation"; add locale\.navigation-\*/
  )
})

test('hardcoded provider and typed fixture literals fail unless their path has a locale operation', () => {
  expectFailure(
    'apps/web/src/widgets/forgotten.test.tsx',
    '<NextIntlClientProvider locale="en" />\n' +
      "const fixture: { locale: SupportedLocale } = { locale: 'ru' }\n",
    /hardcoded locale "(?:en|ru)"; use DEFAULT_LOCALE/
  )
})

test('a registered locale-specific fixture remains allowed', () => {
  const copy = fixture(
    'apps/web/src/features/auth-oauth/ui/OAuthSection.test.tsx',
    '<NextIntlClientProvider locale="en" />\n'
  )
  try {
    assert.doesNotThrow(() => assertLocaleProjectionGuards(copy.root))
  } finally {
    copy.cleanup()
  }
})
