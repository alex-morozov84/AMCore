import http from 'node:http'

export function startProxy(port) {
  const state = { target: port + 1, mode: 'normal', records: [] }
  const server = http.createServer((req, res) => {
    if (req.url === '/api/deployment-version' && !['normal', 'old-html'].includes(state.mode)) {
      if (state.mode === 'hang') {
        req.on('close', () => res.destroy())
        return
      }
      res.writeHead(state.mode === 'fail' ? 503 : 200, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      })
      const version =
        state.mode === 'stale'
          ? 'version-test-A'
          : state.mode === 'alternate'
            ? `version-test-${state.target === port + 1 ? 'B' : 'A'}`
            : '<invalid>'
      res.end(JSON.stringify({ version }))
      state.records.push({ method: 'GET', path: req.url, status: res.statusCode })
      return
    }
    const target =
      state.mode === 'old-html' && req.headers.accept?.includes('text/html')
        ? port + 1
        : state.target
    const upstream = http.request(
      {
        host: '127.0.0.1',
        port: target,
        method: req.method,
        path: req.url,
        headers: { ...req.headers, host: `127.0.0.1:${port}` },
      },
      (response) => {
        state.records.push({
          method: req.method,
          path: req.url.split('?')[0],
          status: response.statusCode,
          id: req.headers['x-deployment-id'],
        })
        res.writeHead(response.statusCode, response.headers)
        response.pipe(res)
      }
    )
    upstream.on('error', () => {
      res.writeHead(502)
      res.end()
    })
    req.pipe(upstream)
  })
  return {
    state,
    server,
    ready: new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, '127.0.0.1', resolve)
    }),
  }
}
