import { NextIntlClientProvider } from 'next-intl'
import { DEFAULT_LOCALE, type SessionsListResponse, type UserResponse } from '@amcore/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SessionsPage } from '@/_pages/settings'
import {
  notificationKeys,
  useNotificationPreferences,
  useUpdateNotificationPreference,
} from '@/entities/notifications'
import { useCurrentUser, userKeys, useSessions, useUploadAvatar } from '@/entities/user'
import { useLogin } from '@/features/auth-login'
import { useLogout } from '@/features/auth-logout'
import { useRegister } from '@/features/auth-register'
import { usePersistLocale } from '@/features/locale-switcher'
import { useRevokeSession } from '@/features/sessions-revoke'
import { useRevokeOtherSessions } from '@/features/sessions-revoke-other'
import { apiClient, authApi } from '@/shared/api'
import { publishCurrentUser, queryOwner } from '@/shared/api/query-session'
import { Toaster } from '@/shared/ui/toast'

import en from '../../../../messages/en.json'

const { push } = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock('@/shared/api', () => ({
  authApi: {
    getMe: vi.fn(),
    getSessions: vi.fn(),
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    uploadAvatar: vi.fn(),
    deleteAvatar: vi.fn(),
    updateMe: vi.fn(),
    revokeSession: vi.fn(),
    revokeOtherSessions: vi.fn(),
  },
  useApiError: () => () => ({ message: 'error' }),
  apiClient: { get: vi.fn(), put: vi.fn() },
}))
vi.mock('@/shared/lib/route-progress/use-route-progress-router', () => ({
  useRouteProgressRouter: () => ({ push }),
}))
vi.mock('@/shared/lib/use-field-error-translator', () => ({
  useFieldErrorTranslator: () => () => 'localized',
}))
vi.mock('@/shared/ui/route-progress-link', () => ({ RouteProgressLink: () => null }))
vi.mock('@/i18n/navigation', () => ({ usePathname: () => '/', Link: () => null }))

const account = (id: string) => ({
  user: { id, locale: DEFAULT_LOCALE } as UserResponse,
  contextSession: `${id}-context`,
})
const input = { email: 'fixture@example.test', password: '<test-password>' }
const sessions = (id: string): SessionsListResponse => ({
  data: [
    {
      id,
      current: true,
      userAgent: null,
      ipAddress: null,
      location: null,
      createdAt: '2026-11-06T00:00:00.000Z',
    },
  ],
  total: 1,
  page: 1,
  limit: 10,
})
const ownerA = { userId: 'A', contextSession: 'A-context' }
const sessionKey = userKeys.sessions(ownerA, DEFAULT_LOCALE, 1, 10)
const formats = { dateTime: { long: { dateStyle: 'long', timeStyle: 'short' } } } as const
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <NextIntlClientProvider locale={DEFAULT_LOCALE} messages={en} formats={formats} timeZone="UTC">
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </NextIntlClientProvider>
  )
  return { client, wrapper }
}
beforeEach(() => vi.resetAllMocks())

