import { Action, assignPermissionSchema, Subject } from '@amcore/shared'

/**
 * OB-01: `assignPermissionSchema.action` and `.subject` are validated
 * against the shared `Action` and `Subject` enums. Free-form strings
 * (typos like `'usr'`, domain subjects added to a fork without
 * editing the enum) are rejected at the schema boundary, not silently
 * accepted into the permission table where no policy would consult
 * them.
 *
 * Schema specs live in the API workspace — per project precedent
 * (see `api-keys-schema.spec.ts`), `packages/shared` does not have a
 * test runner of its own.
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
    it.each([Subject.User, Subject.Organization, Subject.Role, Subject.Permission, Subject.All])(
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

    it('rejects MEMBER-style legacy "create:all" only if action invalid (Subject.All is valid)', () => {
      // Subject.All by itself is fine; we only reject when action OR
      // subject is off-enum. Sanity check the boundary.
      expect(
        assignPermissionSchema.safeParse({ action: Action.Create, subject: Subject.All }).success
      ).toBe(true)
      expect(
        assignPermissionSchema.safeParse({ action: 'CREATE', subject: Subject.All }).success
      ).toBe(false)
    })
  })
})
