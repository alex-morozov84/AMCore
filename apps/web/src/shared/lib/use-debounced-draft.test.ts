import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useDebouncedDraft } from './use-debounced-draft'

const identity = (value: string) => `view:${value}`

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('useDebouncedDraft', () => {
  it('debounces rapid edits and normalizes only the final commit', () => {
    const onCommit = vi.fn()
    const { result } = renderHook(() =>
      useDebouncedDraft({
        authoritativeValue: '',
        authoritativeIdentity: identity(''),
        getCommitIdentity: identity,
        delayMs: 300,
        normalize: (value) => value.trim(),
        onCommit,
      })
    )

    act(() => vi.advanceTimersByTime(300))
    expect(onCommit).not.toHaveBeenCalled()
    act(() => result.current.setValue(' a'))
    act(() => vi.advanceTimersByTime(200))
    act(() => result.current.setValue(' ab '))
    act(() => vi.advanceTimersByTime(300))

    expect(onCommit).toHaveBeenCalledOnce()
    expect(onCommit).toHaveBeenCalledWith('ab')
  })

  it('resets for a different identity even when the authoritative string is unchanged', () => {
    const onCommit = vi.fn()
    let sort = 'name'
    let authoritativeIdentity = `sort:${sort}:alice`
    const { result, rerender } = renderHook(() =>
      useDebouncedDraft({
        authoritativeValue: 'alice',
        authoritativeIdentity,
        getCommitIdentity: (value) => `sort:${sort}:${value}`,
        delayMs: 300,
        onCommit,
      })
    )

    act(() => result.current.setValue('draft'))
    sort = 'createdAt'
    authoritativeIdentity = `sort:${sort}:alice`
    rerender()
    expect(result.current.value).toBe('alice')
    act(() => vi.advanceTimersByTime(300))
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('commits immediately once and discards an armed draft synchronously', () => {
    const onCommit = vi.fn()
    const { result } = renderHook(() =>
      useDebouncedDraft({
        authoritativeValue: 'alice',
        delayMs: 300,
        onCommit,
      })
    )

    act(() => result.current.setValue('bob'))
    act(() => result.current.commitNow('bob'))
    act(() => result.current.commitNow('bob'))
    act(() => vi.advanceTimersByTime(300))
    expect(onCommit).toHaveBeenCalledTimes(1)

    act(() => result.current.setValue('carol'))
    act(() => result.current.discardDraft())
    expect(result.current.value).toBe('alice')
    act(() => vi.advanceTimersByTime(300))
    expect(onCommit).toHaveBeenCalledTimes(1)
  })
})
