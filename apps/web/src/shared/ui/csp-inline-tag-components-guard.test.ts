import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const SHARED_UI_ROOT = path.resolve(import.meta.dirname)

/**
 * Base UI components that render inline `<style>`/`<script>` tags — the
 * only ones Track 3's `CSPProvider` wiring (`app/[locale]/layout.tsx`) was
 * designed against (`ai/models-talk.md` FINAL PLAN §3, citing the installed
 * `@base-ui/react` CSP docs). None of them are in `shared/ui` today —
 * verified below, not assumed.
 *
 * This is deliberately a trip-wire, not a functional check: `CSPProvider`
 * being wired globally means these components *should* just work once
 * added (the same nonce already reaches every Client Component), but
 * "should" is exactly the word FINAL PLAN's own risk section warned about
 * ("adding one later would silently introduce a CSP violation"). This test
 * exists to force a real browser check — under `WEB_CSP_MODE=enforce`,
 * console free of `securitypolicyviolation` — before anyone can quietly
 * trust the wiring, by failing loudly the moment one of these four is
 * introduced. Update this test alongside that verification, not instead
 * of it.
 */
const CSP_SENSITIVE_PATTERNS: { name: string; pattern: RegExp }[] = [
  {
    name: 'ScrollArea (renders an inline <style> to hide native scrollbars)',
    pattern: /\bScrollArea\b/,
  },
  {
    name: 'Tabs.Indicator / TabsIndicator (renders a pre-hydration inline <script>)',
    pattern: /\bTabs\.Indicator\b|\bTabsIndicator\b/,
  },
  {
    name: 'Slider.Thumb / SliderThumb (renders a pre-hydration inline <script>)',
    pattern: /\bSlider\.Thumb\b|\bSliderThumb\b/,
  },
  {
    name: 'Select with alignItemWithTrigger (renders an inline <style> to position the popup)',
    pattern: /alignItemWithTrigger/,
  },
]

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter(
      (entry) => entry.isFile() && /\.tsx?$/.test(entry.name) && !entry.name.endsWith('.test.ts')
    )
    .map((entry) => path.join(entry.parentPath, entry.name))
}

describe('shared/ui does not use a CSP-sensitive Base UI component without re-verifying CSP', () => {
  const files = listSourceFiles(SHARED_UI_ROOT)

  it('found at least one shared/ui source file (the scan itself is not vacuous)', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it.each(CSP_SENSITIVE_PATTERNS)('does not use $name', ({ pattern }) => {
    const offenders = files.filter((file) => pattern.test(readFileSync(file, 'utf8')))

    expect(
      offenders,
      `${offenders.map((f) => path.relative(SHARED_UI_ROOT, f)).join(', ')} — ` +
        'this component needs a real-browser CSP check (WEB_CSP_MODE=enforce, ' +
        'console free of securitypolicyviolation) before this guard can be updated ' +
        'to allow it. See docs/frontend/browser-security-and-csp.md.'
    ).toEqual([])
  })
})
