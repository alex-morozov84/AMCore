import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { routeProgressController } from './route-progress-controller'
import { useRouteProgressRouter } from './use-route-progress-router'

const push = vi.fn()
const replace = vi.fn()
const back = vi.fn()
const forward = vi.fn()
const refresh = vi.fn()
const prefetch = vi.fn()

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push, replace, back, forward, refresh, prefetch }),
}))

afterEach(() => {
  routeProgressController.dispose()
})

describe('useRouteProgressRouter', () => {
  it('starts the controller and delegates on push', () => {
    const { result } = renderHook(() => useRouteProgressRouter())
    result.current.push('/somewhere', { locale: 'ru' })
    expect(routeProgressController.getPhase()).not.toBe('idle')
    expect(push).toHaveBeenCalledWith('/somewhere', { locale: 'ru' })
  })

  it('starts the controller and delegates on replace', () => {
    const { result } = renderHook(() => useRouteProgressRouter())
    result.current.replace('/somewhere')
    expect(routeProgressController.getPhase()).not.toBe('idle')
    expect(replace).toHaveBeenCalledWith('/somewhere')
  })

  it('starts the controller and delegates on back', () => {
    const { result } = renderHook(() => useRouteProgressRouter())
    result.current.back()
    expect(routeProgressController.getPhase()).not.toBe('idle')
    expect(back).toHaveBeenCalledTimes(1)
  })

  it('starts the controller and delegates on forward', () => {
    const { result } = renderHook(() => useRouteProgressRouter())
    result.current.forward()
    expect(routeProgressController.getPhase()).not.toBe('idle')
    expect(forward).toHaveBeenCalledTimes(1)
  })

  it('passes refresh and prefetch straight through without starting', () => {
    const { result } = renderHook(() => useRouteProgressRouter())
    result.current.refresh()
    result.current.prefetch('/somewhere')
    expect(routeProgressController.getPhase()).toBe('idle')
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(prefetch).toHaveBeenCalledWith('/somewhere')
  })
})
