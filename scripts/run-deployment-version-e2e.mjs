import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { buildFixture } from './deployment-version/build-fixture.mjs'
import { startProxy } from './deployment-version/proxy.mjs'
import { verifyRecovery } from './deployment-version/verify.mjs'

const root = process.cwd()
const { chromium } = createRequire(join(root, 'apps/web/package.json'))('@playwright/test')
const workspace = await mkdtemp(join(tmpdir(), 'amcore-version-e2e-'))
const port = Number(process.env.VERSION_E2E_PORT ?? 3420)
const children = []
const logs = []
let proxy, browser

async function start(artifact, targetPort) {
  const child = spawn(process.execPath, ['apps/web/server.js'], {
    cwd: artifact,
    env: {
      ...process.env,
      PORT: String(targetPort),
      HOSTNAME: '127.0.0.1',
      NODE_ENV: 'production',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  children.push(child)
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (data) => logs.push(String(data)))
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error(`Web exited: ${logs.join('')}`)
    try {
      if ((await fetch(`http://127.0.0.1:${targetPort}/api/deployment-version`)).ok) return
    } catch {
      /* Wait for startup. */
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('Web startup timeout')
}

try {
  const a = await buildFixture(root, workspace, 'A')
  const b = await buildFixture(root, workspace, 'B')
  await start(a, port + 1)
  await start(b, port + 2)
  proxy = startProxy(port)
  await proxy.ready
  browser = await chromium.launch({ headless: true })
  await verifyRecovery(browser, proxy.state, port)
  console.log(
    `Missing-action stacks: ${(logs.join('').match(/Failed to find Server Action/g) ?? []).length}`
  )
} finally {
  await browser?.close()
  proxy?.server.closeAllConnections()
  if (proxy) await new Promise((resolve) => proxy.server.close(resolve))
  await Promise.all(
    children.map(
      (child) =>
        new Promise((resolve) => {
          if (child.exitCode !== null) return resolve()
          child.once('exit', resolve)
          child.kill('SIGTERM')
        })
    )
  )
  await rm(workspace, { recursive: true, force: true })
}
