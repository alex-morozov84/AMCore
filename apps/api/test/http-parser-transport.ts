import type { Server } from 'node:http'
import { Agent, request } from 'node:http'
import { gzipSync } from 'node:zlib'

export function parserTransportChecks(
  name: string,
  server: () => Server,
  base: () => Promise<string>
): void {
  describe(`H-P chunked/keepalive/abort: ${name}`, () => {
    let agent: Agent
    beforeEach(() => {
      agent = new Agent({ keepAlive: true, maxSockets: 1 })
    })
    afterEach(() => agent.destroy())
    const send = async (
      chunks: Buffer[],
      headers: Record<string, string> = {},
      framed = true
    ): Promise<{
      status: number
      body: Record<string, unknown>
      socket: unknown
      connection?: string
    }> => {
      const url = new URL('/api/v1/body-size/echo', await base())
      return new Promise<{
        status: number
        body: Record<string, unknown>
        socket: unknown
        connection?: string
      }>((resolve, reject) => {
        let socket: unknown
        const wireHeaders: Record<string, string> = {
          'Content-Type': 'application/json',
          ...(framed && headers['Content-Length'] === undefined
            ? { 'Transfer-Encoding': 'chunked' }
            : {}),
          ...headers,
        }
        if (headers['Content-Type'] === '') delete wireHeaders['Content-Type']
        const req = request(
          url,
          {
            method: 'POST',
            agent,
            headers: wireHeaders,
          },
          (response) => {
            let body = ''
            response.on('data', (chunk) => {
              body += chunk
            })
            response.on('error', reject)
            response.on('end', () =>
              resolve({
                status: response.statusCode!,
                body: JSON.parse(body),
                socket,
                connection: response.headers.connection,
              })
            )
          }
        )
        if (!framed) req.useChunkedEncodingByDefault = false
        req.on('socket', (value) => {
          socket = value
        })
        req.on('error', reject)
        for (const chunk of chunks) req.write(chunk)
        req.end()
      })
    }
    it('reuses valid chunked requests and honors the adapter connection policy after parser refusal', async () => {
      const first = await send([Buffer.from('{"value":'), Buffer.from('"ok"}')])
      expect(first.status).toBe(200)
      const second = await send([gzipSync('{"value":"compressed"}')], {
        'Content-Encoding': 'GZip',
      })
      expect(second.status).toBe(200)
      expect(second.socket).toBe(first.socket)
      const broken = await send([Buffer.from('broken gzip')], { 'Content-Encoding': 'gzip' })
      expect(broken.status).toBe(400)
      const recovered = await send([Buffer.from('{}')])
      expect(recovered.status).toBe(200)
      // Fastify's public parser path deliberately sends Connection:close on parser errors.
      if (name === 'fastify') expect(broken.connection).toBe('close')
      expect(recovered.socket === broken.socket).toBe(name === 'express')
    })
    it('accepts framed empty JSON as an object and rejects whitespace-only JSON', async () => {
      const empty = await send([])
      expect(empty.status).toBe(200)
      expect(empty.body.body).toEqual({})
      expect((await send([Buffer.from('   ')])).status).toBe(400)
    })
    it('distinguishes absent media/body from Content-Length0 and framed empty JSON', async () => {
      let incomingHeaders: import('node:http').IncomingHttpHeaders | undefined
      server().once('request', (incoming) => {
        incomingHeaders = incoming.headers
      })
      const absent = await send([], {}, false)
      expect(incomingHeaders?.['content-length']).toBeUndefined()
      expect(incomingHeaders?.['transfer-encoding']).toBeUndefined()
      expect(absent.status).toBe(200)
      expect(absent.body.body).toBeUndefined()
      const absentForm = await send(
        [],
        { 'Content-Type': 'application/x-www-form-urlencoded' },
        false
      )
      expect(absentForm.status).toBe(200)
      expect(absentForm.body.body).toBeUndefined()
      const zero = await send([], { 'Content-Length': '0' })
      expect(zero.status).toBe(200)
      expect(zero.body.body).toEqual({})
      const chunked = await send([])
      expect(chunked.status).toBe(200)
      expect(chunked.body.body).toEqual({})
    })
    it('closes an aborted partial body and serves the next request', async () => {
      const url = new URL('/api/v1/body-size/echo', await base())
      let observedData!: () => void
      let observedAbort!: () => void
      const data = new Promise<void>((resolve) => {
        observedData = resolve
      })
      const aborted = new Promise<void>((resolve) => {
        observedAbort = resolve
      })
      server().once('request', (incoming) => {
        incoming.once('data', observedData)
        incoming.once('aborted', observedAbort)
      })
      const req = request(url, {
        method: 'POST',
        agent,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': '1000',
        },
      })
      req.on('error', () => {
        /* Expected client cancellation; response is not counted as success. */
      })
      req.write('{"partial":"')
      await data
      req.destroy()
      await aborted
      expect((await send([Buffer.from('{}')])).status).toBe(200)
    })
  })
}
