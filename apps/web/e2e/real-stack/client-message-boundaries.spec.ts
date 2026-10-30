import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { DEFAULT_LOCALE, localePathPrefix, SUPPORTED_LOCALES } from '@amcore/shared'
import { type APIResponse, expect, test } from '@playwright/test'

import { ROOT_CLIENT_NAMESPACES } from '../../src/i18n/message-selection'
import { embeddedFlight, serializedClientMessages } from '../shared/client-message-payload'

import { registerViaUi, uniqueEmail } from './helpers'

const messages = JSON.parse(
  readFileSync(join(__dirname, `../../messages/${DEFAULT_LOCALE}.json`), 'utf8')
)

test('sibling navigation sends new section messages without the departed section catalogue', async ({
  page,
}) => {
  const missing: string[] = []
  page.on('console', (entry) => {
    if (entry.type() === 'error' && entry.text().includes('MISSING_MESSAGE'))
      missing.push(entry.text())
  })
  await registerViaUi(page, uniqueEmail('message-boundaries'))
  async function navigate(label: string) {
    const link = page.getByRole('link', { name: label, exact: true })
    const href = await link.getAttribute('href')
    expect(href).toBeTruthy()
    const path = new URL(href!, page.url()).pathname
    let capture!: (response: APIResponse) => void
    const incoming = new Promise<APIResponse>((resolve) => {
      capture = resolve
    })
    const matches = (url: URL) => url.pathname === path
    await page.route(matches, async (route) => {
      if (route.request().headers().rsc !== '1') return route.continue()
      const response = await route.fetch()
      capture(response)
      await route.fulfill({ response })
    })
    await link.click()
    const response = await incoming
    await page.unroute(matches)
    expect(response.ok()).toBe(true)
    const boundaries = serializedClientMessages((await response.body()).toString('utf8'))
    expect(boundaries.length).toBeGreaterThan(0)
    return Object.assign({}, ...boundaries)
  }
  const organizations = await navigate(messages.organizationAccess.title)
  expect(organizations.organizationCreation).toEqual(messages.organizationCreation)
  expect(organizations).not.toHaveProperty('apiKeyPresentation')
  const keys = await navigate(messages.ownApiKeys.title)
  await expect(
    page.getByRole('main').getByRole('heading', { name: messages.ownApiKeys.title, exact: true })
  ).toBeVisible()
  expect(keys.memberApiKeys).toEqual(messages.memberApiKeys)
  expect(keys.apiKeyPresentation).toEqual(messages.apiKeyPresentation)
  expect(keys).not.toHaveProperty('organizationCreation')
  expect(missing).toEqual([])
})

for (const locale of SUPPORTED_LOCALES) {
  test(`production login excludes MFA messages from HTML and RSC (${locale})`, async ({
    request,
  }) => {
    const catalogue = JSON.parse(
      readFileSync(join(__dirname, `../../messages/${locale}.json`), 'utf8')
    )
    const allowed = [...ROOT_CLIENT_NAMESPACES, 'auth'].sort()
    const url = `${localePathPrefix(locale)}/login`
    for (const transport of ['html', 'rsc'] as const) {
      const response = await request.get(url, {
        headers: transport === 'rsc' ? { RSC: '1' } : {},
      })
      expect(response.ok()).toBe(true)
      const body = await response.text()
      if (transport === 'rsc')
        expect(response.headers()['content-type']).toContain('text/x-component')
      const boundaries = serializedClientMessages(
        transport === 'html' ? embeddedFlight(body) : body
      )
      expect(boundaries.length).toBeGreaterThanOrEqual(2)
      const messages = Object.assign({}, ...boundaries)
      expect(Object.keys(messages).sort()).toEqual(allowed)
      for (const key of allowed) expect(messages[key]).toEqual(catalogue[key])
      expect(messages).not.toHaveProperty('accountMfa')
      console.log(
        JSON.stringify({
          measurement: 'login-client-messages',
          locale,
          transport,
          responseBytes: Buffer.byteLength(body),
          messageBytes: Buffer.byteLength(JSON.stringify(messages)),
          namespaces: Object.keys(messages).sort(),
        })
      )
    }
  })
}
