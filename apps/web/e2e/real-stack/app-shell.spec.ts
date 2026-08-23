import { expect, test } from '@playwright/test'

import { registerViaUi, uniqueEmail } from './helpers'

/**
 * The dashboard app shell (`widgets/app-shell`, Track 9). Two things only
 * the real stack can prove, both found worth asserting during PR3's review:
 *
 * 1. **The mobile Sheet variant.** `Sidebar` renders an entirely different
 *    tree below `md` (a `Sheet`, not the desktop rail) — a responsive path
 *    a desktop-only check never touches.
 * 2. **Cookie-backed collapse state.** `SidebarProvider` writes
 *    `sidebar_state` client-side and `(dashboard)/layout.tsx` reads it back
 *    server-side via `await cookies()`. Nothing below the real standalone
 *    server exercises that round trip: a Storybook story has no server, and
 *    the mocked lane has no real `cookies()`.
 */
test.describe('dashboard app shell', () => {
  test('mobile viewport opens the sidebar as a Sheet and navigates from it', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await registerViaUi(page, uniqueEmail('app-shell-mobile'), { name: 'E2E Test' })
    await expect(page).toHaveURL(/\/en\/?$/)

    // Below `md` the desktop sidebar tree is `hidden md:block`, and the
    // mobile one only exists once the Sheet is open.
    await expect(page.locator('[data-slot="sidebar"][data-mobile="true"]')).toHaveCount(0)

    await page.getByRole('button', { name: /toggle sidebar/i }).click()

    const mobileSidebar = page.locator('[data-slot="sidebar"][data-mobile="true"]')
    await expect(mobileSidebar).toBeVisible()
    // The sr-only heading comes from `Sidebar`'s required `mobileTitle`
    // prop — proof the caller-supplied translated label really reaches the
    // Sheet, rather than the English literal shadcn generated.
    await expect(mobileSidebar.getByRole('heading', { name: 'Navigation' })).toBeAttached()

    // Navigating from inside the Sheet: `SidebarMenuButton render={<Link/>}`
    // composes Base UI's `render` prop with next-intl's locale-aware Link.
    await mobileSidebar.getByRole('link', { name: 'Active sessions' }).click()
    await expect(page).toHaveURL(/\/en\/settings\/sessions/)

    // The Sheet must close itself on navigate — shadcn's primitive does not
    // do this, so `NavMenu` calls `setOpenMobile(false)`. Without it the
    // menu stays open on top of the page the user just navigated to.
    await expect(mobileSidebar).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Active sessions' })).toBeVisible()
  })

  test('collapsed sidebar state survives a reload via the sidebar_state cookie', async ({
    page,
  }) => {
    await registerViaUi(page, uniqueEmail('app-shell-cookie'), { name: 'E2E Test' })
    await expect(page).toHaveURL(/\/en\/?$/)

    const sidebar = page.locator('[data-slot="sidebar"]').first()
    await expect(sidebar).toHaveAttribute('data-state', 'expanded')

    await page
      .getByRole('button', { name: /toggle sidebar/i })
      .first()
      .click()
    await expect(sidebar).toHaveAttribute('data-state', 'collapsed')

    // The real proof: a full reload re-renders the layout on the server,
    // which must read the cookie back and pass it down as `defaultOpen`.
    // Without that server-side read this reverts to `expanded` every time.
    await page.reload()
    await expect(page.locator('[data-slot="sidebar"]').first()).toHaveAttribute(
      'data-state',
      'collapsed'
    )
  })
})
