import { isRoleNameConflict } from './role-definition-guards'

const p2002 = (meta: unknown): unknown => ({ code: 'P2002', meta })

describe('isRoleNameConflict', () => {
  it('recognizes only the role (organizationId, name) unique constraint', () => {
    // Shape reported by Prisma 7 with the pg driver adapter (verified against the installed client).
    expect(
      isRoleNameConflict(
        p2002({
          modelName: 'Role',
          driverAdapterError: { cause: { constraint: { index: 'roles_organizationId_name_key' } } },
        })
      )
    ).toBe(true)
    expect(
      isRoleNameConflict(p2002({ modelName: 'Role', target: ['organizationId', 'name'] }))
    ).toBe(true)
  })

  it('refuses other unique violations, other models, absent metadata and other codes', () => {
    expect(
      isRoleNameConflict(
        p2002({
          modelName: 'Organization',
          driverAdapterError: { cause: { constraint: { index: 'organizations_slug_key' } } },
        })
      )
    ).toBe(false)
    expect(isRoleNameConflict(p2002({ modelName: 'Permission', target: ['id'] }))).toBe(false)
    expect(isRoleNameConflict(p2002(undefined))).toBe(false)
    expect(isRoleNameConflict({ code: 'P2034', meta: { modelName: 'Role' } })).toBe(false)
    expect(isRoleNameConflict(new Error('boom'))).toBe(false)
    expect(isRoleNameConflict(null)).toBe(false)
  })
})
