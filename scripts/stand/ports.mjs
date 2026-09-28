import { createServer } from 'node:net'
import { createHash } from 'node:crypto'

export async function available(port) {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', (error) => {
      if (error.code === 'EADDRINUSE') resolve(false)
      else reject(error)
    })
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)))
  })
}
export async function allocate(identity) {
  const first = createHash('sha256').update(identity).digest().readUInt32BE(0) % 24000
  for (let attempt = 0; attempt < 100; attempt++) {
    const base = 20000 + ((first + attempt * 7) % 24000)
    const ports = { web: base, api: base + 1, redis: base + 2, tls: base + 3 }
    if ((await Promise.all(Object.values(ports).map(available))).every(Boolean)) return ports
  }
  throw new Error('No available loopback port set after 100 candidates')
}
