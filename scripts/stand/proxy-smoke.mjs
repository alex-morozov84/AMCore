import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { allocate } from './ports.mjs'
import { docker, inspect } from './docker.mjs'
import { labels } from './config.mjs'
import { save } from './state.mjs'
import { run } from './process.mjs'

async function assertProxy(m, port, label) {
  const origin = `https://${m.hostnames.console}:${port}`
  for (const [path, expected] of [
    ['/sw.js', 200],
    ['/icons/icon-192x192.png', 200],
    ['/logo-dark.png', 200],
    ['/', 404],
    ['/login', 200],
    [`/${m.consoleSlug}`, 404],
    ['/api/access', 401],
  ]) {
    const body = `${m.worktree}/.amcore/stands/${m.id}/smoke-${label}.html`
    const status = await run(
      'curl',
      [
        '--silent',
        '--show-error',
        '--insecure',
        '--noproxy',
        '*',
        '--resolve',
        `${m.hostnames.console}:${port}:127.0.0.1`,
        '--output',
        body,
        '--write-out',
        '%{http_code}',
        origin + path,
      ],
      { capture: true }
    )
    assert.equal(Number(status), expected, `${label}: ${path}`)
    if (path === '/login') assert.match(await readFile(body, 'utf8'), /Console sign in/)
    if (path === '/') assert.doesNotMatch(await readFile(body, 'utf8'), /nginx/i)
  }
}

export async function proxySmoke(m) {
  assert.equal(m.localePrefix, '', 'single-locale fixture required')
  await assertProxy(m, m.ports.tls, 'caddy')
  const config = `${m.snapshot}/docker/nginx/operations-console.conf`
  await writeFile(
    config,
    (await readFile(config, 'utf8')).replaceAll('console.example.com', m.hostnames.console)
  )
  const tls = `${m.snapshot}/docker/nginx/tls`
  await mkdir(tls, { recursive: true, mode: 0o700 })
  await run(
    'openssl',
    [
      'req',
      '-x509',
      '-nodes',
      '-newkey',
      'rsa:2048',
      '-days',
      '1',
      '-keyout',
      `${tls}/privkey.pem`,
      '-out',
      `${tls}/fullchain.pem`,
      '-subj',
      `/CN=${m.hostnames.console}`,
    ],
    { capture: true }
  )
  const port = (await allocate(`${m.uuid}-nginx`)).tls
  m.services.push('nginx')
  await save(m)
  const tags = {
    ...labels(m),
    'com.docker.compose.project': m.project,
    'com.docker.compose.service': 'nginx',
  }
  const id = (
    await docker(
      m,
      [
        'run',
        '-d',
        '--name',
        `${m.project}-nginx`,
        '--network',
        `${m.project}_default`,
        ...Object.entries(tags).flatMap(([key, value]) => ['--label', `${key}=${value}`]),
        '-p',
        `127.0.0.1:${port}:443`,
        '-v',
        `${config}:/etc/nginx/conf.d/default.conf:ro`,
        '-v',
        `${tls}:/etc/nginx/tls:ro`,
        'nginx:1.27-alpine',
      ],
      { capture: true }
    )
  ).trim()
  const container = await inspect(m, 'container', id)
  assert.equal(container.Config.Labels['org.amcore.stand'], m.uuid)
  await docker(m, ['exec', id, 'nginx', '-t'])
  await assertProxy(m, port, 'nginx')
  console.log('single-locale host proxy smoke: passed (Caddy and nginx)')
}
