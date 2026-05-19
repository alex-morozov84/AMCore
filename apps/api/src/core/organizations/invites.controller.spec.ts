import type {
  AcceptInviteResponse,
  InviteListResponse,
  InviteResponse,
  RequestPrincipal,
} from '@amcore/shared'
import { SystemRole } from '@amcore/shared'

import { PaginationQueryDto } from '../../common/dto/pagination-query.dto'

/**
 * Thin pass-through tests for the three Stage C controllers
 * (`MembersController.invite`, `InvitesController.listInvites/revoke`,
 * `AuthInvitesController.accept`). The hard semantics — uniform
 * response, rate limiting, accept transactional invariants — live in
 * `invite.service.spec.ts`. These tests pin only what the controller
 * itself owns: that it forwards arguments unchanged, calls the right
 * service method, and is not silently transforming inputs.
 */
import { AuthInvitesController } from './auth-invites.controller'
import type { AcceptInviteDto, CreateInviteDto } from './dto'
import { InviteService } from './invite.service'
import { InvitesController } from './invites.controller'
import type { MemberService } from './member.service'
import { MembersController } from './members.controller'

const principal: RequestPrincipal = {
  type: 'jwt',
  sub: 'user-1',
  email: 'admin@example.com',
  systemRole: SystemRole.User,
  organizationId: 'org-1',
  aclVersion: 0,
}

function mockInviteService(): jest.Mocked<InviteService> {
  return {
    createInvite: jest.fn(),
    listInvites: jest.fn(),
    revokeInvite: jest.fn(),
    acceptInvite: jest.fn(),
  } as unknown as jest.Mocked<InviteService>
}

describe('MembersController (invite handler — OB-02 Stage C)', () => {
  it('forwards createInvite to InviteService and returns its response unchanged', async () => {
    const inviteService = mockInviteService()
    const memberService = {} as jest.Mocked<MemberService>
    const expected: InviteResponse = { status: 'invited' }
    inviteService.createInvite.mockResolvedValue(expected)

    const controller = new MembersController(memberService, inviteService)
    const dto = { email: 'target@example.com', roleId: 'role-1' } as CreateInviteDto

    const result = await controller.invite('org-1', dto, principal)

    expect(result).toBe(expected)
    expect(inviteService.createInvite).toHaveBeenCalledWith('org-1', dto, principal)
    expect(inviteService.createInvite).toHaveBeenCalledTimes(1)
  })
})

describe('InvitesController (OB-02 Stage C)', () => {
  it('forwards listInvites with pagination page/limit unwrapped from the query DTO', async () => {
    const inviteService = mockInviteService()
    const expected: InviteListResponse = { data: [], total: 0, page: 2, limit: 25 }
    inviteService.listInvites.mockResolvedValue(expected)

    const controller = new InvitesController(inviteService)
    const pagination: PaginationQueryDto = { page: 2, limit: 25 } as PaginationQueryDto

    const result = await controller.listInvites('org-1', principal, pagination)

    expect(result).toBe(expected)
    expect(inviteService.listInvites).toHaveBeenCalledWith('org-1', principal, 2, 25)
  })

  it('forwards revokeInvite to InviteService and resolves with void', async () => {
    const inviteService = mockInviteService()
    inviteService.revokeInvite.mockResolvedValue(undefined)

    const controller = new InvitesController(inviteService)
    await expect(controller.revokeInvite('org-1', 'invite-1', principal)).resolves.toBeUndefined()
    expect(inviteService.revokeInvite).toHaveBeenCalledWith('org-1', 'invite-1', principal)
  })
})

describe('AuthInvitesController (OB-02 Stage C)', () => {
  function makeRequest(headers: Record<string, string | undefined>, ip?: string): never {
    return {
      headers,
      ip,
      socket: { remoteAddress: '127.0.0.1' },
    } as never
  }

  it('extracts client IP via x-forwarded-for and forwards token + principal + ip to acceptInvite', async () => {
    const inviteService = mockInviteService()
    const expected: AcceptInviteResponse = { organizationId: 'org-1', roleId: 'role-1' }
    inviteService.acceptInvite.mockResolvedValue(expected)

    const controller = new AuthInvitesController(inviteService)
    const dto = { token: 'a'.repeat(43) } as AcceptInviteDto
    const req = makeRequest({ 'x-forwarded-for': '203.0.113.10, 70.41.3.18' })

    const result = await controller.accept(dto, principal, req)

    expect(result).toBe(expected)
    expect(inviteService.acceptInvite).toHaveBeenCalledWith(dto.token, principal, '203.0.113.10')
  })

  it('falls back to "unknown" when the client IP cannot be resolved from headers or socket', async () => {
    const inviteService = mockInviteService()
    inviteService.acceptInvite.mockResolvedValue({ organizationId: 'org-1', roleId: 'role-1' })

    const controller = new AuthInvitesController(inviteService)
    const dto = { token: 'a'.repeat(43) } as AcceptInviteDto
    const req = { headers: {}, ip: undefined, socket: { remoteAddress: undefined } } as never

    await controller.accept(dto, principal, req)

    expect(inviteService.acceptInvite).toHaveBeenCalledWith(dto.token, principal, 'unknown')
  })
})
