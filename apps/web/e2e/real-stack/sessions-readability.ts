import { expect, type Locator, type Page, type Route } from '@playwright/test'

import { waitForStableSurface } from '../shared/visual-stability'

export async function waitForSessionTransitions(surface: Locator): Promise<void> {
  await waitForStableSurface(surface)
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
