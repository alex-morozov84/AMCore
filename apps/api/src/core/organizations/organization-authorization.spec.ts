import { mockDeep } from 'jest-mock-extended'

import { type RequestPrincipal, SystemRole } from '@amcore/shared'

import { ForbiddenException } from '../../common/exceptions/index.js'
import type { Prisma } from '../../generated/prisma/client.js'

import { lockOrganization } from './organization-authorization.js'

const principal: RequestPrincipal = {
  type: 'jwt',
  sub: 'actor',
  systemRole: SystemRole.SuperAdmin,
  organizationId: 'org',
}

describe('Organization row-lock membership boundary', () => {
  it('requires API-key membership even when old stored principal data says SUPER_ADMIN', async () => {
    const tx = mockDeep<Prisma.TransactionClient>()
    tx.organization.findUnique.mockResolvedValue({ id: 'org' } as never)
    tx.orgMember.findUnique.mockResolvedValue(null)
    await expect(lockOrganization(tx, 'org', { ...principal, type: 'api_key' })).rejects.toThrow(
      ForbiddenException
    )
  })

  it('keeps the admitted human platform bypass separate from API-key membership', async () => {
    const tx = mockDeep<Prisma.TransactionClient>()
    tx.organization.findUnique.mockResolvedValue({ id: 'org' } as never)
    expect(await lockOrganization(tx, 'org', principal)).toMatchObject({ id: 'org' })
    expect(tx.orgMember.findUnique).not.toHaveBeenCalled()
  })

  it('allows an organization-bound key to lock a row when membership exists', async () => {
    const tx = mockDeep<Prisma.TransactionClient>()
    tx.organization.findUnique.mockResolvedValue({ id: 'org' } as never)
    tx.orgMember.findUnique.mockResolvedValue({ id: 'member' } as never)
    expect(await lockOrganization(tx, 'org', { ...principal, type: 'api_key' })).toMatchObject({
      id: 'org',
    })
  })
})
