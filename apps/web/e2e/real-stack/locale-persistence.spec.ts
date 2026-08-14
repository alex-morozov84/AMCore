import { expect, test } from '@playwright/test'

import { loginViaUi, registerViaUi, uniqueEmail } from './helpers'

test('a locale switch persists to a fresh session on another device/browser', async ({
  page,
  browser,
}) => {
  const email = uniqueEmail('locale')

  await registerViaUi(page, email)
  await expect(page).toHaveURL(/\/en\/?$/)

  await page.getByLabel(/language/i).selectOption('ru')
  await expect(page).toHaveURL(/\/ru\/?$/)

  // A completely fresh context (no cookies, no localStorage) logging in
  // without any locale hint in the URL. Landing on /ru here proves the
  // preference reached `User.locale` server-side via `LocaleSwitcher`'s
  // `PATCH /auth/me` — not just this tab's own cookie/URL state.
  const freshContext = await browser.newContext()
  const freshPage = await freshContext.newPage()
  await loginViaUi(freshPage, email)

  await expect(freshPage).toHaveURL(/\/ru\/?$/)

  await freshContext.close()
})
