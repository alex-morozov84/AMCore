import { act, cleanup, fireEvent, render } from '@testing-library/react'
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

function clickAnchor(href: string, init: MouseEventInit = {}) {
  const anchor = document.createElement('a')
  anchor.href = href
  document.body.appendChild(anchor)
  fireEvent.click(anchor, { button: 0, ...init })
  anchor.remove()
}

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

  it('does not render during the reveal delay, then shows once it elapses', () => {
    render(<RouteProgressBar />)
    clickAnchor('/en/other')
    expect(phaseNode()).toBeNull()
    advance(119)
    expect(phaseNode()).toBeNull()
    advance(1)
    expect(phaseNode()).toHaveAttribute('data-phase', 'visible')
  })

  it('ignores a modifier-key click', () => {
    render(<RouteProgressBar />)
    clickAnchor('/en/other', { metaKey: true })
    advance(120)
    expect(phaseNode()).toBeNull()
  })

  it('ignores a non-primary (e.g. middle) click', () => {
    render(<RouteProgressBar />)
    clickAnchor('/en/other', { button: 1 })
    advance(120)
    expect(phaseNode()).toBeNull()
  })

  it('ignores an external link', () => {
    render(<RouteProgressBar />)
    clickAnchor('https://example.com/somewhere')
    advance(120)
    expect(phaseNode()).toBeNull()
  })

  it('ignores a link to the current path (including hash-only)', () => {
    render(<RouteProgressBar />)
    clickAnchor('/en#section')
    advance(120)
    expect(phaseNode()).toBeNull()
  })

  it('ignores a target="_blank" link', () => {
    render(<RouteProgressBar />)
    const anchor = document.createElement('a')
    anchor.href = '/en/other'
    anchor.target = '_blank'
    document.body.appendChild(anchor)
    fireEvent.click(anchor, { button: 0 })
    anchor.remove()
    advance(120)
    expect(phaseNode()).toBeNull()
  })

  // Deliberately NOT filtered: a click whose default was already prevented
  // still starts the bar. Next's own <Link> unconditionally preventDefaults
  // as part of normal client-side navigation (verified against its real
  // source -- see isQualifyingLinkClick's doc comment), so treating
  // defaultPrevented as "skip this" would reject every real Link click.
  it('still starts on a click whose default was already prevented (e.g. by Link itself)', () => {
    render(<RouteProgressBar />)
    const anchor = document.createElement('a')
    anchor.href = '/en/other'
    anchor.addEventListener('click', (event) => event.preventDefault())
    document.body.appendChild(anchor)
    fireEvent.click(anchor, { button: 0 })
    anchor.remove()
    advance(120)
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

  it('finishes and fades out once the pathname commits', () => {
    const { rerender } = render(<RouteProgressBar />)
    clickAnchor('/en/other')
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
    clickAnchor('/en/other')
    advance(120)
    expect(routeProgressController.getPhase()).toBe('visible')

    unmount()
    expect(routeProgressController.getPhase()).toBe('idle')

    // A click after unmount must not resurrect the (now unmounted) listener.
    clickAnchor('/en/other-again')
    advance(120)
    expect(routeProgressController.getPhase()).toBe('idle')
  })
})