for (const [name, useCredential] of [
  ['login', useLogin],
  ['register', useRegister],
] as const) {
  describe(`${name}: one-document cache contract, not route admission`, () => {
    it('does not expose A sessions or inactive preferences after publishing B', async () => {
      const { client, wrapper } = setup()
      client.setQueryData(userKeys.me(), account('A'))
      client.setQueryData(sessionKey, sessions('A-session'), { updatedAt: 1 })
      client.setQueryData(notificationKeys.preferences(ownerA), ['A-preference'])
      vi.mocked(authApi[name]).mockResolvedValueOnce(account('B'))
      const credential = renderHook(() => useCredential(), { wrapper })
      await act(async () => {
        await credential.result.current.mutateAsync(input)
      })
      expect(client.getQueryData(userKeys.me())).toEqual(account('B'))
      const next = Promise.withResolvers<SessionsListResponse>()
      vi.mocked(authApi.getSessions).mockReturnValueOnce(next.promise)
      const list = renderHook(() => useSessions(1, 10), { wrapper })
      const firstAvailable = list.result.current.data
      await waitFor(() => expect(authApi.getSessions).toHaveBeenCalledOnce())
      await act(async () => {
        next.resolve(sessions('B-session'))
      })
      await waitFor(() => expect(list.result.current.isFetching).toBe(false))
      expect.soft(firstAvailable?.data).not.toEqual(sessions('A-session').data)
      expect.soft(list.result.current.data).toEqual(sessions('B-session'))
      expect.soft(client.getQueryData(notificationKeys.preferences(ownerA))).toBeUndefined()
    })

    it('keeps B in cache and the real current-user observer after held A getMe settles', async () => {
      const { client, wrapper } = setup()
      const old = Promise.withResolvers<Awaited<ReturnType<typeof authApi.getMe>>>()
      vi.mocked(authApi.getMe).mockReturnValueOnce(old.promise)
      const reader = renderHook(() => useCurrentUser(), { wrapper })
      await waitFor(() => expect(authApi.getMe).toHaveBeenCalledOnce())
      vi.mocked(authApi[name]).mockResolvedValueOnce(account('B'))
      const credential = renderHook(() => useCredential(), { wrapper })
      await act(async () => {
        await credential.result.current.mutateAsync(input)
      })
      await waitFor(() => expect(reader.result.current.data).toEqual(account('B')))
      const ownerB = queryOwner(account('B'))
      const keyB = notificationKeys.preferences(ownerB)
      client.setQueryData(keyB, ['B-preference'])
      const heldB = Promise.withResolvers<SessionsListResponse>()
      vi.mocked(authApi.getSessions).mockReturnValueOnce(heldB.promise)
      const list = renderHook(() => useSessions(1, 10), { wrapper })
      await waitFor(() => expect(authApi.getSessions).toHaveBeenCalledOnce())
      await act(async () => {
        old.resolve(account('A'))
      })
      await waitFor(() => expect(reader.result.current.isFetching).toBe(false))
      expect.soft(client.getQueryData(userKeys.me())).toEqual(account('B'))
      expect.soft(reader.result.current.data).toEqual(account('B'))
      expect(client.getQueryData(keyB)).toEqual(['B-preference'])
      expect(
        client.getQueryState(userKeys.sessions(ownerB, DEFAULT_LOCALE, 1, 10))?.fetchStatus
      ).toBe('fetching')
      await act(async () => heldB.resolve(sessions('B-session')))
      await waitFor(() => expect(list.result.current.data).toEqual(sessions('B-session')))
    })
  })
}

it.each(['success', 'error'] as const)(
  'logout %s retires cache and held reads for the next consumer',
  async (outcome) => {
    const { client, wrapper } = setup()
    client.setQueryData(sessionKey, sessions('A-session'))
    client.setQueryData(notificationKeys.preferences(ownerA), ['A-preference'])
    const old = Promise.withResolvers<Awaited<ReturnType<typeof authApi.getMe>>>()
    vi.mocked(authApi.getMe).mockReturnValueOnce(old.promise)
    const reader = renderHook(() => useCurrentUser(), { wrapper })
    await waitFor(() => expect(authApi.getMe).toHaveBeenCalledOnce())
    const failure = new Error('logout transport failed')
    if (outcome === 'error') vi.mocked(authApi.logout).mockRejectedValueOnce(failure)
    else vi.mocked(authApi.logout).mockResolvedValueOnce({ message: 'ok' })
    const logout = renderHook(() => useLogout(), { wrapper })
    let result: unknown
    await act(async () => {
      result = await logout.result.current.mutateAsync('A-context').catch((error: unknown) => error)
    })
    expect(result).toEqual(outcome === 'error' ? failure : { message: 'ok' })
    expect(authApi.logout).toHaveBeenCalledWith('A-context')
    expect(push).toHaveBeenCalledWith('/login')
    reader.unmount()
    await act(async () => {
      old.resolve(account('A'))
      await old.promise
    })
    expect(client.getQueryData(userKeys.me())).toBeUndefined()
    expect(client.getQueryData(sessionKey)).toBeUndefined()
    expect(client.getQueryData(notificationKeys.preferences(ownerA))).toBeUndefined()
    vi.mocked(authApi.getMe).mockResolvedValueOnce({ user: null })
    const next = renderHook(() => useCurrentUser(), { wrapper })
    expect(next.result.current.data).toBeUndefined()
    await waitFor(() => expect(next.result.current.isSuccess).toBe(true))
    expect(next.result.current.data).toEqual({ user: null })
  }
)

