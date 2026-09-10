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
  await page.route('**/forgot-password**', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500))
    await route.continue()
  })

  await page.goto('/en/login')
  const bar = page.getByTestId('route-progress-bar')
  await expect(bar).toBeHidden()

  await page.getByRole('link', { name: /forgot your password/i }).click()

  await expect(bar).toBeVisible()
  await expect(page).toHaveURL(/\/en\/forgot-password$/)
  await expect(bar).toBeHidden()
})
