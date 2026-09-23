import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useDebouncedDraft } from './use-debounced-draft'

const identity = (value: string) => `view:${value}`

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('useDebouncedDraft reconciliation', () => {
  it('tracks only the latest a -> b -> a commit and preserves a newer draft through its echo', () => {
    const onCommit = vi.fn()
    let authoritativeValue = ''
    let authoritativeIdentity = identity('')
    const { result, rerender } = renderHook(() =>
      useDebouncedDraft({
        authoritativeValue,
        authoritativeIdentity,
        getCommitIdentity: identity,
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
    authoritativeIdentity = identity('a')
    rerender()
    expect(result.current.value).toBe('newer')

    authoritativeValue = 'external'
    authoritativeIdentity = identity('external')
    rerender()
    expect(result.current.value).toBe('external')
  })

  it('preserves the accepted exact pending-identity collision', () => {
    const onCommit = vi.fn()
    let authoritativeValue = ''
    let authoritativeIdentity = identity('')
    const { result, rerender } = renderHook(() =>
      useDebouncedDraft({
        authoritativeValue,
        authoritativeIdentity,
        getCommitIdentity: identity,
        delayMs: 300,
        onCommit,
      })
    )

    act(() => result.current.setValue('a'))
    act(() => vi.advanceTimersByTime(300))
    act(() => result.current.setValue('newer'))
    authoritativeValue = 'a'
    authoritativeIdentity = identity('a')
    rerender()
    expect(result.current.value).toBe('newer')
  })

  it('absorbs a stale self echo after discard without restoring the discarded draft', () => {
    const onCommit = vi.fn()
    let authoritativeValue = ''
    let authoritativeIdentity = identity('')
    const { result, rerender } = renderHook(() =>
      useDebouncedDraft({
        authoritativeValue,
        authoritativeIdentity,
        getCommitIdentity: identity,
        delayMs: 300,
        onCommit,
      })
    )

    act(() => result.current.setValue('sent'))
    act(() => vi.advanceTimersByTime(300))
    act(() => result.current.setValue('discard me'))
    act(() => result.current.discardDraft())

    authoritativeValue = 'sent'
    authoritativeIdentity = identity('sent')
    rerender()
    expect(result.current.value).toBe('')
    act(() => vi.advanceTimersByTime(300))
    expect(onCommit).toHaveBeenCalledTimes(1)
  })

  it('does not arm a new commit when discard is followed by a different canonical view', () => {
    const onCommit = vi.fn()
    let authoritativeIdentity = 'view:page-1'
    const { result, rerender } = renderHook(() =>
      useDebouncedDraft({
        authoritativeValue: '',
        authoritativeIdentity,
        getCommitIdentity: () => 'view:page-1',
        delayMs: 300,
        onCommit,
      })
    )

    act(() => result.current.setValue('pending'))
    act(() => result.current.discardDraft())
    authoritativeIdentity = 'view:page-2'
    rerender()
    act(() => vi.advanceTimersByTime(300))

    expect(result.current.value).toBe('')
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('uses latest callback inputs without recommitting an unchanged draft', () => {
    const firstCommit = vi.fn()
    const latestCommit = vi.fn()
    let onCommit = firstCommit
    let identityPrefix = 'old'
    let delayMs = 300
    const { result, rerender } = renderHook(() =>
      useDebouncedDraft({
        authoritativeValue: '',
        authoritativeIdentity: 'initial',
        getCommitIdentity: (value) => `${identityPrefix}:${value}`,
        delayMs,
        onCommit,
      })
    )

    act(() => result.current.setValue('alice'))
    act(() => vi.advanceTimersByTime(200))
    onCommit = latestCommit
    identityPrefix = 'latest'
    rerender()
    act(() => vi.advanceTimersByTime(100))

    expect(firstCommit).not.toHaveBeenCalled()
    expect(latestCommit).toHaveBeenCalledOnce()
    delayMs = 100
    rerender()
    act(() => vi.advanceTimersByTime(1000))
    expect(latestCommit).toHaveBeenCalledOnce()
  })
})
