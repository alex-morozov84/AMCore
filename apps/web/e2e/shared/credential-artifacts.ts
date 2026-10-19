import type { Page, TestInfo } from '@playwright/test'

/** Playwright also captures failure DOM context when screenshots and traces are off. */
export async function closeCredentialPage(page: Page, info: TestInfo) {
  for (const error of info.errors)
    error.errorContext =
      'Credential flow: DOM context omitted. Failure status and assertions retained.'
  if (!page.isClosed()) await page.close()
}
