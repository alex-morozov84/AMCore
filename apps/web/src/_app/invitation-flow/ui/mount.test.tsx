// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ContextRequestError } from '@/shared/api/bff/context-errors'
import { getPublicSignupPolicy } from '@/shared/api/bff/signup-policy'
import { BackendRequestError } from '@/shared/api/server'

import { InvitationRecipientMount } from './mount'
import { RecipientOAuthSection } from './recipient-oauth-section'

const f = vi.hoisted(() => ({ admission: vi.fn(), primary: vi.fn(), degraded: vi.fn() }))
vi.mock('@/shared/api/server/access-token', () => ({ getBackendAccessToken: async () => null }))
vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ host: 'app.example.test' }),
  cookies: async () => ({ get: () => undefined }),
}))
vi.mock('@/entities/invitation-flow/index.server', () => ({
  readInvitationRecipientAdmission: f.admission,
}))
vi.mock('@/shared/api/bff/invitation-render-request', () => ({
  invitationRenderRequest: () => new Request('https://app.example.test/context'),
}))
vi.mock('@/shared/lib/server-logger', () => ({
  logPrimaryUnavailable: f.primary,
  logDegradation: f.degraded,
}))
vi.mock('@/shared/ui/section-error-boundary', () => ({ SectionErrorBoundary: 'boundary' }))
vi.mock('@/_pages/invitation-recipient', () => ({ RecipientFrame: 'frame' }))
vi.mock('./recipient-client', () => ({ RecipientClient: 'recipient' }))
vi.mock('./unavailable-client', () => ({ InvitationUnavailableClient: 'unavailable' }))
vi.mock('./recipient-oauth-scope', () => ({ RecipientOAuthOptions: 'oauth' }))
const flowId = 'a'.repeat(22)
beforeEach(() => {
  vi.clearAllMocks()
  f.admission.mockResolvedValue({
    binding: { flowId, flowRevision: 1, sessionBinding: null },
    user: null,
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('actual recipient server reads', () => {
  it('keeps password composition independent of a safely logged provider outage', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503 })))
    const page = await InvitationRecipientMount({ flowId })
    expect(page.props.children.type).toBe('recipient')
    expect(page.props.children.props.oauthContent.props.children.type).toBe('boundary')
    expect(await RecipientOAuthSection()).toBeNull()
    expect(f.degraded).toHaveBeenCalledOnce()
    expect(f.degraded).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'invitation-oauth-options', reason: 'upstream' })
    )
  })
  it.each([200, 403])(
    'provider contract failure %s throws to its section boundary',
    async (status) => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(Response.json({ fakeSecret: 'must-not-log' }, { status }))
      )
      await expect(RecipientOAuthSection()).rejects.toBeInstanceOf(BackendRequestError)
      expect(f.degraded).not.toHaveBeenCalled()
    }
  )
  it('renders retry for known primary failure and logs a bounded field set once', async () => {
    f.admission.mockRejectedValue(new ContextRequestError(503, 'SERVICE_UNAVAILABLE'))
    const page = await InvitationRecipientMount({ flowId })
    expect(page.props.children.props.unavailable).toBe(true)
    expect(f.primary).toHaveBeenCalledOnce()
    expect(f.primary).toHaveBeenCalledWith({
      source: 'invitation-recipient',
      reason: 'upstream',
      retryAfterMs: undefined,
      correlationId: undefined,
    })
  })
  it.each([Error, TypeError])(
    'does not replace a programmer %s with normal unavailable state',
    async (Constructor) => {
      const bug = new Constructor('programmer failure')
      f.admission.mockRejectedValue(bug)
      await expect(InvitationRecipientMount({ flowId })).rejects.toBe(bug)
      expect(f.primary).not.toHaveBeenCalled()
    }
  )
  it('keeps stale invitation authority ordinary without an availability log', async () => {
    f.admission.mockRejectedValue(new ContextRequestError(409, 'INVITE_FLOW_CHANGED'))
    const page = await InvitationRecipientMount({ flowId })
    expect(page.props.children.props.unavailable).toBeUndefined()
    expect(f.primary).not.toHaveBeenCalled()
  })
  it('unknown signup policy fails closed with a log; malformed success is a contract error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503 })))
    expect(await getPublicSignupPolicy()).toBeNull()
    expect(f.degraded).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'public-signup-policy' })
    )
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ publicSignupEnabled: 'yes' })))
    await expect(getPublicSignupPolicy()).rejects.toBeInstanceOf(BackendRequestError)
    expect(JSON.stringify([...f.primary.mock.calls, ...f.degraded.mock.calls])).not.toContain(
      'must-not-log'
    )
  })
})
