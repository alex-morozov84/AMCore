import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { readdirSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

export const root = fileURLToPath(new URL('../../', import.meta.url))
export const api = resolve(root, 'apps/api')
export const apiRequire = createRequire(resolve(api, 'package.json'))
export const jest = apiRequire.resolve('jest/bin/jest')
export function files(directory, suffix = '') {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = resolve(directory, entry.name)
      return entry.isDirectory() ? files(path, suffix) : path.endsWith(suffix) ? [path] : []
    })
    .sort()
}
export function inputHash() {
  const paths = [
    resolve(root, 'pnpm-lock.yaml'),
    resolve(root, 'package.json'),
    resolve(root, 'packages/shared/package.json'),
    resolve(root, 'packages/shared/tsconfig.json'),
    resolve(root, 'packages/shared/tsdown.config.ts'),
    resolve(api, 'prisma.config.ts'),
    resolve(api, 'tsconfig.json'),
    resolve(api, 'package.json'),
    resolve(api, 'jest-e2e.config.js'),
    resolve(api, 'jest-swc.config.cjs'),
    ...files(resolve(api, 'prisma')),
    ...files(resolve(root, 'packages/shared/src')),
  ]
  const hash = createHash('sha256')
  for (const path of paths) hash.update(path.slice(root.length)).update(readFileSync(path))
  return hash.digest('hex')
}

export function executionHash() {
  const hash = createHash('sha256').update(inputHash())
  const paths = [
    ...files(resolve(api, 'test')),
    ...files(resolve(api, 'src')),
    ...files(resolve(root, 'scripts/api-e2e')),
    resolve(root, 'scripts/api-e2e-ci.mjs'),
  ].filter((path) => !path.includes('/src/generated/'))
  for (const path of paths) hash.update(path.slice(root.length)).update(readFileSync(path))
  return hash.digest('hex')
}

export function outputHash() {
  const hash = createHash('sha256')
  for (const path of [
    ...files(resolve(api, 'src', 'generated', 'prisma')),
    ...files(resolve(root, 'packages/shared/dist')),
  ]) {
    hash.update(path.slice(root.length)).update(readFileSync(path))
  }
  return hash.digest('hex')
}
