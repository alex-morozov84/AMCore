import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execute = promisify(execFile)
export const label = 'io.amcore.migrator-lifecycle.run'

export function dockerClient(endpoint) {
  assert.ok(endpoint.startsWith('unix://'), 'Require a local Unix Docker engine')
  return async (args) => {
    try {
      const { stdout } = await execute('docker', ['--host', endpoint, ...args], {
        encoding: 'utf8',
        timeout: 10000,
        killSignal: 'SIGKILL',
        maxBuffer: 4 * 1024 * 1024,
      })
      return stdout
    } catch (error) {
      // execFile errors embed argv/stdout/stderr. Keep only a safe error code.
      throw Object.assign(new Error('Docker operation failed'), {
        code: error.killed ? 'DOCKER_TIMEOUT' : 'DOCKER_ERROR',
      })
    }
  }
}

export async function localEndpoint() {
  const { stdout: context } = await execute('docker', ['context', 'show'], { timeout: 10000 })
  const { stdout } = await execute('docker', ['context', 'inspect', context.trim()], {
    timeout: 10000,
  })
  return JSON.parse(stdout)[0].Endpoints.docker.Host
}

export async function owned(f, type, name) {
  const args = type === 'container' ? ['container', 'ls', '--all'] : ['network', 'ls']
  const rows = (await f.docker([...args, '--format', '{{json .}}']))
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(JSON.parse)
  if (!rows.some((row) => (type === 'container' ? row.Names : row.Name) === name)) return undefined
  const [resource] = JSON.parse(await f.docker([type, 'inspect', name]))
  assert.equal(
    type === 'container' ? resource.Config.Labels?.[label] : resource.Labels?.[label],
    f.run,
    'Refuse a foreign resource'
  )
  return resource
}

export async function admitImage(f, image) {
  const [artifact] = JSON.parse(await f.docker(['image', 'inspect', image]))
  assert.deepEqual(artifact.Config.Entrypoint, [
    '/usr/bin/tini',
    '-g',
    '--',
    'docker-entrypoint.sh',
  ])
  assert.deepEqual(artifact.Config.Cmd, ['./node_modules/.bin/prisma', 'migrate', 'deploy'])
  assert.equal(artifact.Config.User, 'node')
  const architecture = (await f.docker(['info', '--format', '{{.Architecture}}'])).trim()
  const native = { aarch64: 'arm64', x86_64: 'amd64', arm64: 'arm64', amd64: 'amd64' }[architecture]
  assert.equal(artifact.Architecture, native, 'Require native image architecture')
  return artifact
}

export async function internalNetwork(f) {
  await f.docker([
    'network',
    'create',
    '--driver',
    'bridge',
    '--internal',
    '--label',
    `${label}=${f.run}`,
    f.network,
  ])
  const network = await owned(f, 'network', f.network)
  assert.equal(network?.Internal, true, 'Fixture network must forbid external routing')
  assert.equal(network.Driver, 'bridge')
}

export async function isolatedContainer(f, name) {
  const container = await owned(f, 'container', name)
  assert.ok(container, 'Migrator container missing')
  assert.deepEqual(
    Object.keys(container.NetworkSettings.Networks),
    [f.network],
    'Migrator must join only the fixture network'
  )
  return container
}
