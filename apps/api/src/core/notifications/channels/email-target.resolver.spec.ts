import { NotificationChannel } from '../notification.constants'
import type { NotificationDefinition } from '../notification-definition.types'

import type { TargetRecipient } from './channel-target-resolver.types'
import { EMAIL_SKIP_UNVERIFIED, EmailTargetResolver } from './email-target.resolver'

const resolver = new EmailTargetResolver()

const recipient = (overrides: Partial<TargetRecipient> = {}): TargetRecipient => ({
  id: 'user-1',
  email: 'alice@example.com',
  emailCanonical: 'alice@example.com',
  emailVerified: true,
  locale: 'en',
  ...overrides,
})

const context = (r: TargetRecipient) => ({
  recipient: r,
  definition: {} as NotificationDefinition,
  payload: {},
  locale: r.locale,
})

describe('EmailTargetResolver', () => {
  it('targets the canonical email and redacts the snapshot for a verified recipient', () => {
    const [target] = resolver.resolveTargets(context(recipient()))
    expect(target).toEqual({
      targetKey: 'alice@example.com',
      destinationSnapshot: { email: 'a***@example.com' },
    })
    expect(target?.skipReasonCode).toBeUndefined()
  })

  it('skips an unverified recipient with a bounded reason (never a live address at rest)', () => {
    const [target] = resolver.resolveTargets(context(recipient({ emailVerified: false })))
    expect(target?.skipReasonCode).toBe(EMAIL_SKIP_UNVERIFIED)
    // Snapshot is still redacted even when skipped.
    expect(target?.destinationSnapshot).toEqual({ email: 'a***@example.com' })
  })

  it('declares the email channel', () => {
    expect(resolver.channel).toBe(NotificationChannel.EMAIL)
  })
})
