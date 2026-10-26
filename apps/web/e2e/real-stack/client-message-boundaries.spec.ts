import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { DEFAULT_LOCALE } from '@amcore/shared'
import { expect, test } from '@playwright/test'

import { serializedClientMessages } from '../shared/client-message-payload'

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
    const incoming = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === path &&
        (response.headers()['content-type']?.includes('text/x-component') ?? false)
    )
    await link.click()
    const response = await incoming
    expect(response.ok()).toBe(true)
    const boundaries = serializedClientMessages(await response.text())
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
