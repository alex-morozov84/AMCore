import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { clearTimeout, setTimeout } from 'node:timers'
import { setTimeout as delay } from 'node:timers/promises'
import { label } from './fixture.mjs'

export function launch(f, migration) {
  const name = `migrator-lifecycle-${f.run}-${migration.name}`
  f.containers.push(name)
  f.journal()
  const started = performance.now()
  const child = spawn(
    'docker',
    [
      '--host',
      f.endpoint,
      'run',
      '--pull=never',
      '--name',
      name,
      '--label',
      `${label}=${f.run}`,
      '--network',
      f.network.getName(),
      '--env',
      'DATABASE_URL',
      '--mount',
      `type=bind,src=${migration.directory},dst=/app/apps/api/prisma,readonly`,
      f.artifact.Id,
    ],
    { env: { ...process.env, DATABASE_URL: migration.url }, stdio: ['ignore', 'pipe', 'pipe'] }
  )
  // Do not retain CLI output that could contain a connection string.
  child.stdout.resume()
  child.stderr.resume()
  const attempt = { name, child, started }
  const exited = new Promise((resolve) => {
    child.once('error', (error) => {
      attempt.error = error
      resolve({ error, elapsed: performance.now() - started })
    })
    child.once('close', (code, signal) =>
      resolve({ code, signal, elapsed: performance.now() - started })
    )
  })
  return Object.assign(attempt, { exited })
}

export async function activeSql(f, database, attempt) {
  while (performance.now() - attempt.started < 30000) {
    if (attempt.error) throw attempt.error
    assert.equal(attempt.child.exitCode, null, 'The migrator exited before active SQL')
    const { rows } = await f.observer.query(
      "SELECT pid FROM pg_stat_activity WHERE datname=$1 AND state='active' AND query LIKE '%pg_sleep(60)%'",
      [database]
    )
    if (rows.length) return
    await delay(25)
  }
  throw new Error('The fixture did not observe active pg_sleep(60) before signalling')
}

export function owned(f, name) {
  const [container] = JSON.parse(f.docker(['container', 'inspect', name]))
  assert.equal(container.Config.Labels[label], f.run, 'Refuse a foreign container')
  assert.ok(container.NetworkSettings.Networks[f.network.getName()], 'Unexpected container network')
  return container
}

export async function naturalExit(attempt) {
  const remaining = 45000 - (performance.now() - attempt.started)
  assert.ok(remaining > 0, 'The original 45-second deadline expired')
  let timer
  try {
    const exit = await Promise.race([
      attempt.exited,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('No natural exit within 45 seconds of attach/start')),
          remaining
        )
      }),
    ])
    if (exit.error) throw exit.error
    return exit
  } finally {
    clearTimeout(timer)
  }
}

export async function remove(f, attempt) {
  const container = owned(f, attempt.name)
  // This is diagnostic disposal after verdict, never successful cancellation.
  if (container.State.Running) f.docker(['container', 'kill', '--signal', 'KILL', container.Id])
  f.docker(['container', 'rm', container.Id])
  if (attempt.child.exitCode === null) await attempt.exited
}
