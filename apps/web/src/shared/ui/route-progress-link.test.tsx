import type { ComponentProps } from 'react'
import { render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createRouteProgressController,
  routeProgressController,
} from '@/shared/lib/route-progress/route-progress-controller'

import { RouteProgressLink } from './route-progress-link'

const pathname = vi.fn(() => '/en')
let capturedOnNavigate: ((event: { preventDefault: () => void }) => void) | undefined

vi.mock('@/i18n/navigation', () => ({
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

const routeProgressFlag = vi.hoisted(() => ({ enabled: true }))
vi.mock('@/shared/lib/route-progress/route-progress-flag', () => ({
  get ROUTE_PROGRESS_ENABLED() {
    return routeProgressFlag.enabled
  },
}))

function fireNavigate() {
  capturedOnNavigate?.({ preventDefault: vi.fn() })
}

afterEach(() => {
  routeProgressController.dispose()
  routeProgressFlag.enabled = true
  pathname.mockReturnValue('/en')
  searchParams.mockReturnValue(new URLSearchParams())
  capturedOnNavigate = undefined
})

describe('RouteProgressLink', () => {
  it('starts the controller on a real navigation to a different page', () => {
    render(<RouteProgressLink href="/other">Other</RouteProgressLink>)
    fireNavigate()
    expect(routeProgressController.getPhase()).not.toBe('idle')
  })

  it('starts the controller for an UrlObject href to a different page', () => {
    render(<RouteProgressLink href={{ pathname: '/other' }}>Other</RouteProgressLink>)
    fireNavigate()
    expect(routeProgressController.getPhase()).not.toBe('idle')
  })

  // Regression target: the caller's own `onNavigate` calling
  // `event.preventDefault()` is a genuine, application-level cancellation
  // (e.g. a confirm-before-leaving guard) -- Next's real `linkClicked()`
  // only proceeds with the navigation once every `onNavigate` handler has
  // run without cancelling, so this must not start the bar either.
  it('does not start when the caller cancels navigation via onNavigate', () => {
    const onNavigate = vi.fn((event: { preventDefault: () => void }) => event.preventDefault())
    render(
      <RouteProgressLink href="/other" onNavigate={onNavigate}>
        Other
      </RouteProgressLink>
    )
    fireNavigate()
    expect(onNavigate).toHaveBeenCalledTimes(1)
    expect(routeProgressController.getPhase()).toBe('idle')
  })

  it("still calls the caller's own onNavigate when navigation proceeds", () => {
    const onNavigate = vi.fn()
    render(
      <RouteProgressLink href="/other" onNavigate={onNavigate}>
        Other
      </RouteProgressLink>
    )
    fireNavigate()
    expect(onNavigate).toHaveBeenCalledTimes(1)
    expect(routeProgressController.getPhase()).not.toBe('idle')
  })

  it('does not start for a link to the current page', () => {
    render(<RouteProgressLink href="/en">Here</RouteProgressLink>)
    fireNavigate()
    expect(routeProgressController.getPhase()).toBe('idle')
  })

  it('does not start for a hash-only link on the current page', () => {
    render(<RouteProgressLink href="/en#section">Here</RouteProgressLink>)
    fireNavigate()
    expect(routeProgressController.getPhase()).toBe('idle')
  })

  it('does not start for the current page plus its current query', () => {
    searchParams.mockReturnValue(new URLSearchParams('tab=details'))
    render(<RouteProgressLink href="/en?tab=details">Here</RouteProgressLink>)
    fireNavigate()
    expect(routeProgressController.getPhase()).toBe('idle')
  })

  it('starts for the current page with a different query', () => {
    searchParams.mockReturnValue(new URLSearchParams('tab=details'))
    render(<RouteProgressLink href="/en?tab=other">Here</RouteProgressLink>)
    fireNavigate()
    expect(routeProgressController.getPhase()).not.toBe('idle')
  })

  it('starts a passed-in controller instead of the singleton (Storybook/test isolation)', () => {
    const isolated = createRouteProgressController()
    render(
      <RouteProgressLink href="/other" controller={isolated}>
        Other
      </RouteProgressLink>
    )
    fireNavigate()
    expect(isolated.getPhase()).not.toBe('idle')
    expect(routeProgressController.getPhase()).toBe('idle')
    isolated.dispose()
  })

  it('does not start when the source flag is disabled', () => {
    routeProgressFlag.enabled = false
    render(<RouteProgressLink href="/other">Other</RouteProgressLink>)
    fireNavigate()
    expect(routeProgressController.getPhase()).toBe('idle')
  })
})
