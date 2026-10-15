import { once } from 'node:events'
import { createServer } from 'node:http'

import { structuredFixture } from '../../../../../test/fixtures/ai-structured-output.js'
import { AiProviderType } from '../../../../generated/prisma/client.js'

import { OpenAICompatibleAdapter } from './openai-compatible.adapter.js'

/** Transport tests use only loopback or an injected fetch; no external credentials or egress. */
describe('SDK7 provider transport contract', () => {
  it('does not follow an HTTP redirect or retry the request', async () => {
    let requests = 0
    let escaped = 0
    const server = createServer((request, response) => {
      requests++
      if (request.url === '/trap') escaped++
      response.writeHead(302, { Location: '/trap' }).end()
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    try {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('No loopback address')
      const f = structuredFixture('unused')
      f.call.model.provider.baseUrl = `http://127.0.0.1:${address.port}/v1`
      await expect(new OpenAICompatibleAdapter().generateText(f.call)).rejects.toMatchObject({
        code: 'provider_unavailable',
      })
      expect(requests).toBe(1)
      expect(escaped).toBe(0)
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )
    }
  })

  it.each([429, 500])('does not retry status %s', async (status) => {
    let calls = 0
    const fetchImpl: typeof fetch = async () => {
      calls++
      return Response.json(
        { error: { message: 'fixture failure' } },
        { status, headers: { 'retry-after': '2' } }
      )
    }
    const f = structuredFixture('unused')
    await expect(new OpenAICompatibleAdapter(fetchImpl).generateText(f.call)).rejects.toMatchObject(
      { code: 'provider_unavailable', retryable: true }
    )
    expect(calls).toBe(1)
  })

  it('keeps the named OpenRouter endpoint and explicit key', async () => {
    const f = structuredFixture('ok')
    f.call.model.provider.type = AiProviderType.OPENROUTER
    f.call.model.provider.baseUrl = 'https://poisoned.invalid/v1'
    const fetchImpl: typeof fetch = async (input, init) => {
      expect(String(input)).toBe('https://openrouter.ai/api/v1/chat/completions')
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer <fixture-key>')
      return Response.json({
        id: 'x',
        created: 0,
        model: 'm',
        choices: [
          { index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' },
        ],
      })
    }
    expect((await new OpenAICompatibleAdapter(fetchImpl).generateText(f.call)).text).toBe('ok')
  })

  it('makes no request for an already-aborted caller', async () => {
    const f = structuredFixture('unused')
    f.call.abortSignal = AbortSignal.abort()
    await expect(f.adapter.generateText(f.call)).rejects.toMatchObject({
      code: 'aborted',
      retryable: false,
    })
    expect(f.requests).toHaveLength(0)
  })
})
