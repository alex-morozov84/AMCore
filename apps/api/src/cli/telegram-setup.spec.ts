import { runTelegramSetup } from './telegram-setup'

const validEnv = {
  TELEGRAM_BOT_TOKEN: 'bot-tok-fake',
  WEBHOOK_TELEGRAM_SECRET: 'aB0_-Zz9',
  TELEGRAM_WEBHOOK_URL: 'https://app.example/webhooks/telegram',
} satisfies NodeJS.ProcessEnv

function mockFetch(status: number, body: unknown): jest.Mock {
  const fetchMock = jest.fn().mockResolvedValue({
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
  })
  globalThis.fetch = fetchMock as unknown as typeof fetch
  return fetchMock
}

describe('runTelegramSetup', () => {
  let errorSpy: jest.SpyInstance
  let logSpy: jest.SpyInstance

  beforeEach(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)
  })
  afterEach(() => jest.restoreAllMocks())

  it('registers the webhook with a valid config', async () => {
    const fetchMock = mockFetch(200, { ok: true, result: true })
    await expect(runTelegramSetup(validEnv)).resolves.toBe(true)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toContain('/setWebhook')
    expect(JSON.parse((init as { body: string }).body)).toMatchObject({
      url: validEnv.TELEGRAM_WEBHOOK_URL,
      secret_token: validEnv.WEBHOOK_TELEGRAM_SECRET,
      allowed_updates: ['message'],
      drop_pending_updates: false,
    })
    expect(logSpy).toHaveBeenCalled()
  })

  it('honors TELEGRAM_DROP_PENDING=true', async () => {
    const fetchMock = mockFetch(200, { ok: true, result: true })
    await runTelegramSetup({ ...validEnv, TELEGRAM_DROP_PENDING: 'true' })
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body)
    expect(body.drop_pending_updates).toBe(true)
  })

  it('fails a missing webhook URL without calling fetch or printing any value', async () => {
    const fetchMock = jest.fn()
    globalThis.fetch = fetchMock as unknown as typeof fetch
    const { TELEGRAM_WEBHOOK_URL: _omit, ...partial } = validEnv
    await expect(runTelegramSetup(partial)).resolves.toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('TELEGRAM_WEBHOOK_URL'))
    const printed = errorSpy.mock.calls.flat().join(' ')
    expect(printed).not.toContain(validEnv.TELEGRAM_BOT_TOKEN)
    expect(printed).not.toContain(validEnv.WEBHOOK_TELEGRAM_SECRET)
  })

  it('rejects a malformed secret grammar before any request', async () => {
    const fetchMock = jest.fn()
    globalThis.fetch = fetchMock as unknown as typeof fetch
    await expect(
      runTelegramSetup({ ...validEnv, WEBHOOK_TELEGRAM_SECRET: 'bad secret!' })
    ).resolves.toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns false when Telegram rejects the request', async () => {
    mockFetch(401, { ok: false })
    await expect(runTelegramSetup(validEnv)).resolves.toBe(false)
  })
})
