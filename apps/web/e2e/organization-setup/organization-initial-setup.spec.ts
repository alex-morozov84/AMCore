import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { DEFAULT_LOCALE, localizedFrontendUrl } from '@amcore/shared'
import { expect, test } from '@playwright/test'

import { postBrowserCredentials } from '../real-stack/helpers'
import { expectNoAxeViolations } from '../shared/axe'
import { activeTarget } from '../support/managed-target.mjs'
import { proveSetupMailbox, SETUP_PASSWORD, setupCommand } from '../support/organization-setup'

// Token-bearing pages must never produce trace/video/screenshots or error URLs.
test.use({ trace: 'off', video: 'off', screenshot: 'off' })

test('closed signup: compiled command, actual email proof, initial ADMIN and safe repeat', async ({
  page,
  request,
}) => {
  const m = activeTarget()
  const t = JSON.parse(
    readFileSync(join(m.snapshot, `apps/web/messages/${DEFAULT_LOCALE}.json`), 'utf8')
  ).auth
  const email = 'first-admin@e2e.amcore.test'
  expect(setupCommand('diagnostics')).toMatchObject({
    invalid: { exit: 2, output: { status: 'invalid_input' } },
    unavailable: { exit: 4, output: { status: 'SETUP_UNCONFIRMED', state: 'unavailable' } },
  })
  expect(setupCommand('status').state).toBe('eligible-empty')
  const signup = await postBrowserCredentials(request, m.origins.product, '/api/auth/register', {
    email: 'buyer@e2e.amcore.test',
    password: SETUP_PASSWORD,
  })
  expect(signup.status()).toBe(403)
  const prepared = setupCommand('prepare-account', { email, locale: DEFAULT_LOCALE })
  expect(prepared.status).toBe('created')
  expect(prepared.emailVerified).toBe(false)
  await proveSetupMailbox(page, email)
  const input = { name: 'Internal shop', slug: 'internal-shop', adminUserId: prepared.userId }
  const completed = setupCommand('bootstrap', input)
  expect(completed.status).toBe('created')
  expect(setupCommand('bootstrap', input)).toMatchObject({
    status: 'already_completed',
    ids: completed.ids,
  })
  expect(setupCommand('status').state).toBe('completed-intact')
  await page.goto(localizedFrontendUrl(m.origins.product, DEFAULT_LOCALE, 'login'))
  await page.getByRole('textbox', { name: t.email, exact: true }).fill(email)
  await page.getByLabel(t.password, { exact: true }).fill(SETUP_PASSWORD)
  await page.getByRole('button', { name: t.login, exact: true }).click()
  await page.waitForURL(
    (url) =>
      url.pathname === new URL(localizedFrontendUrl(m.origins.product, DEFAULT_LOCALE)).pathname
  )
  await page.goto(localizedFrontendUrl(m.origins.product, DEFAULT_LOCALE, 'organizations'))
  await expect(page.getByRole('heading', { name: 'Internal shop', exact: true })).toBeVisible()
  await expectNoAxeViolations(page)
})
