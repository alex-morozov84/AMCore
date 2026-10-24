import { spawn, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stringify } from 'yaml'

const name = 'amcore-registry-fixture'

async function tarball(directory) {
  await mkdir(join(directory, 'package'))
  await writeFile(
    join(directory, 'package/package.json'),
    JSON.stringify({
      name,
      version: '1.0.0',
      scripts: {
        install: `node -e "require('node:fs').writeFileSync(process.env.AMCORE_REGISTRY_HOOK,'installed')"`,
      },
    })
  )
  execFileSync('tar', ['-czf', join(directory, 'fixture.tgz'), '-C', directory, 'package'])
  return readFile(join(directory, 'fixture.tgz'))
}

function install(directory, registry, marker) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'pnpm',
      ['install', '--no-frozen-lockfile', `--registry=${registry}`, '--reporter=append-only'],
      {
        cwd: directory,
        timeout: 20000,
        env: { ...process.env, CI: 'true', AMCORE_REGISTRY_HOOK: marker },
      }
    )
    let text = ''
    for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => (text += chunk))
    child.on('error', reject)
    child.on('close', (code, signal) => resolve({ code, signal, text }))
  })
}

function registry(archive, mismatch, requests) {
  return createServer((request, response) => {
    requests.push(request.url)
    if (request.url === '/fixture.tgz') return response.end(archive)
    response.setHeader('Content-Type', 'application/json')
    const identity = mismatch ? 'amcore-other-registry-fixture' : name
    response.end(
      JSON.stringify({
        name: identity,
        'dist-tags': { latest: '1.0.0' },
        time: { '1.0.0': '2020-01-01T00:00:00.000Z' },
        versions: {
          '1.0.0': {
            name: identity,
            version: '1.0.0',
            scripts: { install: 'node -e "0"' },
            dist: {
              tarball: `http://127.0.0.1:${response.socket.localPort}/fixture.tgz`,
              integrity: `sha512-${createHash('sha512').update(archive).digest('base64')}`,
            },
          },
        },
      })
    )
  })
}

export async function createRegistryFixture({ packageManager, managerLock, policy, mismatch }) {
  const directory = await mkdtemp(join(tmpdir(), 'amcore-registry-name-'))
  let server
  try {
    const requests = []
    const marker = join(directory, 'hook-marker')
    server = registry(await tarball(directory), mismatch, requests)
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    await writeFile(
      join(directory, 'package.json'),
      JSON.stringify({ private: true, packageManager, dependencies: { [name]: '1.0.0' } })
    )
    await writeFile(
      join(directory, 'pnpm-workspace.yaml'),
      stringify({ packages: [], ...policy, allowBuilds: { [name]: true } })
    )
    // Keep the real pinned manager graph; the fixture registry serves only the test package.
    await writeFile(join(directory, 'pnpm-lock.yaml'), managerLock)
    return {
      directory,
      marker,
      requests,
      run: () => install(directory, `http://127.0.0.1:${server.address().port}`, marker),
      cleanup: async () => {
        server.closeAllConnections()
        await new Promise((resolve) => server.close(resolve))
        await rm(directory, { recursive: true, force: true })
      },
    }
  } catch (error) {
    server?.closeAllConnections()
    server?.close()
    await rm(directory, { recursive: true, force: true })
    throw error
  }
}
