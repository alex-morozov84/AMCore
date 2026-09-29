import { Controller, type ExecutionContext, Get } from '@nestjs/common'
import type { Request } from 'express'

import { type RequestPrincipal, SystemRole } from '@amcore/shared'

import type { PrismaService } from '../../../prisma'
import type { PrivilegedAdmission } from '../privileged-admission.service'

import { OrganizationContextResolver } from './organization-context-resolver.service'
import { ORGANIZATION_HEADER } from './organization-selector'
import { OrganizationContextBoundary, RequestContextPolicy } from './request-context-policy'
import { assertVerifiedContext } from './verified-organization-context'

import 'reflect-metadata'

@Controller('tenant')
@OrganizationContextBoundary({ apiRoots: ['/api/v1/tenant'] })
class TenantController {
  @RequestContextPolicy({ kind: 'organization', selector: { param: 'id' } })
  @Get(':id')
  mutation() {
    return undefined
  }

  @RequestContextPolicy({ kind: 'organization', selector: { header: true }, concealMissing: true })
  @Get('header')
  headerRead() {
    return undefined
  }

  @RequestContextPolicy({
    kind: 'organization',
    selector: { param: 'id' },
    legacyPlatformMembershipBypass: true,
  })
  @Get(':id/legacy')
  legacy() {
    return undefined
  }

  @RequestContextPolicy({ kind: 'personal' })
  @Get('personal')
  personal() {
    return undefined
  }

  @RequestContextPolicy({ kind: 'personal' })
  @RequestContextPolicy({ kind: 'exchange' })
  @Get('conflicting')
  conflicting() {
    return undefined
  }

  @Get('missing')
  missing() {
    return undefined
  }

  @RequestContextPolicy({ kind: 'organization', selector: { param: 'typo' } })
  @Get(':id/typo')
  unresolvable() {
    return undefined
  }
}

const user: RequestPrincipal = { type: 'jwt', sub: 'actor', systemRole: SystemRole.User }
const admission = (principal = user): PrivilegedAdmission => ({
  authenticated: principal,
  principal,
})

