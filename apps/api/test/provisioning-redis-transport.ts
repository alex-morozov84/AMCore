import { connect, createServer, type Socket } from 'node:net'

import { createClient, type RedisClientType } from '@redis/client'

import { appClientOptions } from './test-redis'

interface ProvisioningRedisTransport {
  client: RedisClientType<{}, {}, {}, 2>
  reply: Promise<void>
  evalWrites: () => number
  hold: () => void
  release: () => void
  fail: () => void
  close: () => Promise<void>
}

/** Test-owned transparent transport. Handshake passes; only an armed reply is withheld. */
export async function provisioningRedisTransport(
  redisUrl: string
): Promise<ProvisioningRedisTransport> {
  const upstream = new URL(redisUrl)
  const sockets = new Set<Socket>()
  let downstream: Socket | undefined
  let hold = false
  let held: Buffer[] = []
  let replySeen!: () => void
  const reply = new Promise<void>((resolve) => {
    replySeen = resolve
  })
  let evalWrites = 0
  const server = createServer((socket) => {
    downstream = socket
    const redis = connect({ host: upstream.hostname, port: Number(upstream.port) })
    sockets.add(socket)
    sockets.add(redis)
    socket.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes('EVAL')) evalWrites++
      redis.write(chunk)
    })
    redis.on('data', (chunk: Buffer) => {
      if (hold) {
        held.push(chunk)
        replySeen()
      } else socket.write(chunk)
    })
    socket.on('error', () => redis.destroy())
    redis.on('error', () => socket.destroy())
    socket.on('close', () => {
      sockets.delete(socket)
      redis.destroy()
    })
    redis.on('close', () => sockets.delete(redis))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Test proxy did not bind')
  // The provisioning limiter receives this client, so it has the production options; only the
  // reconnect strategy is replaced, to fail fast when the fixture drops the connection.
  const client = createClient(
    appClientOptions(`redis://127.0.0.1:${address.port}`, { reconnectStrategy: false })
  )
  client.on('error', () => undefined)
  try {
    await client.connect()
  } catch (error) {
    for (const socket of sockets) socket.destroy()
    server.close()
    throw error
  }
  return {
    client,
    reply,
    evalWrites: () => evalWrites,
    hold: () => {
      hold = true
    },
    release: () => {
      hold = false
      for (const chunk of held) downstream!.write(chunk)
      held = []
    },
    fail: () => downstream!.destroy(),
    close: async () => {
      // Only this private test client is closed; the application's shared client is untouched.
      if (client.isOpen) client.destroy()
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )
    },
  }
}