it.each(['rejected', 'anonymous', 'tokenless'] as const)(
  'renders a terminal bootstrap %s in the real sessions page',
  async (state) => {
    const { wrapper } = setup()
    if (state === 'rejected')
      vi.mocked(authApi.getMe).mockRejectedValueOnce(new Error('me unavailable'))
    else
      vi.mocked(authApi.getMe).mockResolvedValueOnce(
        state === 'anonymous' ? { user: null } : { user: account('A').user }
      )
    render(<SessionsPage />, { wrapper })
    expect(await screen.findByText(en.sessions.loadError)).toBeInTheDocument()
    expect(screen.queryByText(en.common.loading)).not.toBeInTheDocument()
    expect(authApi.getSessions).not.toHaveBeenCalled()
  }
)

it('waits for a token refresh, then renders the real sessions table', async () => {
  const { client, wrapper } = setup()
  client.setQueryData(userKeys.me(), { user: account('A').user })
  const held = Promise.withResolvers<ReturnType<typeof account>>()
  vi.mocked(authApi.getMe).mockReturnValueOnce(held.promise)
  vi.mocked(authApi.getSessions).mockResolvedValueOnce(sessions('current'))
  render(<SessionsPage />, { wrapper })
  await act(async () => {
    void client.invalidateQueries({ queryKey: userKeys.me() })
  })
  expect(await screen.findByText(en.common.loading)).toBeInTheDocument()
  expect(authApi.getSessions).not.toHaveBeenCalled()
  await act(async () => held.resolve(account('A')))
  expect(await screen.findByText(en.sessions.current)).toBeInTheDocument()
  expect(screen.queryByText(en.sessions.loadError)).not.toBeInTheDocument()
})

it('switches mounted readers on me refetch and never carries a previous-page placeholder across sessions', async () => {
  const { client, wrapper } = setup()
  client.setQueryData(userKeys.me(), account('A'))
  client.setQueryData(sessionKey, sessions('A-page'))
  const protectedKey = ['organization-context', 'unchanged']
  client.setQueryData(protectedKey, ['preserved'])
  const held = Promise.withResolvers<SessionsListResponse>()
  vi.mocked(authApi.getSessions).mockReturnValue(held.promise)
  const list = renderHook(({ page }) => useSessions(page, 10), {
    wrapper,
    initialProps: { page: 1 },
  })
  list.rerender({ page: 2 })
  expect(list.result.current.data).toEqual(sessions('A-page'))
  const replacement = { ...account('A'), contextSession: 'A-second-session' }
  vi.mocked(authApi.getMe).mockResolvedValueOnce(replacement)
  await act(async () => {
    await client.refetchQueries({ queryKey: userKeys.me(), exact: true })
  })
  await waitFor(() => expect(list.result.current.data).toBeUndefined())
  expect(client.getQueryData(sessionKey)).toBeUndefined()
  expect(client.getQueryData(protectedKey)).toEqual(['preserved'])
  await act(async () => held.resolve(sessions('new-session-page')))
  await waitFor(() => expect(list.result.current.data).toEqual(sessions('new-session-page')))
  vi.mocked(authApi.getMe).mockRejectedValueOnce(new Error('background failure'))
  await act(async () => {
    await client.refetchQueries({ queryKey: userKeys.me() })
  })
  expect(list.result.current.data).toEqual(sessions('new-session-page'))
  expect(list.result.current.isPending).toBe(false)
})

it('does not remove old entries when bootstrap cancellation happens during cleanup cancellation', async () => {
  const { client, wrapper } = setup()
  client.setQueryData(sessionKey, sessions('A-page'))
  const held = Promise.withResolvers<SessionsListResponse>()
  const active = client
    .fetchQuery({ queryKey: sessionKey, queryFn: () => held.promise, staleTime: 0 })
    .catch(() => undefined)
  vi.mocked(authApi.getMe).mockResolvedValueOnce(account('B'))
  const unsubscribe = client.getQueryCache().subscribe((event) => {
    if (
      event.type === 'updated' &&
      event.query.queryKey === client.getQueryCache().find({ queryKey: sessionKey })?.queryKey &&
      event.query.state.fetchStatus === 'idle'
    )
      void client.cancelQueries({ queryKey: userKeys.me(), exact: true })
  })
  renderHook(() => useCurrentUser(), { wrapper })
  await waitFor(() => expect(authApi.getMe).toHaveBeenCalledOnce())
  await act(async () => {
    await active
  })
  unsubscribe()
  expect(client.getQueryData(sessionKey)).toEqual(sessions('A-page'))
  expect(client.getQueryData(userKeys.me())).toBeUndefined()
  held.resolve(sessions('ignored'))
})

