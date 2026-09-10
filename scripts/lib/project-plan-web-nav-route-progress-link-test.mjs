// init:project --mode=single: route-progress-link.test.tsx (P1 item 8,
// reconverged FINAL PLAN item 5). Mocks next/link's default export and
// merges usePathname into the next/navigation mock -- single-locale mode
// has no @/i18n/navigation to mock, and the real route-progress-link.tsx
// (see its own transform) imports from next/link/next/navigation there
// too, so the mock targets must follow it. Verified empirically (real
// vitest run against a disposable copy paired with the single-locale
// component), not guessed.
import path from 'node:path'
import { fileStep, replaceExactBlock } from './init-engine.mjs'

const BEFORE_BLOCK = `vi.mock('@/i18n/navigation', () => ({
  usePathname: () => pathname(),
  Link: ({
    href,
    onNavigate,
    children,
    ...rest
  }: Omit<ComponentProps<'a'>, 'href'> & {
    href: string | { pathname?: string }
    onNavigate?: (event: { preventDefault: () => void }) => void
  }) => {
    capturedOnNavigate = onNavigate
    const resolvedHref = typeof href === 'string' ? href : (href.pathname ?? '')
    return (
      <a href={resolvedHref} {...rest}>
        {children}
      </a>
    )
  },
}))

const searchParams = vi.fn(() => new URLSearchParams())
vi.mock('next/navigation', () => ({
  useSearchParams: () => searchParams(),
}))
`

const AFTER_BLOCK = `vi.mock('next/link', () => ({
  default: ({
    href,
    onNavigate,
    children,
    ...rest
  }: Omit<ComponentProps<'a'>, 'href'> & {
    href: string | { pathname?: string }
    onNavigate?: (event: { preventDefault: () => void }) => void
  }) => {
    capturedOnNavigate = onNavigate
    const resolvedHref = typeof href === 'string' ? href : (href.pathname ?? '')
    return (
      <a href={resolvedHref} {...rest}>
        {children}
      </a>
    )
  },
}))

const searchParams = vi.fn(() => new URLSearchParams())
vi.mock('next/navigation', () => ({
  usePathname: () => pathname(),
  useSearchParams: () => searchParams(),
}))
`

export function buildWebNavRouteProgressLinkTestSteps(root) {
  return [
    fileStep(
      path.join(root, 'apps/web/src/shared/ui/route-progress-link.test.tsx'),
      (content) => replaceExactBlock(content, BEFORE_BLOCK, AFTER_BLOCK),
      'route-progress-link.test.tsx: mock next/link and next/navigation instead of @/i18n/navigation'
    ),
  ]
}
