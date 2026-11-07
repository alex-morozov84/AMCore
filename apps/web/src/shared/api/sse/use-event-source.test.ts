import { useLayoutEffect } from 'react'
import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { useEventSource } from './use-event-source'

class FakeEventSource {
  static instances: FakeEventSource[] = []
  onopen: (() => void) | null = null
  onmessage: ((event: MessageEvent<string>) => void) | null = null
  closed = false
  constructor(
    public url: string,
    public init: EventSourceInit
  ) {
    FakeEventSource.instances.push(this)
  }
  close() {
    this.closed = true
  }
}

const schema = z.object({ eventId: z.string(), reason: z.string() })

afterEach(() => {
  FakeEventSource.instances = []
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('useEventSource', () => {
  it('opens a same-origin EventSource with credentials and fires onOpen', () => {
    vi.stubGlobal('EventSource', FakeEventSource)
    const onOpen = vi.fn()

    renderHook(() =>
      useEventSource({ url: '/api/notifications/stream', schema, onOpen, onEvent: vi.fn() })
    )

    const source = FakeEventSource.instances[0]!
    expect(source.url).toBe('/api/notifications/stream')
    expect(source.init).toEqual({ withCredentials: true })
    source.onopen?.()
    expect(onOpen).toHaveBeenCalledOnce()
  })

  it('parses a valid frame and invokes onEvent', () => {
    vi.stubGlobal('EventSource', FakeEventSource)
    const onEvent = vi.fn()

    renderHook(() => useEventSource({ url: '/api/notifications/stream', schema, onEvent }))

    const source = FakeEventSource.instances[0]!
    source.onmessage?.({
      data: JSON.stringify({ eventId: 'e1', reason: 'created' }),
    } as MessageEvent<string>)

    expect(onEvent).toHaveBeenCalledWith({ eventId: 'e1', reason: 'created' })
  })

  it('drops an unparseable frame instead of throwing or invoking onEvent', () => {
    vi.stubGlobal('EventSource', FakeEventSource)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const onEvent = vi.fn()

    renderHook(() => useEventSource({ url: '/api/notifications/stream', schema, onEvent }))

    const source = FakeEventSource.instances[0]!
    expect(() => source.onmessage?.({ data: 'not json' } as MessageEvent<string>)).not.toThrow()
    expect(() =>
      source.onmessage?.({ data: JSON.stringify({ nope: true }) } as MessageEvent<string>)
    ).not.toThrow()

    expect(onEvent).not.toHaveBeenCalled()
  })

  it('does not connect when disabled or url is null', () => {
    vi.stubGlobal('EventSource', FakeEventSource)

    renderHook(() => useEventSource({ url: null, schema, onEvent: vi.fn() }))
    renderHook(() => useEventSource({ url: '/api/x', schema, onEvent: vi.fn(), enabled: false }))

    expect(FakeEventSource.instances).toHaveLength(0)
  })

  it.each([
    ['an absolute URL', 'https://api.example.com/notifications/stream'],
    ['a protocol-relative URL', '//api.example.com/notifications/stream'],
    ['a path outside /api/', '/notifications/stream'],
  ])('refuses to connect to %s instead of silently bypassing the BFF', (_label, url) => {
    vi.stubGlobal('EventSource', FakeEventSource)

    expect(() => renderHook(() => useEventSource({ url, schema, onEvent: vi.fn() }))).toThrow(
      /must be a relative BFF path/
    )
    expect(FakeEventSource.instances).toHaveLength(0)
  })

  it('closes the connection on unmount', () => {
    vi.stubGlobal('EventSource', FakeEventSource)

    const { unmount } = renderHook(() =>
      useEventSource({ url: '/api/notifications/stream', schema, onEvent: vi.fn() })
    )
    const source = FakeEventSource.instances[0]!

    unmount()

    expect(source.closed).toBe(true)
  })
})

it.each(['key', 'url', 'enabled'] as const)(
  'rejects saved handlers before cleanup and after %s cycling',
  (mode) => {
    vi.stubGlobal('EventSource', FakeEventSource)
    const onOpen = vi.fn()
    const onEvent = vi.fn()
    const frame = {
      data: JSON.stringify({ eventId: 'e', reason: 'created' }),
    } as MessageEvent<string>
    let oldOpen: (() => void) | null = null
    let oldMessage: ((event: MessageEvent<string>) => void) | null = null
    const { rerender, unmount } = renderHook(
      ({ changed }) => {
        useEventSource({
          url: mode === 'url' && changed ? '/api/b' : '/api/a',
          enabled: mode !== 'enabled' || !changed,
          connectionKey: mode === 'key' ? (changed ? 'b' : 'a') : undefined,
          schema,
          onOpen,
          onEvent,
        })
        useLayoutEffect(() => {
          if (changed) {
            oldOpen?.()
            oldMessage?.(frame)
          }
        }, [changed])
      },
      { initialProps: { changed: false } }
    )
    const old = FakeEventSource.instances[0]!
    oldOpen = old.onopen
    oldMessage = old.onmessage
    rerender({ changed: true })
    expect(old.closed).toBe(true)
    expect(onOpen).not.toHaveBeenCalled()
    expect(onEvent).not.toHaveBeenCalled()
    rerender({ changed: false })
    oldOpen?.()
    oldMessage?.(frame)
    expect(onOpen).not.toHaveBeenCalled()
    expect(onEvent).not.toHaveBeenCalled()
    const active = FakeEventSource.instances.at(-1)!
    const activeOpen = active.onopen!
    const activeMessage = active.onmessage!
    activeOpen()
    activeMessage(frame)
    expect(onOpen).toHaveBeenCalledOnce()
    expect(onEvent).toHaveBeenCalledOnce()
    unmount()
    activeOpen()
    activeMessage(frame)
    expect(onOpen).toHaveBeenCalledOnce()
    expect(onEvent).toHaveBeenCalledOnce()
  }
)

it('keeps the source and uses latest callbacks and schema for the same connection', () => {
  vi.stubGlobal('EventSource', FakeEventSource)
  const first = vi.fn(),
    latest = vi.fn()
  const { rerender } = renderHook(
    ({ updated }) =>
      useEventSource({
        url: '/api/a',
        schema: updated ? z.object({ fresh: z.boolean() }) : z.object({ old: z.string() }),
        onOpen: updated ? latest : first,
        onEvent: updated ? latest : first,
      }),
    { initialProps: { updated: false } }
  )
  rerender({ updated: true })
  expect(FakeEventSource.instances).toHaveLength(1)
  const source = FakeEventSource.instances[0]!
  source.onopen?.()
  source.onmessage?.({ data: JSON.stringify({ fresh: true }) } as MessageEvent<string>)
  expect(first).not.toHaveBeenCalled()
  expect(latest).toHaveBeenNthCalledWith(2, { fresh: true })
})