function execution(
  method: keyof TenantController,
  header?: string,
  raw?: string[]
): ExecutionContext {
  const request = {
    params: { id: 'org-a' },
    headers: header === undefined ? {} : { [ORGANIZATION_HEADER]: header },
    rawHeaders: raw ?? (header === undefined ? [] : [ORGANIZATION_HEADER, header]),
  } as unknown as Request
  return {
    getHandler: () => TenantController.prototype[method],
    getClass: () => TenantController,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext
}

describe('OrganizationContextResolver', () => {
  const memberLookup = jest.fn()
  const organizationLookup = jest.fn()
  const resolver = new OrganizationContextResolver({
    orgMember: { findUnique: memberLookup },
    organization: { findUnique: organizationLookup },
  } as unknown as PrismaService)

  beforeEach(() => {
    jest.resetAllMocks()
    memberLookup.mockResolvedValue({ organization: { aclVersion: 7 } })
    organizationLookup.mockResolvedValue({ aclVersion: 9 })
  })

  it('projects personal JWT from one primary membership/version read and preserves original claims', async () => {
    const original = admission()
    const result = await resolver.resolve(execution('mutation'), original)
    expect(memberLookup).toHaveBeenCalledTimes(1)
    expect(result.admission.authenticated).toBe(original.authenticated)
    expect(result.admission.principal).toMatchObject({ organizationId: 'org-a', aclVersion: 7 })
    expect(original.principal.organizationId).toBeUndefined()
    assertVerifiedContext(result.context!, result.admission)
    expect(() => assertVerifiedContext({ ...result.context! }, result.admission)).toThrow()
    expect(Object.isFrozen(result.context)).toBe(true)
    expect(Object.isFrozen(result.admission.principal)).toBe(true)
  })

  it('reuses the fixed API-key membership/version snapshot without another primary read', async () => {
    const result = await resolver.resolve(
      execution('mutation'),
      admission({
        ...user,
        type: 'api_key',
        organizationId: 'org-a',
        aclVersion: 8,
        scopes: ['read:Organization'],
      })
    )
    expect(result.context!.aclVersion).toBe(8)
    expect(memberLookup).not.toHaveBeenCalled()
    expect(organizationLookup).not.toHaveBeenCalled()
  })

  it.each(['jwt', 'api_key'] as const)(
    'rejects a foreign bound %s before membership',
    async (type) => {
      await expect(
        resolver.resolve(
          execution('mutation'),
          admission({
            ...user,
            type,
            organizationId: 'org-b',
            aclVersion: 1,
          })
        )
      ).rejects.toMatchObject({ status: 403 })
      expect(memberLookup).not.toHaveBeenCalled()
    }
  )

  it('requires personal SUPER_ADMIN membership but preserves explicitly inventoried bound-JWT bypass', async () => {
    memberLookup.mockResolvedValue(null)
    const platform = { ...user, systemRole: SystemRole.SuperAdmin }
    await expect(
      resolver.resolve(execution('mutation'), admission(platform))
    ).rejects.toMatchObject({ status: 403 })
    const result = await resolver.resolve(
      execution('legacy'),
      admission({ ...platform, organizationId: 'org-a' })
    )
    expect(result.context).toMatchObject({ aclVersion: 9, membershipVerified: false })
    expect(organizationLookup).toHaveBeenCalledTimes(1)
  })

  it('does not treat an empty bound claim as personal or a legacy platform bypass', async () => {
    await expect(
      resolver.resolve(
        execution('legacy'),
        admission({ ...user, organizationId: '', systemRole: SystemRole.SuperAdmin })
      )
    ).rejects.toMatchObject({ status: 403 })
    expect(memberLookup).not.toHaveBeenCalled()
    expect(organizationLookup).not.toHaveBeenCalled()
  })

  it('conceals missing/nonmember target on declared overview and propagates infrastructure errors', async () => {
    memberLookup.mockResolvedValue(null)
    await expect(
      resolver.resolve(execution('headerRead', 'org-a'), admission())
    ).rejects.toMatchObject({ status: 404 })
    const outage = new Error('primary unavailable')
    memberLookup.mockRejectedValue(outage)
    await expect(resolver.resolve(execution('mutation'), admission())).rejects.toBe(outage)
  })

  it.each(['missing', 'conflicting'] as const)(
    'closes %s metadata before authority access',
    async (method) => {
      await expect(resolver.resolve(execution(method), admission())).rejects.toThrow(
        'Invalid organization context policy boundary'
      )
      expect(memberLookup).not.toHaveBeenCalled()
    }
  )

  it('closes an unresolvable path policy as an authoring error before membership', async () => {
    await expect(resolver.resolve(execution('unresolvable'), admission())).rejects.toThrow(
      'Unresolvable organization selector policy'
    )
    expect(memberLookup).not.toHaveBeenCalled()
  })

  it.each(['', 'org,a', '../org', 'org/a', 'a'.repeat(129)])(
    'rejects malformed header %p before DB',
    async (header) => {
      await expect(
        resolver.resolve(execution('mutation', header), admission())
      ).rejects.toMatchObject({ status: 400 })
      expect(memberLookup).not.toHaveBeenCalled()
    }
  )

  it('rejects conflicting, duplicate, missing and undeclared selectors before DB', async () => {
    for (const ctx of [
      execution('mutation', 'org-b'),
      execution('mutation', 'org-a', [ORGANIZATION_HEADER, 'org-a', ORGANIZATION_HEADER, 'org-a']),
      execution('headerRead'),
      execution('personal', 'org-a'),
    ]) {
      await expect(resolver.resolve(ctx, admission())).rejects.toMatchObject({ status: 400 })
    }
    expect(memberLookup).not.toHaveBeenCalled()
  })
})
