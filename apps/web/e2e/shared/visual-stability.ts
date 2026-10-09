import { expect, type Locator, type Page } from '@playwright/test'

/** Observe real final styles; never disable motion or retry an axe violation. */
export async function waitForStableSurface(surface: Locator): Promise<void> {
  await expect(surface).toBeVisible()
  await expect
    .poll(
      () =>
        surface.evaluate(async (element) => {
          element.getBoundingClientRect()
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
          return element
            .getAnimations({ subtree: true })
            .filter((animation) => {
              const timing = animation.effect?.getComputedTiming()
              return (
                timing &&
                Number.isFinite(timing.endTime) &&
                (animation.pending ||
                  animation.playState === 'running' ||
                  animation.playState === 'paused')
              )
            })
            .map((animation) => ({
              state: animation.playState,
              endTime: animation.effect?.getComputedTiming().endTime,
            }))
        }),
      {
        timeout: 10_000,
        message: 'Finite visual transitions must settle before accessibility scan',
      }
    )
    .toEqual([])
}

/**
 * A visible region that declares itself busy (`aria-busy="true"`) is still loading: its controls may be
 * in a half-transparent pending state that is stable, so visual stability cannot see it. Scanning or
 * counting requests then measures a state the person never settles in.
 */
export async function waitForIdleRegions(page: Page): Promise<void> {
  await expect
    .poll(() => page.locator('[aria-busy="true"]:visible').count(), {
      timeout: 10_000,
      message:
        'A visible region is still aria-busy. Assert the loaded state first, or pass { allowBusy: true } when the busy state itself is under test.',
    })
    .toBe(0)
}

export async function waitForVisualStability(page: Page, selector = 'html'): Promise<void> {
  await page.waitForFunction(() => document.fonts.status === 'loaded', {}, { timeout: 10_000 })
  await waitForStableSurface(page.locator(selector))
}
