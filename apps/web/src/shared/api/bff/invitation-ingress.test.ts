import { DEFAULT_LOCALE, localizedFrontendUrl } from '@amcore/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { recipientFixture } from '@/test/fixtures/invitation-flow'

import type { ContextExecutorDeps } from './context-executor'
import { attachInvitationBootstrap, readInvitationBootstrap, saveInvitationBootstrap } from './invitation-bootstrap-store'
import { invitationBootstrap, invitationIngress } from './invitation-ingress'
import type * as InvitationOwnerStore from './invitation-owner-store'
import { invitationOwnerStore } from './invitation-owner-store'
import { invitationIncomingSession } from './invitation-request-snapshot'
import type * as InvitationUpstream from './invitation-upstream'
import { invitationBackend, InvitationBackendError } from './invitation-upstream'

vi.mock('server-only', () => ({}))
vi.mock('./invitation-owner-store', async original => ({ ...await original<typeof InvitationOwnerStore>(),
  invitationOwnerStore: { get: vi.fn(), create: vi.fn(), compareAndSet: vi.fn() } }))
vi.mock('./invitation-bootstrap-store', () => ({ saveInvitationBootstrap: vi.fn(), readInvitationBootstrap: vi.fn(), attachInvitationBootstrap: vi.fn() }))
vi.mock('./invitation-request-snapshot', () => ({ invitationIncomingSession: vi.fn() }))
vi.mock('./invitation-owner-lease', () => ({ withInvitationOwnerLease: vi.fn(async (_hash, _signal, work) => work()) }))
vi.mock('./invitation-upstream', async original => ({ ...await original<typeof InvitationUpstream>(), invitationBackend: vi.fn() }))
const deps = {} as ContextExecutorDeps
const token = 't'.repeat(43)
const pendingId = 'p'.repeat(22)
const proof = 'o'.repeat(43)
const request = (cookie = '') => new Request(localizedFrontendUrl('https://app.example.test', DEFAULT_LOCALE, `invite/accept?token=${token}`), { headers: { cookie } })
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv('WEB_TRUSTED_ORIGINS', 'https://app.example.test')
  vi.mocked(invitationIncomingSession).mockResolvedValue(null)
  vi.mocked(invitationOwnerStore.get).mockResolvedValue(null)
  vi.mocked(invitationOwnerStore.create).mockResolvedValue(true)
  vi.mocked(invitationOwnerStore.compareAndSet).mockResolvedValue(true)
  vi.mocked(saveInvitationBootstrap).mockResolvedValue(pendingId)
  vi.mocked(invitationBackend).mockResolvedValue({ data: recipientFixture().admission, refreshToken: null })
})
afterEach(() => vi.unstubAllEnvs())
describe('email ingress and current-cookie bootstrap', () => {
  it('first sets only an owner proof and scrubbed single-use bootstrap destination', async () => {
    const response = await invitationIngress(request(), DEFAULT_LOCALE, deps)
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe(localizedFrontendUrl('https://app.example.test', DEFAULT_LOCALE, `invite/bootstrap/${pendingId}`))
    expect(response.headers.get('set-cookie')).toContain('__Host-amcore_invite_browser=')
    expect(response.headers.get('set-cookie')).toContain('Secure')
    expect(invitationOwnerStore.compareAndSet).not.toHaveBeenCalled()
    expect(JSON.stringify(vi.mocked(invitationOwnerStore.create).mock.calls)).not.toContain(token)
    expect(JSON.stringify(vi.mocked(saveInvitationBootstrap).mock.calls)).not.toContain(token)
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(response.headers.get('cache-control')).toContain('no-store')
  })
  it('reuses an established owner without rotating its proof and admits a bound flow through CAS', async () => {
    const current = recipientFixture()
    vi.mocked(invitationOwnerStore.get).mockResolvedValue(current.snapshot.owner)
    const response = await invitationIngress(request(`__Host-amcore_invite_browser=${proof}`), DEFAULT_LOCALE, deps)
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toMatch(/\/invite\/flow\/[A-Za-z0-9_-]{22}$/)
    expect(response.headers.get('location')).toContain(localizedFrontendUrl('https://app.example.test', DEFAULT_LOCALE, 'invite/flow/'))
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(invitationOwnerStore.create).not.toHaveBeenCalled()
    expect(invitationOwnerStore.compareAndSet).toHaveBeenCalled()
  })
  it('does not establish a cookie or serialize the email token on an unknown backend outcome', async () => {
    vi.mocked(invitationBackend).mockRejectedValue(new InvitationBackendError(503, false))
    const response = await invitationIngress(request(), DEFAULT_LOCALE, deps)
    expect(response.headers.get('location')).toBe(localizedFrontendUrl('https://app.example.test', DEFAULT_LOCALE, 'invite/unusable?reason=unavailable'))
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(await response.text()).not.toContain(token)
    expect(saveInvitationBootstrap).not.toHaveBeenCalled()
  })
  it('fails a bootstrap from a different current cookie before attaching any flow', async () => {
    vi.mocked(invitationOwnerStore.get).mockResolvedValue(recipientFixture().snapshot.owner)
    vi.mocked(readInvitationBootstrap).mockResolvedValue(null)
    const response = await invitationBootstrap(new Request(localizedFrontendUrl('https://app.example.test', DEFAULT_LOCALE, `invite/bootstrap/${pendingId}`), {
      headers: { cookie: `__Host-amcore_invite_browser=${proof}` },
    }), DEFAULT_LOCALE, pendingId, deps)
    expect(response.headers.get('location')).toContain('/invite/unusable')
    expect(attachInvitationBootstrap).not.toHaveBeenCalled()
    expect(invitationBackend).not.toHaveBeenCalled()
  })
})
