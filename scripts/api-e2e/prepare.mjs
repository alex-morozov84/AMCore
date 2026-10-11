import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { api, root, apiRequire, inputHash, outputHash } from './paths.mjs'

const receipt = resolve(root, '.amcore/api-e2e-prepared.json')
const advice = 'Run pnpm install --frozen-lockfile, then node scripts/api-e2e-ci.mjs --prepare'
export function prepare() {
  execFileSync('pnpm', ['--filter', 'api', 'db:generate'], { cwd: root, stdio: 'inherit' })
  execFileSync('pnpm', ['--filter', '@amcore/shared', 'build'], { cwd: root, stdio: 'inherit' })
  mkdirSync(resolve(root, '.amcore'), { recursive: true })
  writeFileSync(receipt, JSON.stringify({ hash: inputHash(), outputs: outputHash() }))
}
export function preflight() {
  if (process.versions.node.split('.')[0] !== '24')
    throw new Error('API E2E supervision requires verified Node24')
  if (/max-old-space|forceExit|require|import/.test(process.env.NODE_OPTIONS || '')) {
    throw new Error('Incompatible inherited NODE_OPTIONS')
  }
  const packageManager = JSON.parse(readFileSync(resolve(root, 'package.json'))).packageManager
  const pnpm = execFileSync('pnpm', ['--version'], { cwd: root, encoding: 'utf8' }).trim()
  if (packageManager !== `pnpm@${pnpm}`) throw new Error('Use declared pnpm version')
  if (
    !readFileSync(resolve(root, 'pnpm-lock.yaml')).equals(
      readFileSync(resolve(root, 'node_modules/.pnpm/lock.yaml'))
    )
  )
    throw new Error(advice)
  apiRequire.resolve('express') // direct API dependency, without relying on the Jest shim
  if (
    !existsSync(resolve(api, 'src/generated/prisma/client.ts')) ||
    !existsSync(resolve(root, 'packages/shared/dist/index.js')) ||
    !existsSync(receipt) ||
    JSON.parse(readFileSync(receipt)).hash !== inputHash() ||
    JSON.parse(readFileSync(receipt)).outputs !== outputHash()
  )
    throw new Error(advice)
}
