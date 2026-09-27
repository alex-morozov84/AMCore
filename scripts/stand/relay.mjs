import { createServer, request } from 'node:http'
import { connect } from 'node:net'

export function relayTarget(origins, value) {
  const url = new URL(value)
  if (
    url.username ||
    url.password ||
    url.hash ||
    !['http:', 'https:'].includes(url.protocol) ||
    !origins.includes(url.origin)
  )
    throw new Error('Destination outside owned stand')
  return url
}
export async function relay(origins) {
  const sockets = new Set()
  const track = (socket) => {
    if (sockets.has(socket)) return socket
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
    return socket
  }
  const server = createServer((incoming, response) => {
    let target
    try {
      target = relayTarget(origins, incoming.url)
      if (incoming.headers.host !== target.host || target.protocol !== 'http:')
        throw new Error('Authority mismatch')
    } catch {
      response.writeHead(403).end()
      return
    }
    const upstream = request(
      {
        hostname: '127.0.0.1',
        port: target.port || 80,
        path: target.pathname + target.search,
        method: incoming.method,
        headers: incoming.headers,
      },
      (result) => {
        response.writeHead(result.statusCode, result.headers)
        result.pipe(response)
      }
    )
    upstream.on('socket', track)
    upstream.on('error', () => {
      if (!response.headersSent) response.writeHead(502)
      response.end()
    })
    incoming.pipe(upstream)
  })
  server.on('connection', track)
  server.on('connect', (req, client, head) => {
    let target
    try {
      const matches = origins.filter((origin) => new URL(origin).host === req.url)
      if (matches.length !== 1) throw new Error('CONNECT authority not owned')
      target = relayTarget(origins, matches[0])
      if (target.pathname !== '/' || target.search || req.headers.host !== target.host)
        throw new Error('Invalid CONNECT')
    } catch {
      client.end('HTTP/1.1 403 Forbidden\r\n\r\n')
      return
    }
    const upstream = track(
      connect(Number(target.port || (target.protocol === 'https:' ? 443 : 80)), '127.0.0.1')
    )
    upstream.once('connect', () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      if (head.length) upstream.write(head)
      client.pipe(upstream)
      upstream.pipe(client)
    })
    upstream.on('error', () => client.destroy())
    client.on('error', () => upstream.destroy())
    client.on('close', () => upstream.destroy())
    upstream.on('close', () => client.destroy())
  })
  server.on('upgrade', (req, client, head) => {
    let target
    try {
      target = relayTarget(origins, req.url.replace(/^ws:/, 'http:'))
      if (req.headers.host !== target.host) throw new Error('Invalid upgrade authority')
    } catch {
      client.destroy()
      return
    }
    const upstream = track(connect(Number(target.port || 80), '127.0.0.1'))
    upstream.once('connect', () => {
      upstream.write(
        `${req.method} ${target.pathname}${target.search} HTTP/1.1\r\n` +
          req.rawHeaders.reduce((s, v, i) => s + (i % 2 ? `${v}\r\n` : `${v}: `), '') +
          '\r\n'
      )
      if (head.length) upstream.write(head)
      client.pipe(upstream)
      upstream.pipe(client)
    })
    upstream.on('error', () => client.destroy())
    client.on('close', () => upstream.destroy())
    client.on('error', () => upstream.destroy())
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: async () => {
      const closed = new Promise((resolve) => server.close(resolve))
      const exits = [...sockets].map((s) => new Promise((resolve) => s.once('close', resolve)))
      for (const socket of sockets) socket.destroy()
      await Promise.all([closed, ...exits])
    },
  }
}
