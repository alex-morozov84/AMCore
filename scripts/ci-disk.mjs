import {
  lstatSync,
  realpathSync,
  statfsSync,
  readFileSync,
  mkdirSync,
  appendFileSync,
} from 'node:fs'
import { execFileSync, spawn } from 'node:child_process'
import { dirname } from 'node:path'
import { pathToFileURL } from 'node:url'

export const cleanupPaths = ['/usr/local/lib/android', '/usr/share/dotnet']
export function hostedLinux(env = process.env, platform = process.platform) {
  return (
    env.GITHUB_ACTIONS === 'true' &&
    env.CI_RUNNER_ENVIRONMENT === 'github-hosted' &&
    env.RUNNER_OS === 'Linux' &&
    platform === 'linux'
  )
}

export function reserve(stats) {
  return { bytes: stats.bavail * stats.bsize, inodes: stats.ffree, totalInodes: stats.files }
}
export function sufficient(stats) {
  return (
    stats.bytes >= 2 * 1024 ** 3 &&
    stats.totalInodes > 0 &&
    stats.inodes / stats.totalInodes >= 0.05
  )
}

export function removable(path, mounts, stat = lstatSync, realpath = realpathSync) {
  if (!cleanupPaths.includes(path)) return false
  const entry = stat(path)
  return (
    entry.isDirectory() &&
    !entry.isSymbolicLink() &&
    entry.uid === 0 &&
    realpath(path) === path &&
    entry.dev === stat(dirname(path)).dev &&
    !mounts.split('\n').some((line) => {
      const mount = line.split(' ')[4]
      return mount === path || mount?.startsWith(`${path}/`)
    })
  )
}

function sample(phase, paths) {
  const filesystems = paths.map((path) => ({ path, ...reserve(statfsSync(path)) }))
  const row = { phase, at: Date.now(), filesystems }
  mkdirSync('.amcore/ci-resources', { recursive: true })
  appendFileSync('.amcore/ci-resources/disk.jsonl', JSON.stringify(row) + '\n')
  console.log(`CI disk ${phase}: ${JSON.stringify(filesystems)}`)
  return filesystems.every(sufficient)
}

function cleanup() {
  const mounts = readFileSync('/proc/self/mountinfo', 'utf8')
  for (const path of cleanupPaths) {
    try {
      if (!removable(path, mounts)) throw new Error('Unsafe hosted SDK path; cleanup refused')
      console.log(execFileSync('du', ['-sk', path], { encoding: 'utf8', timeout: 30_000 }).trim())
      execFileSync('sudo', ['-n', 'rm', '-rf', '--', path], { stdio: 'inherit', timeout: 60_000 })
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      console.log(`CI disk: optional SDK absent: ${path}`)
    }
  }
}

export async function monitor(args, paths, probe = sample) {
  if (!probe('before-command', paths))
    throw new Error('Insufficient CI disk reserve before command')
  const child = spawn(args[0], args.slice(1), { stdio: 'inherit' })
  let breached = false
  const forward = (signal) => child.kill(signal)
  const term = () => forward('SIGTERM'),
    interrupt = () => forward('SIGINT')
  process.on('SIGTERM', term)
  process.on('SIGINT', interrupt)
  const interval = setInterval(() => {
    try {
      if (!probe('running', paths)) {
        if (!breached) child.kill('SIGTERM')
        breached = true
      }
    } catch {
      breached = true
      child.kill('SIGTERM')
    }
  }, 2000)
  try {
    const code = await new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('close', (code) => resolve(code ?? 1))
    })
    try {
      if (!probe('after-command', paths)) breached = true
    } catch {
      breached = true
    }
    if (breached) console.error('CI disk reserve breached; command stopped, inspect disk.jsonl')
    process.exitCode = code || (breached ? 1 : 0)
  } finally {
    clearInterval(interval)
    process.off('SIGTERM', term)
    process.off('SIGINT', interrupt)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (!hostedLinux()) throw new Error('Disk preparation requires ephemeral GitHub-hosted Linux')
    const dockerRoot = execFileSync('docker', ['info', '--format', '{{.DockerRootDir}}'], {
      encoding: 'utf8',
      timeout: 5000,
    }).trim()
    const paths = [...new Set([process.cwd(), dockerRoot])]
    sample('start', paths)
    if (process.argv[2] === '--clean') {
      cleanup()
      sample('after-cleanup', paths)
    } else if (process.argv[2] === '--' && process.argv[3])
      await monitor(process.argv.slice(3), paths)
    else throw new Error('Use --clean or -- COMMAND')
  } catch {
    console.error(
      'CI disk preparation/measurement failed; no resource admission. Inspect the preceding phase.'
    )
    process.exitCode = 1
  }
}
