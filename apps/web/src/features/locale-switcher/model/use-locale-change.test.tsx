import { type ReactNode, Suspense, use, useState } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { SUPPORTED_LOCALES } from '@amcore/shared'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'

import { useLocaleChange } from './use-locale-change'

const state = vi.hoisted(() => ({ replace: vi.fn() }))
vi.mock('client-only', () => ({}))
vi.mock('@/i18n/navigation', () => ({ usePathname: () => '/login' }))
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('tag=a&tag=b') }))
vi.mock('@/shared/lib/route-progress/use-route-progress-router', () => ({
  useRouteProgressRouter: () => ({ replace: state.replace }),
}))
const first = SUPPORTED_LOCALES[0]
const second = SUPPORTED_LOCALES.at(-1)!
function Provider({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale={first} messages={{}}>
      {children}
    </NextIntlClientProvider>
  )
}
beforeEach(() => {
  state.replace.mockReset()
  window.history.replaceState({}, '', '/login#initial')
})

it('rejects unsupported and active choices before profile or router side effects', () => {
  const persist = vi.fn()
  const { result } = renderHook(() => useLocaleChange(persist), { wrapper: Provider })
  act(() => {
    result.current.change('unsupported')
    result.current.change(first)
  })
  expect(state.replace).not.toHaveBeenCalled()
  expect(persist).not.toHaveBeenCalled()
})

it('uses event-time hash and recovers committed selection when navigation makes no commit', () => {
  const persist = vi.fn()
  const { result } = renderHook(() => useLocaleChange(persist), { wrapper: Provider })
  window.history.replaceState({}, '', '/login#changed#tail')
  act(() => result.current.change(second))
  expect(state.replace).toHaveBeenCalledExactlyOnceWith('/login?tag=a&tag=b#changed#tail', {
    locale: second,
  })
  expect(persist).toHaveBeenCalledExactlyOnceWith(second)
  expect(result.current.pending).toBe(false)
  expect(result.current.value).toBe(first)
})

it('keeps requested selection and rejects repeats during a real suspended React transition', async () => {
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const persist = vi.fn()
  function Waiting({ blocked, children }: { blocked: boolean; children: ReactNode }) {
    if (blocked) use(gate)
    return children
  }
  function Frame({ children }: { children: ReactNode }) {
    const [blocked, setBlocked] = useState(false)
    state.replace.mockImplementation(() => setBlocked(true))
    return (
      <Provider>
        <Suspense fallback="waiting">
          <Waiting blocked={blocked}>{children}</Waiting>
        </Suspense>
      </Provider>
    )
  }
  const { result } = renderHook(() => useLocaleChange(persist), { wrapper: Frame })
  await act(async () => result.current.change(second))
  expect(result.current.pending).toBe(true)
  expect(result.current.value).toBe(second)
  await act(async () => result.current.change(second))
  expect(state.replace).toHaveBeenCalledTimes(1)
  expect(persist).toHaveBeenCalledTimes(1)
  await act(async () => {
    release()
    await gate
  })
  expect(result.current.pending).toBe(false)
  expect(result.current.value).toBe(first)
})
