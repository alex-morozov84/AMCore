import { mockDeep } from 'jest-mock-extended'

import { type RequestPrincipal, SystemRole } from '@amcore/shared'

import { ORG_DEFAULT_PERMISSIONS } from '../auth/casl/org-role-defaults'
import { protectedUnitProjection } from '../auth/mfa/mfa-primary-projection.testkit.js'
import { assertSessionFresh } from '../auth/session-freshness'

import { canonicalAdmin } from './canonical-admin'
import { establishmentFailure } from './establishment-error'
import { establishmentFingerprint } from './establishment-write'
import { generatedOrganizationSlug } from './organization-creation.service'
import { admitSetupOperator } from './organization-setup-admission'

import type { Prisma } from '@/generated/prisma/client'

describe('organization establishment safety', () => {
  it('bounds generated slugs, preserves ASCII normalization and handles non-Latin names', () => {
    expect(generatedOrganizationSlug('Crème & Café')).toBe('creme-cafe')
    expect(generatedOrganizationSlug('Ромашка')).toMatch(/^organization-[0-9a-f]{8}$/)
    expect(generatedOrganizationSlug('a'.repeat(100), true)).toMatch(/^[a-z0-9-]{2,50}$/)
    expect(generatedOrganizationSlug('a')).toMatch(/^organization-/)
  })

  it('compares canonical intent without treating absent slug as an explicit value', () => {
    expect(establishmentFingerprint({ name: 'Acme', slug: 'acme' })).toBe(
      establishmentFingerprint({ slug: 'acme', name: 'Acme' })
    )
    expect(establishmentFingerprint({ name: 'Acme' })).not.toBe(
      establishmentFingerprint({ name: 'Acme', slug: 'acme' })
    )
  })

  it('rejects template drift without repairing any permission', async () => {
    const tx = mockDeep<Prisma.TransactionClient>()
    const permissions = ORG_DEFAULT_PERMISSIONS.map((permission) => ({
      roleId: 'admin',
      permissionId: permission.id,
      permission: { ...permission, organizationId: null },
    }))
    const role = {
      id: 'admin',
      name: 'ADMIN',
      description: null,
      isSystem: true,
      organizationId: null,
      permissions,
    }
    tx.role.findMany.mockResolvedValue([role] as never)
    expect(await canonicalAdmin(tx)).toBe('admin')
    permissions[0]!.permission.inverted = true
    await expect(canonicalAdmin(tx)).rejects.toMatchObject({ errorCode: 'SYSTEM_NOT_INITIALIZED' })
    expect(tx.permission.update).not.toHaveBeenCalled()
    expect(tx.rolePermission.create).not.toHaveBeenCalled()
    tx.role.findMany.mockResolvedValue([role, role] as never)
    await expect(canonicalAdmin(tx)).rejects.toMatchObject({ errorCode: 'SYSTEM_NOT_INITIALIZED' })
  })

  it('reads current role and protected family through the supplied transaction client', async () => {
    const tx = mockDeep<Prisma.TransactionClient>()
    const principal: RequestPrincipal = {
      type: 'jwt',
      sub: 'operator',
      sid: 'session',
      fid: 'operator-family',
      securityVersion: 0,
      systemRole: SystemRole.SuperAdmin,
    }
    tx.user.findUnique.mockResolvedValue({
      id: principal.sub,
      systemRole: SystemRole.SuperAdmin,
      mfaAccount: null,
      mfaFactor: null,
    } as never)
    const projection = protectedUnitProjection(principal, new Date())
    tx.$queryRaw.mockResolvedValue([projection])
    await admitSetupOperator(tx, { principal, freshWindowSeconds: 600 }, true)
    expect(tx.user.findUnique).toHaveBeenCalled()
    expect(tx.$queryRaw).toHaveBeenCalled()
    tx.user.findUnique.mockResolvedValue({ systemRole: SystemRole.User } as never)
    await expect(
      admitSetupOperator(tx, { principal, freshWindowSeconds: 600 }, true)
    ).rejects.toMatchObject({ errorCode: 'FORBIDDEN' })
    projection.family!.userId = 'someone-else'
    await expect(assertSessionFresh(tx, 600, principal)).rejects.toMatchObject({
      errorCode: 'SESSION_CHANGED',
    })
  })

  it.each([
    'missing',
    'not-system',
    'scoped',
    'missing-permission',
    'extra-permission',
    'fields',
    'conditions',
    'action',
    'subject',
  ])('fails closed for canonical ADMIN drift: %s', async (drift) => {
    const tx = mockDeep<Prisma.TransactionClient>()
    const role = {
      id: 'admin',
      name: 'ADMIN',
      description: null,
      isSystem: true,
      organizationId: null as string | null,
      permissions: ORG_DEFAULT_PERMISSIONS.map((permission) => ({
        roleId: 'admin',
        permissionId: permission.id,
        permission: {
          ...permission,
          organizationId: null,
          fields: [...permission.fields],
          conditions: permission.conditions as unknown,
        },
      })),
    }
    if (drift === 'not-system') role.isSystem = false
    if (drift === 'scoped') role.organizationId = 'other-company'
    if (drift === 'missing-permission') role.permissions.pop()
    if (drift === 'extra-permission') role.permissions.push(structuredClone(role.permissions[0]!))
    if (drift === 'fields') role.permissions[0]!.permission.fields.push('unexpected')
    if (drift === 'conditions') role.permissions[0]!.permission.conditions = { unexpected: true }
    if (drift === 'action') role.permissions[0]!.permission.action = 'unexpected' as never
    if (drift === 'subject') role.permissions[0]!.permission.subject = 'unexpected' as never
    tx.role.findMany.mockResolvedValue((drift === 'missing' ? [] : [role]) as never)
    await expect(canonicalAdmin(tx)).rejects.toMatchObject({ errorCode: 'SYSTEM_NOT_INITIALIZED' })
    expect(tx.permission.update).not.toHaveBeenCalled()
    expect(tx.rolePermission.create).not.toHaveBeenCalled()
    expect(tx.role.update).not.toHaveBeenCalled()
  })

  it('never classifies an unknown transaction completion as a rolled-back retry', () => {
    expect(() => establishmentFailure({ code: 'P2028' }, true)).toThrow('SETUP_UNCONFIRMED')
    expect(() => establishmentFailure({ code: 'P2034' }, true)).toThrow('SETUP_BUSY')
    expect(() => establishmentFailure({ code: 'P2010', meta: { code: '42501' } }, true)).toThrow(
      'SETUP_NOT_READY'
    )
  })
})
