import { sendEmailJobDataSchema } from './email.schema'
import { EmailTemplate } from './email.types'

describe('sendEmailJobDataSchema (EQS-07 runtime validation)', () => {
  it('accepts a valid welcome job', () => {
    const result = sendEmailJobDataSchema.safeParse({
      template: EmailTemplate.WELCOME,
      to: 'user@example.com',
      data: { name: 'User', email: 'user@example.com' },
    })
    expect(result.success).toBe(true)
  })

  it('accepts a valid password-changed job', () => {
    const result = sendEmailJobDataSchema.safeParse({
      template: EmailTemplate.PASSWORD_CHANGED,
      to: 'user@example.com',
      data: {
        name: 'User',
        changedAt: new Date().toISOString(),
        loginUrl: 'https://app/login',
        supportEmail: 'support@example.com',
      },
    })
    expect(result.success).toBe(true)
  })

  it('rejects a secret-bearing template (not in the queueable union)', () => {
    const result = sendEmailJobDataSchema.safeParse({
      template: EmailTemplate.PASSWORD_RESET,
      to: 'user@example.com',
      data: { name: 'User', resetUrl: 'https://app/reset?token=x', expiresIn: '15m' },
    })
    expect(result.success).toBe(false)
  })

  it('rejects a payload missing a required field', () => {
    const result = sendEmailJobDataSchema.safeParse({
      template: EmailTemplate.WELCOME,
      to: 'user@example.com',
      data: { name: 'User' }, // missing email
    })
    expect(result.success).toBe(false)
  })

  it('rejects a non-email recipient', () => {
    const result = sendEmailJobDataSchema.safeParse({
      template: EmailTemplate.WELCOME,
      to: 'not-an-email',
      data: { name: 'User', email: 'user@example.com' },
    })
    expect(result.success).toBe(false)
  })

  it('rejects an unknown locale', () => {
    const result = sendEmailJobDataSchema.safeParse({
      template: EmailTemplate.WELCOME,
      to: 'user@example.com',
      data: { name: 'User', email: 'user@example.com', locale: 'fr' },
    })
    expect(result.success).toBe(false)
  })
})
