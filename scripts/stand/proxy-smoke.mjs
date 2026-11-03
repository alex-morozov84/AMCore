import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { composeArguments, docker, inspect } from './docker.mjs'
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
    if (path === '/login') {
      // The smoke runs with one served locale, so the page is in the build's default locale.
      const catalogue = JSON.parse(
        await readFile(`${m.worktree}/apps/web/messages/${m.baseLocale}.json`, 'utf8')
      )
      assert.ok((await readFile(body, 'utf8')).includes(catalogue.console.loginTitle))
    }
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
  // The web app compares the whole Host authority with its configured origin, port included, and
  // that origin names the stand's TLS port. nginx must therefore answer on that same port, so
  // Caddy (already checked above) is stopped and nginx takes its place.
  await docker(m, [...composeArguments(m), 'stop', 'caddy'])
  const port = m.ports.tls
  m.services.push('nginx')
  await save(m)
  // A Compose service, as in the product-administration nginx check: the stand's cleanup only
  // removes containers that carry Compose creation evidence and the stand's ownership labels.
  const overlay = `${m.snapshot}/docker/nginx/console-smoke-compose.json`
  await writeFile(
    overlay,
    JSON.stringify({
      services: {
        nginx: {
          image: 'nginx:1.27-alpine',
          labels: labels(m),
          ports: [`127.0.0.1:${port}:443`],
          volumes: [`${config}:/etc/nginx/conf.d/default.conf:ro`, `${tls}:/etc/nginx/tls:ro`],
        },
      },
    })
  )
  const command = [...composeArguments(m), '-f', overlay]
  await docker(m, [...command, 'up', '-d', '--no-deps', 'nginx'])
  const id = (await docker(m, [...command, 'ps', '-q', 'nginx'], { capture: true })).trim()
  const container = await inspect(m, 'container', id)
  assert.equal(container.Config.Labels['org.amcore.stand'], m.uuid)
  await docker(m, ['exec', id, 'nginx', '-t'])
  await assertProxy(m, port, 'nginx')
  console.log('single-locale host proxy smoke: passed (Caddy and nginx)')
}