it('keeps each dispatched avatar, locale and revoke result bound to the old session', async () => {
  const { client, wrapper } = setup()
  client.setQueryData(userKeys.me(), account('A'))
  const avatar = Promise.withResolvers<{ avatarUrl: string }>()
  const locale = Promise.withResolvers<ReturnType<typeof account>>()
  const revoke = Promise.withResolvers<void>()
  vi.mocked(authApi.uploadAvatar).mockReturnValueOnce(avatar.promise)
  vi.mocked(authApi.updateMe).mockReturnValueOnce(locale.promise)
  vi.mocked(authApi.revokeSession).mockReturnValueOnce(revoke.promise)
  vi.mocked(authApi.revokeOtherSessions).mockReturnValueOnce(revoke.promise)
  const hooks = renderHook(
    () => ({
      avatar: useUploadAvatar(),
      locale: usePersistLocale(),
      revoke: useRevokeSession(),
      others: useRevokeOtherSessions(),
      login: useLogin(),
    }),
    { wrapper }
  )
  let writes!: Promise<unknown>[]
  act(() => {
    writes = [
      hooks.result.current.avatar.mutateAsync(new File(['x'], 'avatar.png')),
      hooks.result.current.revoke.mutateAsync('old-session'),
      hooks.result.current.others.mutateAsync(),
    ]
    hooks.result.current.locale('ru')
  })
  await waitFor(() => expect(authApi.updateMe).toHaveBeenCalledOnce())
  await waitFor(() => expect(authApi.uploadAvatar).toHaveBeenCalledOnce())
  await waitFor(() => expect(authApi.revokeSession).toHaveBeenCalledOnce())
  await waitFor(() => expect(authApi.revokeOtherSessions).toHaveBeenCalledOnce())
  const replacement = { ...account('A'), contextSession: 'A-next-session' }
  vi.mocked(authApi.login).mockResolvedValueOnce(replacement)
  await act(async () => {
    await hooks.result.current.login.mutateAsync(input)
  })
  const newKey = userKeys.sessions(queryOwner(replacement), DEFAULT_LOCALE, 1, 10)
  client.setQueryData(newKey, sessions('new-session'))
  await act(async () => {
    avatar.resolve({ avatarUrl: 'late-avatar' })
    locale.resolve({ ...account('A'), user: { ...account('A').user, locale: 'ru' } })
    revoke.resolve()
    await Promise.all(writes)
  })
  await waitFor(() =>
    expect(
      client
        .getMutationCache()
        .getAll()
        .every((mutation) => mutation.state.status === 'success')
    ).toBe(true)
  )
  expect(client.getQueryData(userKeys.me())).toEqual(replacement)
  expect(client.getQueryState(newKey)?.isInvalidated).toBe(false)
})

it('does not publish when an auth continuation retires during cancellation', async () => {
  const { client, wrapper } = setup()
  let current = true
  const held = Promise.withResolvers<ReturnType<typeof account>>()
  vi.mocked(authApi.getMe).mockImplementationOnce((signal) => {
    signal?.addEventListener('abort', () => {
      current = false
    })
    return held.promise
  })
  renderHook(() => useCurrentUser(), { wrapper })
  await waitFor(() => expect(authApi.getMe).toHaveBeenCalledOnce())
  const adapter = { submit: async () => account('B'), isCurrent: () => current, onSuccess: vi.fn() }
  const login = renderHook(() => useLogin(undefined, adapter), { wrapper })
  await act(async () => {
    await login.result.current.mutateAsync(input)
  })
  expect(adapter.onSuccess).not.toHaveBeenCalled()
  expect(client.getQueryData(userKeys.me())).toBeUndefined()
  held.resolve(account('A'))
})

