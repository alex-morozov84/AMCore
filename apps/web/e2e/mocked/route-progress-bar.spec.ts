import { expect, test } from '@playwright/test'

/**
 * The one thing neither route-progress-controller.test.ts (fake timers, no
 * DOM) nor the Storybook InteractionCycle story (a `fireEvent.click` that
 * Next's real router never sees, so it can only assert "becomes visible")
 * can prove: a real `<Link>` click, through the real App Router, actually
 * finishes the bar once the destination page resolves. `next dev` (this
 * lane's server) never auto-prefetches — see
 * node_modules/next/dist/docs/01-app/02-guides/prefetching.md,
 * "Automatic prefetching runs only in production" — so the click here is
 * guaranteed to be the request under delay, not a cache hit.
 */

test('a delayed Link navigation shows the bar, then hides it once the route resolves', async ({
  page,
}) => {
  let releaseRoute!: () => void
  const routeBlocked = new Promise<void>((resolve) => {
    releaseRoute = resolve
  })
  await page.route('**/forgot-password**', async (route) => {
    await routeBlocked
    await route.continue()
  })

  await page.goto('/en/login')
  await page.locator('html[data-route-progress-ready]').waitFor()
  const bar = page.getByTestId('route-progress-bar')
  await expect(bar).toBeHidden()

  await page.getByRole('link', { name: /forgot your password/i }).click({ noWaitAfter: true })

  await expect(bar).toBeVisible()
  releaseRoute()
  await expect(page).toHaveURL(/\/en\/forgot-password$/)
  await expect(bar).toBeHidden()
})

test('a delayed programmatic navigation (router.replace via the locale switcher) shows the bar', async ({
  page,
}) => {
  let releaseRoute!: () => void
  const routeBlocked = new Promise<void>((resolve) => {
    releaseRoute = resolve
  })
  await page.route('**/ru/login**', async (route) => {
    await routeBlocked
    await route.continue()
  })

  await page.goto('/en/login')
  await page.locator('html[data-route-progress-ready]').waitFor()
  const bar = page.getByTestId('route-progress-bar')
  await page.getByRole('combobox', { name: /language/i }).selectOption('ru')

  await expect(bar).toBeVisible()
  releaseRoute()
  await expect(page).toHaveURL(/\/ru\/login$/)
  await expect(bar).toBeHidden()
})

test('browser back does not strand the bar at the maxDurationMs safety net', async ({ page }) => {
  // Regression for the bug found via hands-on owner testing (fixed in
  // c521f3d): a locale-prefix format mismatch made a popstate landing back
  // on an already-committed page fire a phantom start() with no finish()
  // ever coming, resolved only by the controller's 6s safety net. Asserting
  // hidden well before that proves a real finish() fired, not the timeout.
  await page.goto('/en/login')
  await page.getByRole('link', { name: /sign up/i }).click()
  await expect(page).toHaveURL(/\/en\/register$/)

  const bar = page.getByTestId('route-progress-bar')
  await page.goBack()
  await expect(page).toHaveURL(/\/en\/login$/)
  await expect(bar).toBeHidden({ timeout: 2000 })
})

test('a fast Link navigation to an already-resolved route never shows the bar', async ({
  page,
}) => {
  await page.goto('/en/login')
  // Warm the destination first (next dev never auto-prefetches) so the
  // click below is genuinely fast, not incidentally slow as a first visit.
  await page.goto('/en/register')
  await page.goto('/en/login')

  const bar = page.getByTestId('route-progress-bar')
  await page.getByRole('link', { name: /sign up/i }).click()
  await expect(page).toHaveURL(/\/en\/register$/)
  await expect(bar).toBeHidden()
})

test('a modifier-click never starts the bar in the current tab', async ({ page }) => {
  // Whether the modifier opens a new tab is a platform/browser detail
  // (Cmd on macOS, Ctrl elsewhere) this test doesn't need to settle --
  // Next's own linkClicked() checks metaKey/ctrlKey/shiftKey/altKey
  // identically, so any one of them proves the same exclusion path.
  await page.goto('/en/login')
  const bar = page.getByTestId('route-progress-bar')

  await page.getByRole('link', { name: /sign up/i }).click({ modifiers: ['Shift'] })

  await expect(page).toHaveURL(/\/en\/login$/)
  await expect(bar).toBeHidden()
})

test('reduced motion uses neither crawl animation nor completion transition', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  let releaseRoute!: () => void
  const routeBlocked = new Promise<void>((resolve) => {
    releaseRoute = resolve
  })
  await page.route('**/forgot-password**', async (route) => {
    await routeBlocked
    await route.continue()
  })

  await page.goto('/en/login')
  await page.locator('html[data-route-progress-ready]').waitFor()
  const bar = page.getByTestId('route-progress-bar')
  await page.getByRole('link', { name: /forgot your password/i }).click({ noWaitAfter: true })
  await expect(bar).toBeVisible()
  await expect(bar).toHaveCSS('animation-name', 'none')

  releaseRoute()
  await expect(bar).toHaveAttribute('data-phase', 'completing')
  await expect(bar).toHaveCSS('transition-duration', '0s')
  await expect(bar).toBeHidden()
})
