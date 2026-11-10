import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, realpathSync, statSync, statfsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { capacityDecision } from './policy.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const receipt = JSON.parse(readFileSync(new URL('./known-readiness.json', import.meta.url)))

export function knownReadiness(directory = root) {
  return receipt.every(
    ({ path, sha256 }) =>
      createHash('sha256')
        .update(readFileSync(resolve(directory, path)))
        .digest('hex') === sha256
  )
}

function docker(args) {
  return execFileSync('docker', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

export function probe(
  lane,
  env = process.env,
  io = {
    release: () => readFileSync('/etc/os-release', 'utf8'),
    readiness: knownReadiness,
    storage: storageDecision,
  }
) {
  if (!['path-standard', 'path-disruptive'].includes(lane))
    return { skip: false, reason: 'ineligible-lane' }
  if (
    env.RUNNER_ENVIRONMENT !== 'github-hosted' ||
    env.RUNNER_OS !== 'Linux' ||
    env.RUNNER_ARCH !== 'X64'
  )
    return { skip: false, reason: 'unknown-runner' }
  if (
    [
      'DOCKER_HOST',
      'DOCKER_CONTEXT',
      'DOCKER_CONFIG',
      'DOCKER_TLS_VERIFY',
      'HEALTH_DISK_THRESHOLD_PERCENT',
    ].some((key) => env[key] !== undefined)
  )
    return { skip: false, reason: 'override' }
  const release = io.release()
  if (!/^ID=ubuntu$/m.test(release) || !/^VERSION_ID="24\.04"$/m.test(release))
    return { skip: false, reason: 'unknown-os' }
  if (!io.readiness()) return { skip: false, reason: 'readiness-source-changed' }
  return io.storage(env)
}

export function storageDecision(
  env,
  io = {
    docker,
    realpath: realpathSync,
    stat: (path) => statSync(path, { bigint: true }),
    statfs: (path) => statfsSync(path, { bigint: true }),
  }
) {
  const context = JSON.parse(io.docker(['context', 'inspect']))
  if (context.length !== 1 || context[0].Endpoints?.docker?.Host !== 'unix:///var/run/docker.sock')
    return { skip: false, reason: 'nonlocal-engine' }
  const info = JSON.parse(io.docker(['info', '--format', '{{json .}}']))
  if (info.OSType !== 'linux' || info.Driver !== 'overlay2' || !info.DockerRootDir)
    return { skip: false, reason: 'unsupported-storage' }
  if (!env.GITHUB_WORKSPACE || !env.RUNNER_TEMP) return { skip: false, reason: 'missing-path' }
  const paths = [env.GITHUB_WORKSPACE, env.RUNNER_TEMP, info.DockerRootDir, '/'].map((path) =>
    io.realpath(path)
  )
  const devices = paths.map((path) => io.stat(path).dev.toString())
  if (new Set(devices).size !== 1) return { skip: false, reason: 'different-filesystems' }
  const stats = io.statfs(paths[2])
  const decision = capacityDecision({
    bytes: stats.blocks * stats.bsize,
    freeBytes: stats.bavail * stats.bsize,
    inodes: stats.files,
    freeInodes: stats.ffree,
  })
  return { ...decision, filesystem: devices[0], storage: info.Driver, readinessSource: 'matched' }
}
