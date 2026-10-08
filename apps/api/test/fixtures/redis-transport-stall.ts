import { type AddressInfo, createConnection, createServer, type Socket } from 'node:net'

/** Suite-owned TCP fixture: node-redis must have written before its caller aborts. */
export async function redisTransportStall(
  host: string,
  port: number
): Promise<{
  port: number
  held: Promise<void>
  holdReplies: () => void
  holdCommands: () => void
  release: () => void
  close: () => Promise<void>
}> {
  const sockets = new Set<Socket>()
  const replies: Array<{ socket: Socket; chunk: Buffer }> = []
  const commands: Array<{ socket: Socket; chunk: Buffer }> = []
  let holdReplies = false
  let holdCommands = false
  let notifyHeld!: () => void
  const held = new Promise<void>((resolve) => {
    notifyHeld = resolve
  })
  const server = createServer((downstream) => {
    const upstream = createConnection({ host, port })
    sockets.add(downstream)
    sockets.add(upstream)
    downstream.on('data', (chunk) => {
      if (holdCommands) {
        commands.push({
          socket: upstream,
          chunk: Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk),
        })
        notifyHeld()
      } else upstream.write(chunk)
    })
    upstream.on('data', (chunk) => {
      if (holdReplies) {
        replies.push({
          socket: downstream,
          chunk: Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk),
        })
        notifyHeld()
      } else downstream.write(chunk)
    })
    upstream.on('error', () => downstream.destroy())
    downstream.on('error', () => upstream.destroy())
    downstream.on('close', () => {
      upstream.destroy()
      sockets.delete(downstream)
    })
    upstream.on('close', () => {
      downstream.destroy()
      sockets.delete(upstream)
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  return {
    port: (server.address() as AddressInfo).port,
    held,
    holdReplies: () => {
      holdReplies = true
    },
    holdCommands: () => {
      holdCommands = true
    },
    release: () => {
      holdReplies = false
      holdCommands = false
      for (const pending of [...commands.splice(0), ...replies.splice(0)])
        pending.socket.write(pending.chunk)
    },
    close: async () => {
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )
    },
  }
}
