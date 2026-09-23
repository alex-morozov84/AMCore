import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useDebouncedDraft } from './use-debounced-draft'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('useDebouncedDraft self echoes', () => {
  it('absorbs outstanding self echoes that arrive out of commit order', () => {
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

    for (const value of ['a', 'b', 'c']) {
      act(() => result.current.setValue(value))
      act(() => vi.advanceTimersByTime(300))
    }
    act(() => result.current.setValue('newer'))

    for (const value of ['b', 'a', 'c']) {
      authoritativeValue = value
      authoritativeIdentity = `view:${value}`
      rerender()
      expect(result.current.value).toBe('newer')
    }

    act(() => vi.advanceTimersByTime(300))
    expect(onCommit).toHaveBeenLastCalledWith('newer')
    expect(onCommit).toHaveBeenCalledTimes(4)
  })
})
