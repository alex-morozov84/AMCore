import type { PinoLogger } from 'nestjs-pino'

import type { EnvService } from '../../../env/env.service.js'

import { ResendEmailProvider } from './resend.provider.js'

/** Runs the installed SDK with an in-memory fetch; no provider or secret-bearing artifacts. */
describe('installed Resend direct transport fence', () => {
  const make = () =>
    new ResendEmailProvider(
      {
        get: (key: string) => (key === 'RESEND_API_KEY' ? '<fake-key>' : 'sender@example.test'),
      } as EnvService,
      { setContext: jest.fn(), info: jest.fn(), warn: jest.fn() } as unknown as PinoLogger
    )
  afterEach(() => jest.restoreAllMocks())

  it('calls the final admission once, immediately before the only fetch', async () => {
    const events: string[] = []
    const fetch = jest.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      events.push('fetch')
      return new Response(JSON.stringify({ id: 'fake-ack' }), { status: 200 })
    })
    const provider = make()
    const beforeTransport = jest.fn(() => {
      events.push('fence')
    })
    const result = await provider.send({
      to: 'recipient@example.test',
      subject: 'Safe test',
      html: '<p>Fake message</p>',
      beforeTransport,
    })
    expect(result.success).toBe(true)
    expect(events).toEqual(['fence', 'fetch'])
    expect(beforeTransport).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('never calls fetch when final admission fails', async () => {
    const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'))
    const provider = make()
    await provider.send({
      to: 'recipient@example.test',
      subject: 'Safe test',
      html: '<p>Fake message</p>',
      beforeTransport: () => {
        throw new Error('closed')
      },
    })
    expect(fetch).not.toHaveBeenCalled()
  })
})