it('switches mounted preferences and ignores a dispatched old-session PUT completion', async () => {
  const { client, wrapper } = setup()
  client.setQueryData(userKeys.me(), account('A'))
  const prefs = { notificationsEnabled: true, preferences: [] }
  client.setQueryData(notificationKeys.preferences(ownerA), prefs)
  const write = Promise.withResolvers<void>()
  const read = Promise.withResolvers<typeof prefs>()
  vi.mocked(apiClient.put).mockReturnValueOnce(write.promise)
  vi.mocked(apiClient.get).mockReturnValueOnce(read.promise)
  const hook = renderHook(
    () => {
      const owner = queryOwner(useCurrentUser().data)
      return {
        list: useNotificationPreferences(owner),
        save: useUpdateNotificationPreference(owner),
      }
    },
    { wrapper }
  )
  let pending!: Promise<unknown>
  act(() => {
    pending = hook.result.current.save.mutateAsync({
      category: 'account',
      channel: 'in_app',
      enabled: false,
    })
  })
  await waitFor(() => expect(apiClient.put).toHaveBeenCalledOnce())
  await act(async () => {
    await publishCurrentUser(client, account('B'))
  })
  await waitFor(() => expect(apiClient.get).toHaveBeenCalledOnce())
  expect(hook.result.current.list.data).toBeUndefined()
  await act(async () => {
    write.resolve()
    await pending
  })
  expect(client.getQueryData(notificationKeys.preferences(ownerA))).toBeUndefined()
  expect(
    client.getQueryState(notificationKeys.preferences(queryOwner(account('B'))))?.isInvalidated
  ).toBe(false)
  await act(async () => read.resolve({ ...prefs, notificationsEnabled: false }))
  await waitFor(() => expect(hook.result.current.list.data?.notificationsEnabled).toBe(false))
  expect(apiClient.put).toHaveBeenCalledOnce()
  expect(apiClient.get).toHaveBeenCalledOnce()
})

it('admits bulk revoke only after me and acknowledges it before the list refresh', async () => {
  const { wrapper } = setup()
  const me = Promise.withResolvers<ReturnType<typeof account>>()
  const initial = Promise.withResolvers<SessionsListResponse>()
  const refresh = Promise.withResolvers<SessionsListResponse>()
  const write = Promise.withResolvers<void>()
  vi.mocked(authApi.getMe).mockReturnValueOnce(me.promise)
  vi.mocked(authApi.getSessions)
    .mockReturnValueOnce(initial.promise)
    .mockReturnValueOnce(refresh.promise)
  render(
    <>
      <SessionsPage />
      <Toaster closeLabel="Close" />
    </>,
    { wrapper }
  )
  const button = screen.getByRole('button', { name: en.sessions.revokeOthers })
  expect(button).toBeDisabled()
  fireEvent.click(button)
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  const hooks = renderHook(() => ({ single: useRevokeSession(), bulk: useRevokeOtherSessions() }), {
    wrapper,
  })
  await act(async () => {
    await expect(hooks.result.current.single.mutateAsync('other')).rejects.toMatchObject({
      code: 'AUTH_CONTINUATION_CHANGED',
    })
    await expect(hooks.result.current.bulk.mutateAsync()).rejects.toMatchObject({
      code: 'AUTH_CONTINUATION_CHANGED',
    })
  })
  expect(authApi.revokeSession).not.toHaveBeenCalled()
  expect(authApi.revokeOtherSessions).not.toHaveBeenCalled()
  vi.mocked(authApi.revokeOtherSessions).mockReturnValueOnce(write.promise)
  await act(async () => me.resolve(account('A')))
  await waitFor(() => expect(button).toBeEnabled())
  fireEvent.click(button)
  const dialog = await screen.findByRole('alertdialog')
  fireEvent.click(within(dialog).getByRole('button', { name: en.sessions.revokeOthers }))
  await waitFor(() => expect(authApi.revokeOtherSessions).toHaveBeenCalledOnce())
  await act(async () =>
    initial.resolve({
      ...sessions('kept'),
      total: 2,
      data: [
        ...sessions('kept').data,
        { ...sessions('other').data[0], current: false, ipAddress: '198.51.100.19' },
      ],
    })
  )
  expect(await screen.findByText('198.51.100.19')).toBeInTheDocument()
  await act(async () => write.resolve())
  expect(await screen.findByText(en.sessions.othersRevoked)).toBeInTheDocument()
  await waitFor(() => expect(authApi.getSessions).toHaveBeenCalledTimes(2))
  expect(screen.getByText('198.51.100.19')).toBeInTheDocument()
  await act(async () => refresh.resolve(sessions('kept')))
  await waitFor(() => expect(screen.queryByText('198.51.100.19')).not.toBeInTheDocument())
  expect(authApi.revokeOtherSessions).toHaveBeenCalledOnce()
  expect(authApi.revokeSession).not.toHaveBeenCalled()
})
