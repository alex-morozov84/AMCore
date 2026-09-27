import { createServer } from 'node:net'
import { rm } from 'node:fs/promises'
import { targetProof } from './target-proof.mjs'

export async function supervise(m, token) {
  const proof = targetProof(m)
  const server = createServer({ allowHalfOpen: true }, (socket) => {
    socket.setTimeout(3000, () => socket.destroy())
    let value = ''
    socket.on('data', (data) => {
      value += data
      if (value.length > 100) socket.destroy()
    })
    socket.on('end', () => socket.end(value === token ? proof : 'denied'))
    socket.on('error', () => {})
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(m.controlSocket, resolve)
  })
  return async () => {
    await new Promise((resolve) => server.close(resolve))
    await rm(m.controlSocket, { force: true })
  }
}
