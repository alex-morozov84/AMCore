import { expect, waitFor } from 'storybook/test'

/** Assert the intended visible/open state before waiting for fonts and finite motion. */
export async function waitForStorybookVisualStability(element: Element) {
  await waitFor(() => expect(element.ownerDocument.fonts.status).toBe('loaded'), {
    timeout: 10_000,
  })
  await waitFor(
    async () => {
      element.getBoundingClientRect()
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
      const active = element.getAnimations({ subtree: true }).filter((animation) => {
        const timing = animation.effect?.getComputedTiming()
        return (
          timing &&
          Number.isFinite(timing.endTime) &&
          (animation.pending ||
            animation.playState === 'running' ||
            animation.playState === 'paused')
        )
      })
      expect(active).toHaveLength(0)
    },
    { timeout: 10_000 }
  )
}
