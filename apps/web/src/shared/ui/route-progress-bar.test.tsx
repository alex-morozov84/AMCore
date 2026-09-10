import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { routeProgressController } from '@/shared/lib/route-progress/route-progress-controller'

import { RouteProgressBar } from './route-progress-bar'

const pathname = vi.fn(() => '/en')
vi.mock('@/i18n/navigation', () => ({
  usePathname: () => pathname(),
}))

const searchParams = vi.fn(() => new URLSearchParams())
vi.mock('next/navigation', () => ({
  useSearchParams: () => searchParams(),
}))

function phaseNode() {
  return document.querySelector('[data-phase]')
}

/** The controller's timers fire outside any React event handler, so
 * flushing them needs an explicit act() to apply the resulting
 * useSyncExternalStore update before assertions run. */
function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  window.history.pushState({}, '', '/en')
  pathname.mockReturnValue('/en')
  searchParams.mockReturnValue(new URLSearchParams())
})

afterEach(() => {
  cleanup() // unmounts before disposing, so the component's own unmount cleanup runs first
  routeProgressController.dispose()
  vi.useRealTimers()
})

describe('RouteProgressBar', () => {
  it('renders nothing while idle', () => {
    render(<RouteProgressBar />)
    expect(phaseNode()).toBeNull()
  })

  // Link clicks start the bar through RouteProgressLink now (see
  // route-progress-link.test.tsx for click/cancellation/same-page
  // filtering) -- this file only covers the two signals a per-Link
  // component cannot: popstate and completion. `start()` is called
  // directly to exercise the bar's own reveal-delay/render behavior
  // without depending on how the caller triggered it.
  it('does not render during the reveal delay, then shows once it elapses', () => {
    render(<RouteProgressBar />)
    routeProgressController.start()
    expect(phaseNode()).toBeNull()
    advance(119)
    expect(phaseNode()).toBeNull()
    advance(1)
    expect(phaseNode()).toHaveAttribute('data-phase', 'visible')
  })

  it('starts on a real popstate to a different path, not on a hash-only one', () => {
    render(<RouteProgressBar />)
    window.history.pushState({}, '', '/en#section')
    window.dispatchEvent(new PopStateEvent('popstate'))
    advance(120)
    expect(phaseNode()).toBeNull()

    window.history.pushState({}, '', '/en/somewhere')
    window.dispatchEvent(new PopStateEvent('popstate'))
    advance(120)
    expect(phaseNode()).toHaveAttribute('data-phase', 'visible')
  })

  // Regression: the locale-aware `usePathname()` is locale-*stripped*
  // (`/login`), but `handlePopState` only has `window.location.pathname`,
  // which is locale-*prefixed* (`/en/login`) -- these mocks model that real
  // divergence, which the other tests above don't (their mocked `pathname`
  // always equals the raw pushState path). Found via hands-on owner testing
  // (repeated Link toggles between two pages, then browser Back): comparing
  // the raw popstate key against the stripped `lastKeyRef` made a popstate
  // landing back on an already-committed page look "different" every time,
  // firing a phantom `start()` with no `finish()` ever coming -- the bar
  // was rescued only by `maxDurationMs`'s 6s safety net.
  it('does not spuriously start on a popstate landing back on the already-committed location (locale-prefix mismatch)', () => {
    pathname.mockReturnValue('/login')
    window.history.pushState({}, '', '/en/login')
    render(<RouteProgressBar />)

    window.dispatchEvent(new PopStateEvent('popstate'))
    advance(120)
    expect(phaseNode()).toBeNull()
  })

  it('finishes and fades out once the pathname commits', () => {
    const { rerender } = render(<RouteProgressBar />)
    routeProgressController.start()
    advance(120)
    expect(phaseNode()).toHaveAttribute('data-phase', 'visible')

    pathname.mockReturnValue('/en/other')
    rerender(<RouteProgressBar />)
    expect(phaseNode()).toHaveAttribute('data-phase', 'completing')

    advance(200)
    expect(phaseNode()).toBeNull()
  })

  it('removes its listeners and disposes the controller on unmount', () => {
    const { unmount } = render(<RouteProgressBar />)
    routeProgressController.start()
    advance(120)
    expect(routeProgressController.getPhase()).toBe('visible')

    unmount()
    expect(routeProgressController.getPhase()).toBe('idle')

    // A popstate after unmount must not resurrect the (now unmounted) listener.
    window.history.pushState({}, '', '/en/other-again')
    window.dispatchEvent(new PopStateEvent('popstate'))
    advance(120)
    expect(routeProgressController.getPhase()).toBe('idle')
  })
})
