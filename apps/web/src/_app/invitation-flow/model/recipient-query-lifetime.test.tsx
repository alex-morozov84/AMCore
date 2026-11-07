import { useEffect } from 'react'
import {
  invitationFlowAuthResponseSchema,
  invitationFlowContextResponseSchema,
  invitationFlowInspectResponseSchema,
  invitationFlowPendingResponseSchema,
} from '@amcore/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { invitationFlowClient, useInvitationFlow } from '@/entities/invitation-flow'
import { useCurrentUser, userKeys } from '@/entities/user'
import { useLogin } from '@/features/auth-login'
import { useRegister } from '@/features/auth-register'

import { useRecipientAuthentication } from './use-recipient-authentication'

vi.mock('client-only', () => ({}))
vi.mock('@/shared/lib/route-progress/use-route-progress-router', () => ({
  useRouteProgressRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}))
vi.mock('@/shared/lib/use-field-error-translator', () => ({
  useFieldErrorTranslator: () => () => 'localized',
}))
vi.mock('@/shared/ui/route-progress-link', () => ({ RouteProgressLink: () => null }))
afterEach(() => vi.restoreAllMocks())
const initial = { flowId: 'a'.repeat(22), flowRevision: 1, sessionBinding: 'a'.repeat(64) }
const anonymous = { ...initial, flowRevision: 2, sessionBinding: null }
const next = { ...initial, flowRevision: 4, sessionBinding: 'b'.repeat(64) }
const user = {
  id: 'B',
  email: 'b@example.test',
  emailVerified: false,
  name: null,
  avatarUrl: null,
  phone: null,
  locale: 'en' as const,
  timezone: 'UTC',
  createdAt: '2026-11-06T00:00:00.000Z',
  lastLoginAt: null,
}
const ack = invitationFlowAuthResponseSchema.parse({
  binding: next,
  data: { user, contextSession: 'c'.repeat(64) },
  handoff: { attemptId: 'h'.repeat(22) },
})
const anonResponse = invitationFlowContextResponseSchema.parse({
  binding: anonymous,
  data: { email: user.email, expiresAt: '2027-01-01T00:00:00.000Z' },
})

