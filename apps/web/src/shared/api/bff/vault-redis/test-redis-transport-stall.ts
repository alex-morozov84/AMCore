import { type AddressInfo, createConnection, createServer, type Socket } from 'node:net'

/**
 * Integration-test TCP fixture between the vault client and a real Redis. With replies held, the
 * server executes each command once but the client never sees the answer, which is the state
 * where node-redis has already dropped its own abort and timeout listeners. Application-level
 * fault model: streams are held, dropped or refused, not kernel packet loss.
 */
export async function redisTransportStall(host: string, port: number) {
  const sockets = new Set<Socket>()
  const replies: Array<{ socket: Socket; chunk: Buffer }> = []
  const commands: Array<{ socket: Socket; chunk: Buffer }> = []
  let holdReplies = false
  let holdCommands = false
  let refusing = false
  const server = createServer((downstream) => {
    if (refusing) {
      downstream.destroy()
      return
    }
    const upstream = createConnection({ host, port })
    sockets.add(downstream)
    sockets.add(upstream)
    downstream.on('data', (chunk: Buffer) => {
      if (holdCommands) commands.push({ socket: upstream, chunk })
      else upstream.write(chunk)
    })
    upstream.on('data', (chunk: Buffer) => {
      if (holdReplies) replies.push({ socket: downstream, chunk })
      else downstream.write(chunk)
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
    openSockets: (): number => sockets.size,
    holdReplies: (): void => {
      holdReplies = true
    },
    holdCommands: (): void => {
      holdCommands = true
    },
    release: (): void => {
      holdReplies = false
      holdCommands = false
      for (const pending of [...commands.splice(0), ...replies.splice(0)])
        pending.socket.write(pending.chunk)
    },
    refuseConnections: (refuse: boolean): void => {
      refusing = refuse
    },
    dropConnections: (): void => {
      replies.splice(0)
      commands.splice(0)
      for (const socket of sockets) socket.destroy()
    },
    close: async (): Promise<void> => {
      holdReplies = holdCommands = false
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}
