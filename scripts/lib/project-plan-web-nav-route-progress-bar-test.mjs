// init:project --mode=single: route-progress-bar.test.tsx (P1 item 8).
// Merges the two separate vi.mock calls (one for @/i18n/navigation's
// usePathname, one for next/navigation's useSearchParams) into a single
// next/navigation mock -- single-locale mode has no @/i18n/navigation to
// mock. The '/en'-prefixed path literals used throughout the rest of this
// file are untouched: they are arbitrary test fixture strings exercising
// this component's own click/popstate/completion logic, not real locale
// routing, so they need no locale-specific rewrite.
import path from 'node:path'
import { fileStep, replaceExactBlock } from './init-engine.mjs'

const BEFORE_BLOCK = `const pathname = vi.fn(() => '/en')
vi.mock('@/i18n/navigation', () => ({
  usePathname: () => pathname(),
}))

const searchParams = vi.fn(() => new URLSearchParams())
vi.mock('next/navigation', () => ({
  useSearchParams: () => searchParams(),
}))
`

const AFTER_BLOCK = `const pathname = vi.fn(() => '/en')
const searchParams = vi.fn(() => new URLSearchParams())
vi.mock('next/navigation', () => ({
  usePathname: () => pathname(),
  useSearchParams: () => searchParams(),
}))
`

export function buildWebNavRouteProgressBarTestSteps(root) {
  return [
    fileStep(
      path.join(root, 'apps/web/src/shared/ui/route-progress-bar.test.tsx'),
      (content) => replaceExactBlock(content, BEFORE_BLOCK, AFTER_BLOCK),
      'route-progress-bar.test.tsx: merge the @/i18n/navigation mock into next/navigation'
    ),
  ]
}
