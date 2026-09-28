import assert from 'node:assert/strict'
import { run, cleanEnvironment } from './process.mjs'
import { psqlArguments, localSql } from './local-sql.mjs'
import { withDockerEngine } from './docker.mjs'
import { directory } from './state.mjs'

export const adminSql = (m, query) =>
  withDockerEngine(m, (execute) => execute(psqlArguments(m), { capture: true, input: query }))
export const rawLocalSql = localSql
export function fixtureCommand(m, query, variables = {}, extra = {}) {
  return run(
    process.execPath,
    [
      `${m.worktree}/scripts/stand/exec.mjs`,
      'postgres',
      'psql',
      '-c',
      query,
      '--stand-variables',
      JSON.stringify(variables),
    ],
    {
      capture: true,
      env: cleanEnvironment({
        ...extra,
        AMCORE_STAND_MANIFEST: `${directory(m.id)}/manifest.json`,
        AMCORE_STAND_TOKEN: m.runToken,
      }),
    }
  )
}
export async function waitForQuery(m, filter) {
  for (let i = 0; i < 30; i++) {
    if (
      Number(
        (
          await adminSql(
            m,
            `SELECT count(*) FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND ${filter};`
          )
        ).trim()
      )
    )
      return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  assert.fail(`Owned DB query state did not appear: ${filter}`)
}
export async function refusedWrite(m, reason) {
  await assert.rejects(
    () => fixtureCommand(m, 'UPDATE public.admission_probe SET value = 99;'),
    reason
  )
  assert.equal((await adminSql(m, 'SELECT value FROM public.admission_probe;')).trim(), '1')
}

export function redisCommand(m, args, extra = {}) {
  return run(
    process.execPath,
    [`${m.worktree}/scripts/stand/exec.mjs`, 'redis', 'redis-cli', ...args],
    {
      capture: true,
      env: cleanEnvironment({
        ...extra,
        AMCORE_STAND_MANIFEST: `${directory(m.id)}/manifest.json`,
        AMCORE_STAND_TOKEN: m.runToken,
      }),
    }
  )
}
