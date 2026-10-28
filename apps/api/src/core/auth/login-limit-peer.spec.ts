import { once } from 'node:events'
import { createServer, type Socket } from 'node:net'
import { performance } from 'node:perf_hooks'

import { LoginLimitConnection } from './login-limit-connection'
import { LoginRateLimiterService } from './login-rate-limiter.service'

/** Local RESP lifecycle probe, not a storage or Lua correctness substitute. */
async function peer(reply: (command: string[], socket: Socket) => void) {
  const sockets = new Set<Socket>()
  const commands: string[][] = []
  const server = createServer((socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    let bytes = ''
    socket.on('data', (data) => {
      bytes += data.toString()
      while (bytes) {
        const head = /^\*(\d+)\r\n/.exec(bytes)
        if (!head) return
        let offset = head[0].length
        const args: string[] = []
        for (let i = 0; i < Number(head[1]); i++) {
          const bulk = /^\$(\d+)\r\n/.exec(bytes.slice(offset))
          if (!bulk) return
          offset += bulk[0].length
          const length = Number(bulk[1])
          if (bytes.length < offset + length + 2) return
          args.push(bytes.slice(offset, offset + length))
          offset += length + 2
        }
        bytes = bytes.slice(offset)
        commands.push(args)
        reply(args, socket)
      }
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No peer')
  return {
    commands,
    sockets,
    url: `redis://127.0.0.1:${address.port}`,
    close: async () => {
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}
const run = (url: string) =>
  LoginLimitConnection.acquire().run(() => url, 'return {1,0}', ['a', 'b', 'c'], 'check')

async function withinWatchdog<T>(operation: () => Promise<T>): Promise<T> {
  let timer!: ReturnType<typeof setTimeout>
  const watchdog = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Redis peer wave did not settle')), 750)
  })
  try {
    return await Promise.race([operation(), watchdog])
  } finally {
    clearTimeout(timer)
  }
}

describe('actual ioredis bounded lifecycle against controlled RESP peer', () => {
  it('does not poll INFO while loading and does not resend EVAL', async () => {
    const p = await peer((args, socket) =>
      socket.write(args[0]?.toLowerCase() === 'eval' ? '-LOADING loading\r\n' : '+OK\r\n')
    )
    try {
      const start = performance.now()
      await expect(run(p.url)).rejects.toThrow()
      expect(performance.now() - start).toBeLessThanOrEqual(750)
      expect(p.commands.filter((c) => c[0]?.toLowerCase() === 'info')).toHaveLength(0)
      expect(p.commands.filter((c) => c[0]?.toLowerCase() === 'eval')).toHaveLength(1)
    } finally {
      await p.close()
    }
  })
  it('bounds withheld AUTH and prevents later EVAL', async () => {
    const p = await peer(() => undefined)
    try {
      const start = performance.now()
      await expect(run(p.url.replace('redis://', 'redis://:fake@'))).rejects.toThrow()
      expect(performance.now() - start).toBeLessThanOrEqual(750)
      expect(p.commands.some((c) => c[0]?.toLowerCase() === 'auth')).toBe(true)
      expect(p.commands.some((c) => c[0]?.toLowerCase() === 'eval')).toBe(false)
    } finally {
      await p.close()
    }
  })
  it('bounds a withheld TLS handshake without EVAL submission', async () => {
    const sockets = new Set<Socket>()
    const server = createServer((socket) => {
      sockets.add(socket)
      socket.on('close', () => sockets.delete(socket))
      socket.on('data', () => undefined)
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('No TLS peer')
    try {
      const start = performance.now()
      await expect(run(`rediss://127.0.0.1:${address.port}`)).rejects.toThrow()
      expect(performance.now() - start).toBeLessThanOrEqual(750)
    } finally {
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
  it('shutdown cancels an admitted operation before connect and never admits a late command', async () => {
    const p = await peer(() => undefined)
    const limiter = new LoginRateLimiterService({ get: () => p.url } as never)
    try {
      const pending = limiter.check('shutdown@example.test', '203.0.113.1').catch((error) => error)
      await limiter.onModuleDestroy()
      expect(await pending).toMatchObject({ status: 503 })
      await expect(limiter.check('shutdown@example.test', '203.0.113.1')).rejects.toMatchObject({
        status: 503,
      })
      expect(p.commands).toHaveLength(0)
      expect(p.sockets.size).toBe(0)
    } finally {
      await p.close()
    }
  })
  it('bounds timeout waves and recovers without a closing-client tail', async () => {
    let healthy = false
    const p = await peer((args, socket) => {
      if (args[0]?.toLowerCase() !== 'eval') socket.write('+OK\r\n')
      else if (healthy) socket.write('*2\r\n:1\r\n:0\r\n')
    })
    try {
      for (let wave = 0; wave < 2; wave++) {
        // Race scheduled timers rather than counting CI event-loop starvation as client work.
        // Exact 450/500 ms deadlines are covered by the controlled-clock lifecycle tests.
        const settled = await withinWatchdog(() => {
          const batch = Array.from({ length: 32 }, () => run(p.url))
          expect(() => LoginLimitConnection.acquire()).toThrow('capacity')
          return Promise.allSettled(batch)
        })
        expect(settled.every((r) => r.status === 'rejected')).toBe(true)
      }
      healthy = true
      await expect(run(p.url)).resolves.toEqual([1, 0])
      expect(p.commands.filter((c) => c[0]?.toLowerCase() === 'eval')).toHaveLength(65)
    } finally {
      await p.close()
    }
  })
})
