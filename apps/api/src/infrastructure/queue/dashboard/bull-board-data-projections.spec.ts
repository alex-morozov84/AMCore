import { SUPPORTED_LOCALES } from '@amcore/shared'

import {
  BOARD_DATA_PROJECTIONS,
  projectAiRunWakeJobData,
  projectEmailJobData,
  projectNotificationJobData,
} from './bull-board-data-projections'

// A supported locale, not a spelled-out one: a fork that keeps a single locale supports only that.
const LOCALE = SUPPORTED_LOCALES[SUPPORTED_LOCALES.length - 1]

const REAL_EMAIL_JOB = {
  template: 'welcome',
  to: 'alice@example.com',
  userId: 'user_01HZ',
  data: { name: 'Alice Example', email: 'alice@example.com', locale: LOCALE },
}

function serialized(value: unknown): string {
  return JSON.stringify(value)
}

describe('email job projection', () => {
  it('shows only template, locale and the opaque user id of a real job', () => {
    expect(projectEmailJobData(REAL_EMAIL_JOB)).toEqual({
      template: 'welcome',
      locale: LOCALE,
      userId: 'user_01HZ',
    })
  })

  it('never carries the recipient or the name', () => {
    const shown = serialized(projectEmailJobData(REAL_EMAIL_JOB))
    expect(shown).not.toContain('alice')
    expect(shown).not.toContain('Alice')
    expect(shown).not.toContain('@')
  })

  it('treats userId and locale as optional', () => {
    expect(
      projectEmailJobData({
        template: 'welcome',
        to: 'a@b.co',
        data: { name: 'A', email: 'a@b.co' },
      })
    ).toEqual({ template: 'welcome' })
  })

  it.each([
    ['not an object', 'x'],
    ['null', null],
    ['an array', []],
    ['a secret-bearing template', { ...REAL_EMAIL_JOB, template: 'password-reset' }],
    ['an unknown template', { ...REAL_EMAIL_JOB, template: 'nope' }],
    ['a non-string template', { ...REAL_EMAIL_JOB, template: { x: 1 } }],
    ['an unsupported locale', { ...REAL_EMAIL_JOB, data: { locale: 'de' } }],
    [
      'a user id that is a URL',
      { ...REAL_EMAIL_JOB, userId: 'https://app.example/reset?token=abc' },
    ],
    ['an over-long user id', { ...REAL_EMAIL_JOB, userId: 'a'.repeat(65) }],
    ['a nested user id', { ...REAL_EMAIL_JOB, userId: { token: 'x' } }],
    ['a user id with spaces', { ...REAL_EMAIL_JOB, userId: 'user 1' }],
  ])('hides the whole payload for %s', (_label, data) => {
    expect(projectEmailJobData(data)).toBeNull()
  })
})

describe('notification wake projection', () => {
  it('shows the opaque notification id', () => {
    expect(projectNotificationJobData({ notificationId: 'ntf_123-abc' })).toEqual({
      notificationId: 'ntf_123-abc',
    })
  })

  it('tolerates a job without an id by hiding it, not by throwing', () => {
    expect(projectNotificationJobData({})).toBeNull()
  })

  it.each([
    ['a URL', { notificationId: 'https://x.example/?t=1' }],
    ['an object', { notificationId: { a: 1 } }],
    ['too long', { notificationId: 'a'.repeat(65) }],
    ['null data', null],
  ])('hides %s', (_label, data) => {
    expect(projectNotificationJobData(data)).toBeNull()
  })

  it('drops extra keys instead of passing them through', () => {
    const shown = projectNotificationJobData({ notificationId: 'n1', secret: 'CANARY' })
    expect(serialized(shown)).not.toContain('CANARY')
  })
})

describe('AI run wake projection', () => {
  it('shows the opaque run id', () => {
    expect(projectAiRunWakeJobData({ runId: 'run_123-abc' })).toEqual({ runId: 'run_123-abc' })
  })

  it.each([
    ['no id', {}],
    ['a URL', { runId: 'https://x.example/?t=1' }],
    ['an object', { runId: { a: 1 } }],
    ['too long', { runId: 'a'.repeat(65) }],
    ['null data', null],
  ])('hides %s', (_label, data) => {
    expect(projectAiRunWakeJobData(data)).toBeNull()
  })

  it('drops extra keys instead of passing them through', () => {
    expect(serialized(projectAiRunWakeJobData({ runId: 'r1', prompt: 'CANARY' }))).not.toContain(
      'CANARY'
    )
  })

  it('is registered for the ai-runs queue and for no queue by default', () => {
    expect(BOARD_DATA_PROJECTIONS.get('ai-runs')).toBe(projectAiRunWakeJobData)
    expect(BOARD_DATA_PROJECTIONS.get('default')).toBeUndefined()
  })

  it.each(['constructor', 'toString', 'hasOwnProperty', '__proto__', 'valueOf'])(
    'has no projection for the inherited name %s',
    (name) => {
      expect(BOARD_DATA_PROJECTIONS.get(name)).toBeUndefined()
    }
  )
})
