import { createHash } from 'node:crypto'

import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

import type { EmailProvider, SendEmailParams, SendEmailResult } from '../email.types'
import type { QueuedEmailProvider } from '../queued-email-provider'

import { EnvService } from '@/env/env.service'
import { ControlConnection } from '@/infrastructure/background-work/control-connection'

const MOCK_ACCEPT_LUA = `
local kind = redis.call('TYPE',KEYS[1]).ok
if kind ~= 'none' and kind ~= 'string' then return 'unknown' end
if redis.call('STRLEN',KEYS[1]) > 64 then return 'unknown' end
local prior = redis.call('GET',KEYS[1])
if prior then return prior == ARGV[1] and 'accepted' or 'conflict' end
redis.call('SET',KEYS[1],ARGV[1],'PX',86400000)
return 'accepted'
`

/**
 * Mock Email Provider
 *
 * Used in development and testing environments. Logs metadata only: rendered
 * email bodies may contain secret token URLs and must not enter application logs.
 */
@Injectable()
export class MockEmailProvider implements EmailProvider {
  readonly queuedEmail?: QueuedEmailProvider

  constructor(
    private readonly logger: PinoLogger,
    env?: EnvService,
    control?: ControlConnection
  ) {
    this.logger.setContext(MockEmailProvider.name)
    if (env && control)
      this.queuedEmail = {
        recipeVersion: 1,
        provider: 'mock',
        scope: () =>
          createHash('sha256')
            .update(
              JSON.stringify({
                provider: 'mock',
                slot: 'REDIS_URL',
                credential: createHash('sha256').update(env.get('REDIS_URL')).digest('hex'),
                recipeVersion: 1,
              })
            )
            .digest('hex'),
        send: async (body, key, _signal, beforeTransport) =>
          control.withClient(async (client) => {
            const digest = createHash('sha256').update(body).digest('hex')
            const redisKey = `amcore:mock-email:${createHash('sha256').update(key).digest('hex')}`
            beforeTransport()
            const result = await client.eval(MOCK_ACCEPT_LUA, 1, redisKey, digest)
            if (result === 'accepted')
              return { certainty: 'accepted', retryable: false, code: 'COMPLETED' }
            if (result === 'conflict')
              return { certainty: 'none', retryable: false, code: 'PERMANENT_FAILURE' }
            return { certainty: 'unknown', retryable: true, code: 'TRANSIENT_FAILURE' }
          }),
      }
  }

  async sendPrepared(_body: string, _key: string, _signal: AbortSignal): Promise<SendEmailResult> {
    this.logger.info({ template: 'notification' }, 'Prepared notification sent (MOCK)')
    return { id: `mock-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`, success: true }
  }

  async send(params: SendEmailParams): Promise<SendEmailResult> {
    const { to, subject, html, text, from, replyTo } = params

    this.logger.info(
      { to, from, subject, replyTo, hasHtml: !!html, hasText: !!text },
      'Email sent (MOCK)'
    )

    // Simulate successful send
    return {
      id: `mock-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      success: true,
    }
  }
}
