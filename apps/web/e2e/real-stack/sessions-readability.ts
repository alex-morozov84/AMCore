import { expect, type Locator, type Page, type Route } from '@playwright/test'

/** Observe only finite transitions in the tested Session surface, never its spinner. */
export async function waitForSessionTransitions(surface: Locator): Promise<void> {
  await expect(surface).toBeVisible()
  await expect
    .poll(() =>
      surface.evaluate((element) => {
        // Force style resolution before inspecting transitions created by the latest state change.
        element.getBoundingClientRect()
        return element.getAnimations({ subtree: true }).filter((animation) => {
          const timing = animation.effect?.getComputedTiming()
          return timing?.iterations !== Infinity && animation.playState === 'running'
        }).length
      })
    )
    .toBe(0)
}

/** Relay a real authenticated response unchanged, but keep the refetch pending until release. */
export async function holdSessionRefetch(page: Page, url: string) {
  let release!: () => void
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  const active = new Set<Promise<void>>()
  const held = {
    captured: 0,
    released: false,
    release: () => {
      held.released = true
      release()
    },
  }
  const handler = (route: Route) => {
    const work = (async () => {
      const response = await route.fetch()
      expect(response.ok()).toBe(true)
      held.captured += 1
      await pending
      await route.fulfill({ response })
    })()
    active.add(work)
    return work.finally(() => active.delete(work))
  }
  await page.route(url, handler)
  return {
    ...held,
    get captured() {
      return held.captured
    },
    get released() {
      return held.released
    },
    async dispose() {
      held.release()
      try {
        await Promise.all(active)
      } finally {
        await page.unroute(url, handler)
      }
    },
  }
}
