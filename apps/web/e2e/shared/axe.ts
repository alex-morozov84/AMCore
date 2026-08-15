import { AxeBuilder } from '@axe-core/playwright'
import { expect, type Page } from '@playwright/test'
import type { Result } from 'axe-core'

/**
 * Automated a11y scan for one page/state (Track 7 FINAL PLAN §5,
 * `ai/models-talk.md`). WCAG A/AA tags through 2.2 — `wcag22aa` confirmed
 * present in the installed `axe-core@4.13.0` bundle before use, per the
 * FINAL PLAN's own instruction to verify rather than assume tag support.
 *
 * This is **partial** coverage, not a WCAG pass: automated scanning is
 * documented as catching roughly half of real issues (missing alt text,
 * contrast, landmarks, ARIA misuse — not things like "does this make sense
 * read aloud" or keyboard-trap flows a scanner can't judge). Complements
 * the static token-contrast-pair suite in `theme.test.ts`, does not
 * replace a manual pass.
 */
export async function expectNoAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()

  expect(results.violations, formatViolations(results.violations)).toEqual([])
}

function formatViolations(violations: Result[]): string {
  if (violations.length === 0) return ''
  return violations
    .map((v) => `${v.id} (${v.impact}): ${v.help} — ${v.nodes.length} node(s)`)
    .join('\n')
}

/**
 * Popups (`shared/ui/dropdown-menu.tsx`, `dialog.tsx`, ...) fade/zoom in
 * over `duration-100`. Scanning mid-animation caught a real-looking but
 * false `color-contrast` violation — axe sampled the partially-transparent
 * frame, not the settled color (confirmed live: `getComputedStyle` on the
 * settled element reports the full-strength token color). Wait for the Web
 * Animations API to report nothing running, rather than a fixed sleep tied
 * to today's `duration-100`.
 */
export async function waitForAnimationsToFinish(page: Page, selector: string): Promise<void> {
  await page.waitForFunction((sel) => {
    const el = document.querySelector(sel)
    if (!el) return false
    return el.getAnimations().every((animation) => animation.playState !== 'running')
  }, selector)
}
