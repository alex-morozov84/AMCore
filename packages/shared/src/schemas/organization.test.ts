import { describe, expect, it } from 'vitest'

import { Action, Subject } from '../enums/permissions'

import { assignPermissionSchema } from './organization'

/**
 * OB-01: `assignPermissionSchema.action` and `.subject` are validated
 * against the shared `Action` and `Subject` enums. Free-form strings
 * (typos like `'usr'`, domain subjects added to a fork without
 * editing the enum) are rejected at the schema boundary, not silently
 * accepted into the permission table where no policy would consult
 * them.
 */
describe('assignPermissionSchema (OB-01)', () => {
  const baseInput = { action: Action.Read, subject: Subject.User }

  describe('action enum', () => {
    it.each([Action.Create, Action.Read, Action.Update, Action.Delete, Action.Manage])(
      'accepts action %s',
      (action) => {
        const result = assignPermissionSchema.safeParse({ ...baseInput, action })
        expect(result.success).toBe(true)
      }
    )

    it.each(['Create', 'CREATE', 'foo', 'createUser', '', ' read'])(
      'rejects invalid action %s',
      (action) => {
        const result = assignPermissionSchema.safeParse({ ...baseInput, action })
        expect(result.success).toBe(false)
      }
    )
  })

  describe('subject enum', () => {
    it.each([Subject.User, Subject.Organization, Subject.Role, Subject.Permission])(
      'accepts subject %s',
      (subject) => {
        const result = assignPermissionSchema.safeParse({ ...baseInput, subject })
        expect(result.success).toBe(true)
      }
    )

    it.each(['Contact', 'Deal', 'foo', 'user', 'User ', ' User', ''])(
      'rejects invalid subject %s',
      (subject) => {
        const result = assignPermissionSchema.safeParse({ ...baseInput, subject })
        expect(result.success).toBe(false)
      }
    )
  })

  describe('combined', () => {
    it('accepts a fully valid assignment with optional fields/conditions', () => {
      const result = assignPermissionSchema.safeParse({
        action: Action.Manage,
        subject: Subject.Organization,
        conditions: { ownerId: 'user-1' },
        fields: ['name', 'slug'],
        inverted: true,
      })
      expect(result.success).toBe(true)
    })

    it('rejects positive wildcard grants but accepts wildcard DENY', () => {
      expect(
        assignPermissionSchema.safeParse({ action: Action.Create, subject: Subject.All }).success
      ).toBe(false)
      expect(
        assignPermissionSchema.safeParse({
          action: Action.Read,
          subject: Subject.All,
          inverted: true,
        }).success
      ).toBe(true)
    })
    it('accepts unrestricted TeamAccess only', () => {
      const team = { action: Action.Manage, subject: Subject.TeamAccess }
      expect(assignPermissionSchema.safeParse(team).success).toBe(true)
      for (const variant of [
        { action: Action.Read },
        { conditions: { id: 'org' } },
        { fields: ['name'] },
      ]) {
        expect(assignPermissionSchema.safeParse({ ...team, ...variant }).success).toBe(false)
      }
      for (const fields of [[], ['*']]) {
        expect(
          assignPermissionSchema.safeParse({ ...team, conditions: null, fields }).success
        ).toBe(true)
      }
    })
  })
})
