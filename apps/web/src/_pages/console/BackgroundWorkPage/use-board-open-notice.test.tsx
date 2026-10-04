import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { useBoardOpenNotice } from './use-board-open-notice'

type State = 'available' | 'disabled' | null

describe('useBoardOpenNotice', () => {
  beforeEach(() =>
    window.history.replaceState(null, '', '/en/admin/background-work?board=unavailable&x=1#top')
  )
  afterEach(() => window.history.replaceState(null, '', '/'))

  it('starts as failed only when the marker is present and the board is not confirmed disabled', () => {
    expect(renderHook(() => useBoardOpenNotice(true, 'available')).result.current.failed).toBe(true)
    expect(renderHook(() => useBoardOpenNotice(false, 'available')).result.current.failed).toBe(
      false
    )
    expect(renderHook(() => useBoardOpenNotice(true, 'disabled')).result.current.failed).toBe(false)
  })

  it('removes only the marker from the address, once, so a reload cannot bring it back', () => {
    renderHook(() => useBoardOpenNotice(true, 'available'))
    expect(window.location.pathname + window.location.search + window.location.hash).toBe(
      '/en/admin/background-work?x=1#top'
    )
  })

  it('leaves the address alone when there was no marker', () => {
    window.history.replaceState(null, '', '/en/admin/background-work?board=other')
    renderHook(() => useBoardOpenNotice(false, 'available'))
    expect(window.location.search).toBe('?board=other')
  })

  it('is cleared by the visitor trying again', () => {
    const { result } = renderHook(() => useBoardOpenNotice(true, 'available'))
    act(() => result.current.clear())
    expect(result.current.failed).toBe(false)
  })

  it('is cleared when the confirmed board state changes, in both directions', () => {
    const { result, rerender } = renderHook(
      ({ state }: { state: State }) => useBoardOpenNotice(true, state),
      { initialProps: { state: 'available' as State } }
    )
    expect(result.current.failed).toBe(true)
    rerender({ state: 'disabled' })
    expect(result.current.failed).toBe(false)
    rerender({ state: 'available' })
    expect(result.current.failed).toBe(false)
  })

  it('is not cleared by the same state arriving again or by a loss of live data', () => {
    const { result, rerender } = renderHook(
      ({ state }: { state: State }) => useBoardOpenNotice(true, state),
      { initialProps: { state: 'available' as State } }
    )
    rerender({ state: 'available' })
    rerender({ state: null })
    rerender({ state: 'available' })
    expect(result.current.failed).toBe(true)
  })
})
