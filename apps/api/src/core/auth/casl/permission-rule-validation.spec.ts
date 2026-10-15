import { Action, Subject } from '@amcore/shared'

import { validatePermissionRule } from './permission-rule-validation'

describe('validatePermissionRule derived fields', () => {
  const rule = {
    action: Action.Read,
    subject: Subject.User,
    inverted: false,
  }
  const refused = (code: string) => expect.objectContaining({ errorCode: code }) as unknown as Error

  it('accepts a derived attribute in fields', () => {
    expect(() => validatePermissionRule({ ...rule, fields: ['id', 'avatarUrl'] })).not.toThrow()
  })

  it.each([{ avatarUrl: null }, { NOT: { avatarUrl: 'x' } }, { OR: [{ avatarUrl: null }] }])(
    'refuses a derived attribute in conditions: %j',
    (conditions) => {
      expect(() => validatePermissionRule({ ...rule, conditions })).toThrow(
        refused('PERMISSION_RULE_UNSUPPORTED')
      )
    }
  )

  it('still accepts a stored scalar in conditions', () => {
    expect(() => validatePermissionRule({ ...rule, conditions: { id: 'u1' } })).not.toThrow()
  })

  it('keeps refusing the stored key, which is not part of the vocabulary', () => {
    expect(() => validatePermissionRule({ ...rule, fields: ['avatarKey'] })).toThrow(
      refused('PERMISSION_FIELD_UNSUPPORTED')
    )
    expect(() => validatePermissionRule({ ...rule, conditions: { avatarKey: null } })).toThrow(
      refused('PERMISSION_RULE_UNSUPPORTED')
    )
  })
})
