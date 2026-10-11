import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { api, root, jest, files, executionHash } from './paths.mjs'

const base = ['--experimental-vm-modules', jest, '--config', 'jest-e2e.config.js', '--runInBand']
export function effectiveConfig() {
  const config = JSON.parse(
    execFileSync(process.execPath, [...base, '--showConfig'], { cwd: api, encoding: 'utf8' })
  )
  const global = config.globalConfig
  if (
    !global.runInBand ||
    global.forceExit ||
    global.watch ||
    global.watchAll ||
    global.bail ||
    global.detectOpenHandles ||
    !config.configs.every(
      (item) => /jest-runner/.test(item.runner) && /jest-circus/.test(item.testRunner)
    )
  ) {
    throw new Error('Unsafe Jest process configuration')
  }
  return config
}
export function discover(shard) {
  const paths = JSON.parse(
    execFileSync(
      process.execPath,
      [...base, '--listTests', '--json', ...(shard ? [`--shard=${shard}`] : [])],
      { cwd: api, encoding: 'utf8' }
    )
  )
  return paths.map((path) => relative(api, path).replaceAll('\\', '/')).sort()
}
export function exactInventory(all, partitions) {
  const union = partitions.flat()
  if (
    !all.length ||
    partitions.some((part) => !part.length) ||
    new Set(union).size !== union.length ||
    JSON.stringify([...union].sort()) !== JSON.stringify([...all].sort())
  )
    throw new Error('Incomplete/duplicate API E2E inventory')
}
export function sourceContract() {
  for (const path of files(resolve(api, 'test'), '.ts')) {
    const source = readFileSync(path, 'utf8')
    if (
      /\bretryTimes\b|\b(?:fit|fdescribe|xit|xdescribe)\s*\(|\.\s*(?:only|skip|todo)\s*(?:\(|\.)|\[\s*['"](?:only|skip|todo)['"]\s*\]/.test(
        source
      )
    ) {
      throw new Error(`Focused/skipped/retried test declaration: ${relative(root, path)}`)
    }
    for (const match of source.matchAll(
      /new\s+(?:RedisContainer|PostgreSqlContainer|GenericContainer)\([^()]*\)([\s\S]*?)\.start\(/g
    )) {
      if (!match[1].includes('.withLabels(e2eContainerLabels())'))
        throw new Error(`Unowned container: ${relative(root, path)}`)
    }
  }
}
export function plan(count = 1) {
  effectiveConfig()
  sourceContract()
  const all = discover()
  const paths = files(resolve(api, 'test'), '.e2e-spec.ts')
    .map((path) => relative(api, path).replaceAll('\\', '/'))
    .sort()
  if (JSON.stringify(all) !== JSON.stringify(paths))
    throw new Error('Discovery differs from standard files')
  const shards = Array.from({ length: count }, (_, index) => ({
    id: `${index + 1}/${count}`,
    paths: discover(`${index + 1}/${count}`),
  }))
  exactInventory(
    all,
    shards.map((shard) => shard.paths)
  )
  return {
    schemaVersion: 1,
    inputs: executionHash(),
    sha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    run: process.env.GITHUB_RUN_ID || 'local',
    runAttempt: process.env.GITHUB_RUN_ATTEMPT || '1',
    all,
    shards,
  }
}
