// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ContextRequestError } from '@/shared/api/bff/context-errors'

import { InvitationVerificationMount } from './verification-mount'

const f = vi.hoisted(() => ({
  read: vi.fn(),
  capture: vi.fn(),
  current: vi.fn(),
  degraded: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('@/shared/api/server/access-token', () => ({ getBackendAccessToken: async () => null }))
vi.mock('@/shared/api/bff/invitation-render-request', () => ({
  invitationRenderRequest: () => new Request('https://app.example.test/context'),
}))
vi.mock('@/shared/api/bff/invitation-request-authority', () => ({
  invitationRequestAuthority: () => ({
    ownerHash: 'owned',
    policy: { origin: 'https://app.example.test' },
  }),
}))
vi.mock('@/shared/api/bff/invitation-verification-store', () => ({
  readInvitationVerificationSelector: f.read,
}))
vi.mock('@/shared/api/bff/invitation-request-snapshot', () => ({
  captureInvitationRequest: f.capture,
  assertInvitationReadCurrent: f.current,
}))
vi.mock('@/shared/api/bff/product-context-deps', () => ({ productContextDeps: () => ({}) }))
vi.mock('@/shared/lib/server-logger', () => ({ logDegradation: f.degraded }))
vi.mock('@/shared/ui/section-error-boundary', () => ({ SectionErrorBoundary: 'boundary' }))
vi.mock('./verification-return-client', () => ({
  InvitationVerificationClient: 'verification',
  VerificationReturn: 'return',
}))
const selectorId = 'a'.repeat(22)
const binding = { flowId: 'b'.repeat(22), sessionBinding: 'c'.repeat(64), flowRevision: 3 }
beforeEach(() => {
  vi.clearAllMocks()
  f.read.mockResolvedValue({ binding, ownerEpoch: 2 })
  f.capture.mockResolvedValue({
    session: { binding: binding.sessionBinding },
    owner: { epoch: 2 },
    flow: { binding },
  })
  f.current.mockResolvedValue(undefined)
})
async function renderReturn() {
  const mount = InvitationVerificationMount({ token: 'fixture-owned-token', selectorId })
  expect(mount.props.token).toBe('fixture-owned-token')
  expect(mount.props.successContent.type).toBe('boundary')
  const child = mount.props.successContent.props.children
  return child.type(child.props)
}
describe('verification is independent of optional invitation return admission', () => {
  it('uses only current selector/session/epoch/revision to grant the explicit return', async () => {
    expect((await renderReturn()).props.sessionBinding).toBe(binding.sessionBinding)
    expect(f.current).toHaveBeenCalledOnce()
  })
  it('stale selector keeps ordinary verification and offers reopen guidance', async () => {
    f.current.mockRejectedValue(new ContextRequestError(409, 'INVITE_FLOW_CHANGED'))
    expect((await renderReturn()).props.sessionBinding).toBeNull()
    expect(f.degraded).not.toHaveBeenCalled()
  })
  it('known optional outage logs safely and does not own the verification form', async () => {
    f.read.mockRejectedValue(new ContextRequestError(503, 'SERVICE_UNAVAILABLE'))
    expect((await renderReturn()).props.sessionBinding).toBeNull()
    expect(f.degraded).toHaveBeenCalledOnce()
    expect(f.degraded).toHaveBeenCalledWith({
      source: 'invitation-verification-return',
      reason: 'upstream',
      retryAfterMs: undefined,
      correlationId: undefined,
    })
  })
  it('a bug escapes to the optional section boundary', async () => {
    const bug = new TypeError('private-programmer-detail')
    f.read.mockRejectedValue(bug)
    await expect(renderReturn()).rejects.toBe(bug)
    expect(f.degraded).not.toHaveBeenCalled()
  })
})
