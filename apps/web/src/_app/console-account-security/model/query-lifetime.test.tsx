import type { ReactNode } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { type AdminSessionsListResponse, DEFAULT_LOCALE, type MfaBrowserView } from '@amcore/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { ConsoleLoginForm } from '@/features/console-login'
import { ConsoleLogoutButton } from '@/features/console-logout'
import { UserSessionsCard } from '@/features/console-user-sessions'

import en from '../../../../messages/en.json'
// Test-only composition: exercise the real sibling mounts without expanding their public APIs.
// eslint-disable-next-line boundaries/dependencies
import { AccountSecurityClient } from '../../account-security/ui/client'
// eslint-disable-next-line boundaries/dependencies
import { SignInAgainClient } from '../../account-security/ui/sign-in-again-client'
import { ConsoleAccountSecurityClient } from '../ui/client'

const route = vi.hoisted(() => ({ mode: 'path', push: vi.fn(), replace: vi.fn(), flow: '' }))
vi.mock('@/shared/lib/admin-console-topology', () => ({
  ADMIN_CONSOLE_CONFIG: {
    get mode() {
      return route.mode
    },
    enabled: true,
    alias: 'admin',
  },
}))
vi.mock('@/shared/lib/route-progress/use-route-progress-router', () => ({
  useRouteProgressRouter: () => ({ push: route.push, replace: route.replace }),
}))
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams({ flow: route.flow }),
}))
vi.mock('@/i18n/navigation', () => ({ usePathname: () => '/admin/users/target' }))
vi.mock('@/shared/ui/route-progress-link', () => ({
  RouteProgressLink: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

const key = ['console', 'userSessions', 'target', DEFAULT_LOCALE, 1, 20] as const
const oldIp = '192.0.2.11'
const newIp = '192.0.2.22'
const placement = {
  apiBase: '/auth/mfa',
  logoutPath: '/auth/logout',
  passwordRecoveryHref: '/forgot-password',
  loginHref: '/login',
  completeHref: '/',
} as const
function held<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
function rows(ipAddress: string): AdminSessionsListResponse {
  return {
    data: [
      {
        sessionId: ipAddress,
        ipAddress,
        userAgent: null,
        location: null,
        lastAuthAt: '2026-11-06T00:00:00.000Z',
        createdAt: '2026-11-06T00:00:00.000Z',
        expiresAt: '2030-01-01T00:00:00.000Z',
      },
    ],
    total: 1,
    page: 1,
    limit: 20,
  }
}
function setup(mode: 'path' | 'host', operator: string) {
  route.mode = mode
  route.flow = crypto.randomUUID()
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: 60000, gcTime: 300000 } },
  })
  const first = held<Response>()
  const next = held<Response>()
  const requests: string[] = []
  const commands: string[] = []
  let getCount = 0
  let published = false
  const view: Extract<MfaBrowserView, { kind: 'flow' }> = {
    kind: 'flow',
    flowBinding: route.flow,
    accountLabel: `${operator}@example.test`,
    purpose: 'login',
    state: 'verify_required',
    expiresAt: '2030-01-01T00:00:00.000Z',
    requiredProofs: ['second_factor'],
    remainingCodes: 5,
    generation: 0,
  }
  const json = (body: unknown) => Response.json(body)
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      requests.push(`${init?.method ?? 'GET'} ${url}`)
      if (url.includes('/users/target/sessions?'))
        return ++getCount === 1 ? first.promise : next.promise
      if (url.endsWith('/browser-context')) return json({ attemptId: crypto.randomUUID() })
      if (url.endsWith('/login')) return json({ kind: 'mfa', flowBinding: route.flow })
      if (url.includes('/auth/mfa')) {
        if ((init?.method ?? 'GET') === 'GET') return json(view)
        const command = JSON.parse(String(init?.body)) as { action: string; flowBinding: string }
        expect(command.flowBinding).toBe(route.flow)
        commands.push(command.action)
        if (command.action === 'verify')
          return json({ view: { ...view, state: 'ready', requiredProofs: [] } })
        expect(command.action).toBe('settle_login')
        published = true
        return json({
          view: { ...view, state: 'completed', requiredProofs: [], publication: 'confirmed' },
        })
      }
      if (url.endsWith('/sign-in-entry')) return json({ returnEntryId: crypto.randomUUID() })
      if (url.endsWith('/logout')) return json({ outcome: 'signed_out' })
      throw new Error(`Unexpected diagnostic request: ${url}`)
    })
  )
  const wrapper = ({ children }: { children: ReactNode }) => (
    <NextIntlClientProvider locale={DEFAULT_LOCALE} messages={en} timeZone="UTC">
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </NextIntlClientProvider>
  )
  const card = () =>
    render(<UserSessionsCard userId="target" targetEmail="target@example.test" isSelf />, {
      wrapper,
    })
  return {
    client,
    first,
    next,
    requests,
    commands,
    card,
    wrapper,
    getCount: () => getCount,
    published: () => published,
  }
}
async function login(f: ReturnType<typeof setup>, mode: 'path' | 'host', operator: string) {
  const form = render(
    mode === 'host' ? (
      <ConsoleLoginForm />
    ) : (
      <SignInAgainClient
        placement={{
          apiBase: '/auth',
          mfaHref: '/mfa',
          destination: '/admin',
          entryKind: 'console',
        }}
        entryId={crypto.randomUUID()}
        locale={DEFAULT_LOCALE}
      />
    ),
    { wrapper: f.wrapper }
  )
  fireEvent.change(screen.getByLabelText('Email'), {
    target: { value: `${operator}@example.test` },
  })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: '<fake-password>' } })
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
  await waitFor(() =>
    expect(mode === 'host' ? route.push : route.replace).toHaveBeenCalledWith(
      `/mfa?flow=${route.flow}`
    )
  )
  expect(f.published()).toBe(false)
  expect(f.client.getQueryCache().find({ queryKey: key, exact: true })).toBeUndefined()
  form.unmount()
  const mfa = render(
    mode === 'host' ? (
      <ConsoleAccountSecurityClient />
    ) : (
      <AccountSecurityClient placement={placement} />
    ),
    { wrapper: f.wrapper }
  )
  fireEvent.change(await screen.findByLabelText(en.accountMfa.appCode), {
    target: { value: '012345' },
  })
  fireEvent.click(screen.getByRole('button', { name: en.accountMfa.signIn }))
  await waitFor(() => expect(route.replace).toHaveBeenCalledWith('/'))
  expect(f.published()).toBe(true)
  expect(f.commands).toEqual(['verify', 'settle_login'])
  mfa.unmount()
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-06T12:00:00.000Z'))
  sessionStorage.clear()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

