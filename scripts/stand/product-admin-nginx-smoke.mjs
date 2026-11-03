import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

import { labels } from './config.mjs'
import { composeArguments, docker, inspect } from './docker.mjs'
import { owned } from './ownership.mjs'
import { allocate } from './ports.mjs'
import { checkProductAdminWire } from './product-admin-wire-checks.mjs'
import { run } from './process.mjs'
import { save } from './state.mjs'

/** Actual TLS nginx parsing/proxying, using the exact public Host while transport stays loopback. */
export async function productAdminNginxSmoke(m) {
  assert.equal(m.purpose, 'e2e')
  assert.equal(m.productAdminHost, true)
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
  await checkProductAdminWire(m, { edge: 'nginx', port, directory })
  console.log('Product admin nginx TLS wire smoke: passed')
}