it.each(['login', 'register', 'recover'] as const)(
  'keeps real observers connected through signedOut and %s acknowledgment',
  async (method) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(userKeys.me(), {
      user: { ...user, id: 'A' },
      contextSession: 'a'.repeat(64),
    })
    const oldKey = userKeys.sessions({ userId: 'A', contextSession: 'a'.repeat(64) }, 'en', 1, 10)
    client.setQueryData(oldKey, ['old private data'])
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const context = vi.spyOn(invitationFlowClient, 'context').mockResolvedValue(anonResponse)
    const inspect = vi.spyOn(invitationFlowClient, 'inspect').mockResolvedValue(
      invitationFlowInspectResponseSchema.parse({
        binding: initial,
        data: { state: 'verify_email', email: user.email },
      })
    )
    const login = vi.spyOn(invitationFlowClient, 'login').mockResolvedValue(ack)
    const register = vi.spyOn(invitationFlowClient, 'register').mockResolvedValue(ack)
    const acknowledge = vi.spyOn(invitationFlowClient, 'acknowledge').mockResolvedValue(ack)
    const reader = renderHook(() => useCurrentUser(), { wrapper })
    const originalMe = client.getQueryCache().find({ queryKey: userKeys.me(), exact: true })
    const flow = renderHook(
      () => {
        const auth = useRecipientAuthentication(initial, { ...user, id: 'A' })
        const query = useInvitationFlow(auth.binding, auth.phase === 'active')
        const response = query.current
        const { observePending, retire } = auth
        useEffect(() => {
          if (response && 'state' in response)
            observePending(
              response.binding,
              response.state,
              response.state === 'completing_signin' ? response.handoff.attemptId : undefined
            )
          if (query.bindingChanged) retire()
        }, [response, query.bindingChanged, observePending, retire])
        return {
          auth,
          query,
          login: useLogin(undefined, auth.adapters.login),
          register: useRegister(undefined, auth.adapters.register),
        }
      },
      { wrapper }
    )
    await waitFor(() => expect(flow.result.current.query.current).toBeDefined())
    let epoch: number | null = null
    await act(async () => {
      epoch = await flow.result.current.auth.signedOut(anonymous)
    })
    expect(epoch).not.toBeNull()
    expect(flow.result.current.auth.current(epoch!)).toBe(true)
    await waitFor(() => expect(reader.result.current.data?.user).toBeNull())
    await waitFor(() => expect(context).toHaveBeenCalledOnce())
    expect(client.getQueryData(oldKey)).toBeUndefined()
    inspect.mockResolvedValue(
      invitationFlowInspectResponseSchema.parse({
        binding: next,
        data: { state: 'verify_email', email: user.email },
      })
    )
    if (method === 'recover') {
      context.mockResolvedValueOnce(
        invitationFlowPendingResponseSchema.parse({
          binding: next,
          state: 'completing_signin',
          handoff: ack.handoff,
        })
      )
      await act(async () => {
        await flow.result.current.auth.recover()
      })
      expect(flow.result.current.auth.phase).toBe('completing_signin')
      await act(async () => {
        await flow.result.current.auth.recover()
      })
    } else {
      await act(async () => {
        await flow.result.current[method].mutateAsync({
          email: user.email,
          password: '<test-password>',
        })
      })
    }
    await waitFor(() => expect(reader.result.current.data).toEqual(ack.data))
    await waitFor(() => expect(flow.result.current.query.current?.binding).toEqual(next))
    expect(flow.result.current.auth.phase).toBe('active')
    expect(flow.result.current.query.bindingChanged).toBe(false)
    expect(client.getQueryCache().find({ queryKey: userKeys.me(), exact: true })).toBe(originalMe)
    expect(acknowledge).toHaveBeenCalledOnce()
    expect(login).toHaveBeenCalledTimes(method === 'login' ? 1 : 0)
    expect(register).toHaveBeenCalledTimes(method === 'register' ? 1 : 0)
  }
)

it.each([true, false])(
  'tokenless verification preserves only the confirmed binding: %s',
  async (sameBinding) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const envelope = { user, contextSession: 'confirmed-session' }
    client.setQueryData(userKeys.me(), envelope)
    const key = userKeys.sessions(
      { userId: user.id, contextSession: envelope.contextSession },
      'en',
      1,
      10
    )
    client.setQueryData(key, ['current sessions'])
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const hook = renderHook(() => useRecipientAuthentication(initial, user), { wrapper })
    const revision = {
      ...initial,
      flowRevision: 5,
      sessionBinding: sameBinding ? initial.sessionBinding : next.sessionBinding,
    }
    vi.spyOn(invitationFlowClient, 'context').mockResolvedValue({
      binding: revision,
      data: { email: user.email, expiresAt: '2027-01-01T00:00:00.000Z' },
    })
    const verified = { ...user, emailVerified: true }
    vi.spyOn(invitationFlowClient, 'verificationStatus').mockResolvedValue({
      binding: revision,
      data: { user: verified, inspection: { state: 'verify_email', email: user.email } },
    })
    act(() => hook.result.current.observePending(revision, 'authenticating'))
    await act(async () => {
      await hook.result.current.recover()
    })
    expect(hook.result.current.phase).toBe('active')
    expect(client.getQueryData(userKeys.me())).toEqual({
      user: verified,
      ...(sameBinding ? { contextSession: envelope.contextSession } : {}),
    })
    expect(client.getQueryData(key)).toEqual(sameBinding ? ['current sessions'] : undefined)
    expect(client.getQueryState(userKeys.me())?.isInvalidated).toBe(!sameBinding)
  }
)
