import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

export function activeTarget() {
  const m = JSON.parse(
    execFileSync(process.execPath, [join(sourceRoot(), 'scripts/stand/active.mjs')], {
      encoding: 'utf8',
      env: verifierEnvironment({
        AMCORE_STAND_MANIFEST: process.env.AMCORE_STAND_MANIFEST,
        AMCORE_STAND_TOKEN: process.env.AMCORE_STAND_TOKEN,
      }),
    })
  )
  if (m.purpose !== 'e2e' || !m.relay || !m.runToken) throw new Error('Not an admitted e2e stand')
  return m
}
export function testOptions() {
  const m = activeTarget()
  return {
    baseURL: m.lane === 'console-real-stack' ? m.origins.console : m.origins.product,
    proxy: { server: m.relay },
    launchOptions: { proxy: { server: m.relay }, args: ['--proxy-bypass-list=<-loopback>'] },
    ignoreHTTPSErrors: m.topology === 'host',
  }
}
export function outputPaths() {
  const m = activeTarget()
  const dir = `${m.worktree}/.amcore/stands/${m.id}`
  return {
    outputDir: `${dir}/test-results`,
    reporter: [['list'], ['html', { open: 'never', outputFolder: `${dir}/report` }]],
  }
}
export function guardedExec(service, ...args) {
  const m = activeTarget()
  const lease = JSON.parse(
    readFileSync(`${m.worktree}/.amcore/stands/${m.id}/lease/owner.json`, 'utf8')
  )
  if (lease.token !== m.runToken) throw new Error('Run lease lost')
  return execFileSync(
    process.execPath,
    [join(sourceRoot(), 'scripts/stand/exec.mjs'), service, ...args],
    {
      encoding: 'utf8',
      env: verifierEnvironment({
        AMCORE_STAND_MANIFEST: process.env.AMCORE_STAND_MANIFEST,
        AMCORE_STAND_TOKEN: process.env.AMCORE_STAND_TOKEN,
      }),
    }
  )
}

function sourceRoot() {
  const cwd = process.cwd()
  return cwd.endsWith('/apps/web') ? resolve(cwd, '../..') : cwd
}

function verifierEnvironment(extra) {
  // Bootstrap only the common verifier; Docker/process children apply its
  // centralized environment policy after authenticating the active lease.
  return { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, ...extra }
}

export function guardedSql(query, variables = {}) {
  return guardedExec(
    'postgres',
    'psql',
    '-c',
    query,
    '--stand-variables',
    JSON.stringify(variables)
  )
}
