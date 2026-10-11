import { command } from './measurement-command.mjs'
import { cpus, totalmem, freemem, platform, release, arch } from 'node:os'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const [output] = process.argv.slice(2)
if (!output) throw new Error('Provide measurement output path')
const file = (path) => {
  try {
    return readFileSync(path, 'utf8').trim()
  } catch {
    return null
  }
}
const measurement = {
  observedAt: new Date().toISOString(),
  checkout: command('git', ['rev-parse', 'HEAD']),
  run: process.env.GITHUB_RUN_ID || null,
  attempt: process.env.GITHUB_RUN_ATTEMPT || null,
  image: process.env.ImageOS || null,
  imageVersion: process.env.ImageVersion || null,
  platform: platform(),
  release: release(),
  arch: arch(),
  cpus: cpus().length,
  totalMemory: totalmem(),
  freeMemory: freemem(),
  node: process.version,
  cachePolicy: process.env.API_E2E_CACHE_MODE || null,
  cacheHit: process.env.API_E2E_CACHE_HIT || null,
  pnpm: command('pnpm', ['--version']),
  testPackages: Object.fromEntries(
    ['jest', 'testcontainers', '@testcontainers/postgresql', '@testcontainers/redis'].map(
      (name) => {
        const source = file(`apps/api/node_modules/${name}/package.json`)
        return [name, source ? JSON.parse(source).version : null]
      }
    )
  ),
  disk: command('df', ['-Pk', '.']),
  docker: command('docker', ['version', '--format', '{{json .}}']),
  images: command('docker', [
    'image',
    'ls',
    '--no-trunc',
    '--format',
    '{{.Repository}}:{{.Tag}} {{.ID}}',
  ]),
  memoryPeak: file('/sys/fs/cgroup/memory.peak'),
  memoryEvents: file('/sys/fs/cgroup/memory.events'),
}
mkdirSync(dirname(output), { recursive: true })
writeFileSync(output, JSON.stringify(measurement, null, 2) + '\n')
