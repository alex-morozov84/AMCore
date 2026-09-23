import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useDebouncedDraft } from './use-debounced-draft'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('useDebouncedDraft self echoes', () => {
  it('does not retain an unobservable duplicate echo after authority moves on', () => {
    const onCommit = vi.fn()
    let authoritativeValue = ''
    let authoritativeIdentity = 'view:'
    const { result, rerender } = renderHook(() =>
      useDebouncedDraft({
        authoritativeValue,
        authoritativeIdentity,
        getCommitIdentity: (value) => `view:${value}`,
        delayMs: 300,
        onCommit,
      })
    )

    for (const value of ['a', 'b', 'a']) {
      act(() => result.current.setValue(value))
      act(() => vi.advanceTimersByTime(300))
    }

    for (const value of ['a', 'a', 'b', 'c']) {
      authoritativeValue = value
      authoritativeIdentity = `view:${value}`
      rerender()
    }

    act(() => result.current.setValue('next draft'))
    authoritativeValue = 'a'
    authoritativeIdentity = 'view:a'
    rerender()

    expect(result.current.value).toBe('a')
  })

  it('supersedes older expectations when rapid commits target a -> b -> a', () => {
    const onCommit = vi.fn()
    let authoritativeValue = ''
    let authoritativeIdentity = 'view:'
    const { result, rerender } = renderHook(() =>
      useDebouncedDraft({
        authoritativeValue,
        authoritativeIdentity,
        getCommitIdentity: (value) => `view:${value}`,
        delayMs: 300,
        onCommit,
      })
    )

    for (const value of ['a', 'b', 'a']) {
      act(() => result.current.setValue(value))
      act(() => vi.advanceTimersByTime(300))
    }
    act(() => result.current.setValue('newer'))

    authoritativeValue = 'a'
    authoritativeIdentity = 'view:a'
    rerender()
    expect(result.current.value).toBe('newer')

    act(() => vi.advanceTimersByTime(300))
    expect(onCommit).toHaveBeenLastCalledWith('newer')
    expect(onCommit).toHaveBeenCalledTimes(4)
  })
})
