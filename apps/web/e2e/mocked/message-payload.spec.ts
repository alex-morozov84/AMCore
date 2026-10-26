import { readFileSync } from 'node:fs'
import path from 'node:path'

import { localePathPrefix, SUPPORTED_LOCALES } from '@amcore/shared'
import { expect, test } from '@playwright/test'

import { ROOT_CLIENT_NAMESPACES } from '../../src/i18n/message-selection'
import { embeddedFlight, serializedClientMessages } from '../shared/client-message-payload'

for (const locale of SUPPORTED_LOCALES) {
  test(`login serializes only core and auth messages (${locale})`, async ({ request }) => {
    const catalogue = JSON.parse(
      readFileSync(path.join(__dirname, `../../messages/${locale}.json`), 'utf8')
    )
    const allowed = [...ROOT_CLIENT_NAMESPACES, 'auth'].sort()
    const excluded = Object.keys(catalogue).filter((key) => !allowed.includes(key))
    expect(excluded.length).toBeGreaterThan(0)
    const response = await request.get(`${localePathPrefix(locale)}/login`)
    expect(response.ok()).toBe(true)
    const boundaries = serializedClientMessages(embeddedFlight(await response.text()))
    expect(boundaries.length).toBeGreaterThanOrEqual(2)
    const combined = Object.assign({}, ...boundaries)
    expect(Object.keys(combined).sort()).toEqual(allowed)
    expect(combined.auth.login).toBe(catalogue.auth.login)
    expect(combined.common.cancel).toBe(catalogue.common.cancel)
    for (const key of excluded) expect(combined).not.toHaveProperty(key)
  })
}
