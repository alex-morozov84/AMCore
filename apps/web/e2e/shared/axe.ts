import { AxeBuilder } from '@axe-core/playwright'
import { expect, type Page } from '@playwright/test'
import type { Result } from 'axe-core'

import { waitForVisualStability } from './visual-stability'

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
/** Scoped checks retain their rules and pass evidence while sharing readiness. */
export async function scanAccessibility(
  page: Page,
  options: { include?: string; rules?: string[]; tags?: string[] } = {}
) {
  await waitForVisualStability(page)
  const builder = new AxeBuilder({ page })
  if (options.include) builder.include(options.include)
  if (options.rules) builder.withRules(options.rules)
  if (options.tags) builder.withTags(options.tags)
  return builder.analyze()
}

export async function expectNoAxeViolations(page: Page): Promise<void> {
  const results = await scanAccessibility(page, {
    tags: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
  })
  expect(results.violations, formatViolations(results.violations)).toEqual([])
}

function formatViolations(violations: Result[]): string {
  if (violations.length === 0) return ''
  return violations
    .map((v) => `${v.id} (${v.impact}): ${v.help} — ${v.nodes.length} node(s)`)
    .join('\n')
}

/** Retained for callers that explicitly assert a popup's settled state. */
export async function waitForAnimationsToFinish(page: Page, selector: string): Promise<void> {
  await waitForVisualStability(page, selector)
}
