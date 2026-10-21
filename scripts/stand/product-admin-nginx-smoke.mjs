import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

import { inspectProductAdminPlacement } from '../lib/product-admin-placement.mjs'

import { labels } from './config.mjs'
import { composeArguments, docker, inspect } from './docker.mjs'
import { owned } from './ownership.mjs'
import { allocate } from './ports.mjs'
import { run } from './process.mjs'
import { save } from './state.mjs'

/** Actual TLS nginx parsing/proxying, using the exact public Host while transport stays loopback. */
export async function productAdminNginxSmoke(m) {
  assert.equal(m.purpose, 'e2e')
  assert.equal(m.productAdminHost, true)
  const { alias } = inspectProductAdminPlacement(m.snapshot)
  const directory = `${m.snapshot}/docker/nginx/product-admin-smoke`
  await mkdir(directory, { recursive: true, mode: 0o700 })
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
      `${directory}/key.pem`,
      '-out',
      `${directory}/cert.pem`,
      '-subj',
      `/CN=${m.hostnames.staff}`,
    ],
    { capture: true }
  )
  const tls =
    'ssl_certificate /etc/nginx/test/cert.pem; ssl_certificate_key /etc/nginx/test/key.pem;'
  const site = await readFile(
    `${m.snapshot}/docker/nginx/product-admin-site.generated.conf`,
    'utf8'
  )
  const staff = await readFile(`${m.snapshot}/docker/nginx/product-admin.generated.conf`, 'utf8')
  const config = `${directory}/default.conf`
  await writeFile(
    config,
    `server { listen 443 ssl default_server; server_name _; ${tls} return 404; }
server { listen 443 ssl; server_name ${m.hostnames.product}; ${tls}\n${site}\n}
server { listen 443 ssl; server_name ${m.hostnames.staff}; ${tls}\n${staff}\n}\n`
  )
  const port = (await allocate(`${m.uuid}-staff-nginx`)).tls
  m.services.push('nginx')
  await save(m)
  const overlay = `${directory}/compose.json`
  await writeFile(
    overlay,
    JSON.stringify({
      services: {
        nginx: {
          image: 'nginx:1.27-alpine',
          labels: labels(m),
          ports: [`127.0.0.1:${port}:443`],
          volumes: [
            `${config}:/etc/nginx/conf.d/default.conf:ro`,
            `${directory}:/etc/nginx/test:ro`,
          ],
        },
      },
    })
  )
  const command = [...composeArguments(m), '-f', overlay]
  await docker(m, [...command, 'up', '-d', '--no-deps', 'nginx'])
  const id = (await docker(m, [...command, 'ps', '-q', 'nginx'], { capture: true })).trim()
  owned(m, await inspect(m, 'container', id), 'container')
  await docker(m, ['exec', id, 'nginx', '-t'])
  const prefix = m.localePrefix
  for (const [host, path, expected] of [
    [m.hostnames.staff, `${prefix}/login`, 200],
    [m.hostnames.staff, `${prefix}/${alias}/organizations`, 404],
    [m.hostnames.product, `${prefix}/${alias}/organizations`, 404],
    [m.hostnames.staff, `${prefix}/unknown-staff-page`, 404],
    [m.hostnames.staff, '/api/auth/login', 404],
    [m.hostnames.product, '/api/product-admin/auth/login', 404],
    [m.hostnames.staff, '/api/auth/me', 401],
    [m.hostnames.staff, '/favicon.ico', 200],
  ]) {
    const body = `${directory}/response.html`
    const status = await run(
      'curl',
      [
        '--silent',
        '--show-error',
        '--insecure',
        '--noproxy',
        '*',
        '--resolve',
        `${host}:${port}:127.0.0.1`,
        '--header',
        `Host: ${host}:${m.ports.tls}`,
        '--output',
        body,
        '--write-out',
        '%{http_code}',
        `https://${host}:${port}${path}`,
      ],
      { capture: true }
    )
    assert.equal(Number(status), expected, `nginx ${path}`)
    if (path === `${prefix}/login`) assert.match(await readFile(body, 'utf8'), /Sign in|Вход/)
  }
  console.log('Product admin nginx TLS wire smoke: passed')
}
