import { expect, test } from '@playwright/test'

import { registerViaUi, TEST_PASSWORD, uniqueEmail } from '../real-stack/helpers'
import { completeMfaSignIn } from '../shared/mfa-login'
import { isProductHome, messages, productPath } from '../shared/product-settings'
import { activeTarget, guardedExec } from '../support/managed-target.mjs'

import { setSystemRole } from './helpers'

test.use({ trace: 'off', screenshot: 'off', video: 'off' })

test('retries an unconfirmed logout for the same Console session', async ({ browser }) => {
  const target = activeTarget()
  const email = uniqueEmail('t117-console')
  const product = await browser.newContext({
    baseURL: target.origins.product,
    ignoreHTTPSErrors: true,
  })
  const console = await browser.newContext({
    baseURL: target.origins.console,
    ignoreHTTPSErrors: true,
  })
  try {
    await registerViaUi(await product.newPage(), email)
    setSystemRole(email, 'SUPER_ADMIN')
    const page = await console.newPage()
    await page.goto(productPath('/login'))
    await page.getByLabel(messages.console.loginEmail, { exact: true }).fill(email)
    await page.getByLabel(messages.console.loginPassword, { exact: true }).fill(TEST_PASSWORD)
    await page.getByRole('button', { name: messages.console.signIn, exact: true }).click()
    await completeMfaSignIn(page, email)
    await expect(page).toHaveURL(
      (url) => url.origin === target.origins.console && isProductHome(url)
    )
    expect((await page.request.get('/api/access')).status()).toBe(204)

    await page.route(
      '**/api/auth/logout',
      async (route) => {
        const { returnEntryId } = route.request().postDataJSON() as { returnEntryId: string }
        const keys = guardedExec(
          'redis',
          'redis-cli',
          '--scan',
          '--pattern',
          `*:console-return:v1:${returnEntryId}`
        )
          .trim()
          .split('\n')
        expect(keys).toHaveLength(1)
        expect(keys[0]).toContain(':console-return:v1:')
        expect(
          guardedExec(
            'redis',
            'redis-cli',
            'EVAL',
            `
        local record = cjson.decode(redis.call('GET', KEYS[1]))
        if record.phase ~= 'prepared' then return 0 end
        record.phase = 'logout_dispatched'
        redis.call('SET', KEYS[1], cjson.encode(record), 'KEEPTTL')
        return 1
      `,
            '1',
            keys[0]!
          ).trim()
        ).toBe('1')
        await route.abort('failed')
      },
      { times: 1 }
    )
    await page.getByRole('button').filter({ hasText: email }).click()
    await page.getByRole('menuitem', { name: messages.auth.logout, exact: true }).click()
    await expect(page.getByText(messages.console.logoutUnconfirmed, { exact: true })).toBeVisible()
    // The application accepts a POST for the same receipt even when the first API dispatch did not happen.
    expect((await page.request.get('/api/access')).status()).toBe(204)
    await page.getByRole('button', { name: messages.console.retryLogout, exact: true }).click()
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === productPath('/sign-in-again') && url.searchParams.has('returnEntryId')
    )
    expect((await page.request.get('/api/access')).status()).toBe(401)
  } finally {
    await console.close()
    await product.close()
  }
})