for (const mode of ['path', 'host'] as const) {
  for (const operator of ['operator-A', 'operator-B']) {
    for (const state of ['fresh', 'pending'] as const) {
      it(`${mode}: ${state} target rows after MFA as ${operator} (synthetic destination label)`, async () => {
        const f = setup(mode, operator)
        const initial = f.card()
        await waitFor(() => expect(f.getCount()).toBe(1))
        const original = f.client.getQueryCache().find({ queryKey: key, exact: true })
        expect(original).toBeDefined()
        if (state === 'fresh') {
          await act(async () => {
            f.first.resolve(Response.json(rows(oldIp)))
          })
          expect(await screen.findAllByText(oldIp)).not.toHaveLength(0)
        }
        initial.unmount()
        await login(f, mode, operator)
        const returned = f.card()
        const current = f.client.getQueryCache().find({ queryKey: key, exact: true })
        await waitFor(() => expect(f.getCount()).toBe(2))
        expect(current).not.toBe(original)
        expect(screen.queryAllByText(oldIp)).toHaveLength(0)
        await act(async () => {
          f.next.resolve(Response.json(rows(newIp)))
        })
        expect(await screen.findAllByText(newIp)).not.toHaveLength(0)
        if (state === 'pending')
          await act(async () => {
            f.first.resolve(Response.json(rows(oldIp)))
          })
        expect(screen.queryAllByText(oldIp)).toHaveLength(0)
        expect(f.getCount()).toBe(2)
        expect(screen.queryAllByText(newIp)).not.toHaveLength(0)
        expect(f.requests.filter((r) => r.endsWith('/login'))).toHaveLength(1)
        // Retain actual transport order in the raw diagnostic report, without exposing credentials.
        console.warn(
          'G4D observation',
          JSON.stringify({
            mode,
            operator,
            state,
            sameQuery: current === original,
            getCount: f.getCount(),
            oldRowsVisible: screen.queryAllByText(oldIp).length > 0,
            commands: f.commands,
            requests: f.requests,
          })
        )
        returned.unmount()
        f.client.clear()
      })
    }
  }
}

for (const fail of [false, true]) {
  it(`logout terminal cleanup, transport failure=${fail}, ignores obsolete GET`, async () => {
    const f = setup('host', 'operator-B')
    const initial = f.card()
    await waitFor(() => expect(f.getCount()).toBe(1))
    const original = f.client.getQueryCache().find({ queryKey: key, exact: true })
    initial.unmount()
    if (fail) {
      const dispatch = vi.mocked(fetch).getMockImplementation()!
      vi.mocked(fetch).mockImplementation((url, init) =>
        String(url).endsWith('/logout')
          ? Promise.reject(new TypeError('controlled lost logout response'))
          : dispatch(url, init)
      )
    }
    const exit = render(<ConsoleLogoutButton contextSession={'a'.repeat(64)} />, {
      wrapper: f.wrapper,
    })
    fireEvent.click(screen.getByRole('button', { name: en.console.signOut }))
    await waitFor(() => expect(route.replace).toHaveBeenCalled())
    expect(f.client.getQueryCache().find({ queryKey: key })).toBeUndefined()
    exit.unmount()
    const returned = f.card()
    await waitFor(() => expect(f.getCount()).toBe(2))
    expect(f.client.getQueryCache().find({ queryKey: key })).not.toBe(original)
    await act(async () => {
      f.next.resolve(Response.json(rows(newIp)))
    })
    expect(await screen.findAllByText(newIp)).not.toHaveLength(0)
    await act(async () => {
      f.first.resolve(Response.json(rows(oldIp)))
    })
    expect(screen.queryAllByText(oldIp)).toHaveLength(0)
    expect(f.getCount()).toBe(2)
    console.warn(
      'G4D logout observation',
      JSON.stringify({
        fail,
        getCount: f.getCount(),
        oldRowsVisible: screen.queryAllByText(oldIp).length > 0,
        requests: f.requests,
      })
    )
    returned.unmount()
    f.client.clear()
  })
}
