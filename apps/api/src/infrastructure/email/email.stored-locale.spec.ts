import { Test } from '@nestjs/testing'
import { PinoLogger } from 'nestjs-pino'

import { sendEmailJobDataSchema } from './email.schema'
import { EmailService } from './email.service'
import { EmailTemplate } from './email.types'
import { preparedEmailBodySchema } from './prepared-email'
import { getWelcomeSubject } from './templates/welcome'

import { EnvService } from '@/env/env.service'
import { MetricsService } from '@/infrastructure/observability'
import { QueueService } from '@/infrastructure/queue/queue.service'

// This build serves Russian only. English stays a shipped catalogue, so it is a known value in
// stored data but a locale this build no longer serves. The mock fixes the served list for this
// file whatever `locales.json` says; the real mapping rules are tested in `packages/shared`.
jest.mock('@amcore/shared', () => {
  const actual = jest.requireActual('@amcore/shared')
  return {
    ...actual,
    SUPPORTED_LOCALES: ['ru'],
    DEFAULT_LOCALE: 'ru',
    coerceSupportedLocale: () => 'ru',
  }
})

/** A job as an earlier build stored it, before the product dropped English. */
const storedJob = {
  template: EmailTemplate.WELCOME,
  to: 'anna@example.com',
  userId: 'user-1',
  data: { name: 'Anna', email: 'anna@example.com', locale: 'en' },
}

describe('queued email whose stored locale is no longer served', () => {
  let service: EmailService

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        EmailService,
        { provide: 'EmailProvider', useValue: { send: jest.fn() } },
        { provide: QueueService, useValue: { add: jest.fn() } },
        { provide: EnvService, useValue: { get: jest.fn(() => 'Support <noreply@example.test>') } },
        {
          provide: PinoLogger,
          useValue: { setContext: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
        },
        { provide: MetricsService, useValue: { observeEmailOperation: jest.fn() } },
      ],
    }).compile()
    service = moduleRef.get(EmailService)
  })

  it('has two different subjects to compare, so the checks below mean something', () => {
    expect(getWelcomeSubject('en')).not.toBe(getWelcomeSubject('ru'))
  })

  it('accepts the stored job in the shared admission schema (worker and legacy upgrade)', () => {
    expect(sendEmailJobDataSchema.safeParse(storedJob).success).toBe(true)
  })

  it('still refuses a locale that is not a shipped catalogue', () => {
    const unknown = { ...storedJob, data: { ...storedJob.data, locale: 'xx' } }
    expect(sendEmailJobDataSchema.safeParse(unknown).success).toBe(false)
  })

  it('prepares the whole message in the default locale: subject, HTML and plain text', async () => {
    const prepared = preparedEmailBodySchema.parse(
      JSON.parse(await service.prepareQueuedRequest(storedJob))
    )
    const baseline = await service.renderTemplate(EmailTemplate.WELCOME, {
      ...storedJob.data,
      locale: 'ru',
    })

    expect(prepared.subject).toBe(getWelcomeSubject('ru'))
    expect(prepared.html).toBe(baseline.html)
    expect(prepared.text).toBe(baseline.text)
    expect(prepared.to).toEqual(['anna@example.com'])
  })

  it('renders a direct call with a not-served locale in one language only', async () => {
    const stored = await service.renderTemplate(EmailTemplate.WELCOME, {
      ...storedJob.data,
      locale: 'en',
    })
    const baseline = await service.renderTemplate(EmailTemplate.WELCOME, {
      ...storedJob.data,
      locale: 'ru',
    })
    expect(stored).toEqual(baseline)
  })
})
