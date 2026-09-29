// @vitest-environment node
import { createServer, type Server } from 'node:http'

import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { withinContextDeadline } from './context-deadline'
import { executeContextOperation } from './context-executor'
import { contextSessionBinding } from './context-session'
import { FakeVaultStore, makeEntry } from './test-fakes'
import { SimpleLock } from './test-lock-fakes'

vi.mock('server-only', () => ({}))

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Owned server did not bind')
  return `http://127.0.0.1:${address.port}`
}

describe('context deadline native waiting/cancellation', () => {
  it('the default 5s deadline covers native HTTP response-body parsing and cancels the request', async () => {
    let requests = 0
    let disconnected = false
    const server = createServer((_request, response) => {
      requests++
      response.on('close', () => {
        disconnected = true
      })
      response.writeHead(200, { 'content-type': 'application/json' })
      response.write('{"name":')
    })
    const apiBase = await listen(server)
    const entry = makeEntry({ userSnapshot: { id: 'actor' } as never })
    const store = new FakeVaultStore()
    store.seed('owned-session', entry)
    const started = performance.now()
    try {
      await expect(
        executeContextOperation(
          {
            method: 'GET',
            path: '/api/v1/context-rehearsal/stall',
            schema: z.object({ name: z.string() }),
          },
          {
            expectedSession: contextSessionBinding('owned-session', entry),
            headers: new Headers(),
          },
          {
            apiBase,
            readSessionId: async () => 'owned-session',
            store,
            lock: new SimpleLock(),
            upstreamRefresh: vi.fn(),
          }
        )
      ).rejects.toMatchObject({ name: 'TimeoutError' })
      expect(performance.now() - started).toBeGreaterThanOrEqual(4900)
      expect(requests).toBe(1)
      await vi.waitFor(() => expect(disconnected).toBe(true))
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }, 10000)

  it('caller abort retires waiting immediately even when the pending work ignores cancellation', async () => {
    const controller = new AbortController()
    let resolve!: (value: string) => void
    const pending = withinContextDeadline(
      controller.signal,
      () =>
        new Promise<string>((done) => {
          resolve = done
        })
    )
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    resolve('late result')
    await Promise.resolve()
  })
})
