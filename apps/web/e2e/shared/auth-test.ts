import { test as proxyTest } from 'next/experimental/testmode/playwright/msw'
import { http, HttpResponse } from 'msw'

/** Existing public-auth scenarios explicitly run with public signup enabled. */
export const test = proxyTest.extend<{ publicSignupPolicy: void }>({
  publicSignupPolicy: [
    async ({ msw }, use) => {
      msw.use(
        http.get('http://api.mocked.invalid/api/v1/auth/signup-policy', () =>
          HttpResponse.json({ publicSignupEnabled: true })
        )
      )
      await use()
    },
    { auto: true },
  ],
})
