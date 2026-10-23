import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { journal } from './context.mjs'
import { resources, dispose, removeContainer } from '../migrator-lifecycle/resources.mjs'
import { fixture, migration } from '../migrator-lifecycle/fixture.mjs'
import { activeSql, observeDatabase } from '../migrator-lifecycle/process.mjs'
import { watchExit, naturalExit, closeAttached } from '../migrator-lifecycle/exit.mjs'
import { owned, label } from '../migrator-lifecycle/docker.mjs'
import { safeError } from '../migrator-lifecycle/safety.mjs'

const emit = (e) => console.log(JSON.stringify(e))
export async function negative(image, variant) {
  const f = await resources(journal())
  let attempt,
    verdict = false
  try {
    await fixture(f, image)
    const test = await migration(f, 'statement_term', false)
    if (variant === 'no-guc') {
      const file = `${test.directory}/migrations/20260101000000_wait/migration.sql`
      const sql = await readFile(file, 'utf8')
      await writeFile(file, sql.replace("<> '50ms'", "<> '0'")) // Negative fixture only, never positive admission.
    }
    const name = `migrator-lifecycle-${f.run}-statement_term`
    f.containers.push(name)
    f.journal()
    const args = [
      '--host',
      f.endpoint,
      'run',
      '--pull=never',
      '--name',
      name,
      '--label',
      `${label}=${f.run}`,
      '--network',
      f.network,
      '--env',
      'DATABASE_URL',
      '--mount',
      `type=bind,src=${test.directory},dst=/app/apps/api/prisma,readonly`,
    ]
    if (variant === 'no-tini') args.push('--entrypoint', 'docker-entrypoint.sh')
    args.push(image, './node_modules/.bin/prisma', 'migrate', 'deploy')
    if (variant === 'no-guc') args.push('--config', './prisma.base.config.ts')
    const started = performance.now(),
      child = spawn('docker', args, {
        env: { ...process.env, DATABASE_URL: test.url },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    child.stdout.resume()
    child.stderr.resume()
    attempt = Object.assign(
      watchExit(child, started, () => observeDatabase(f.observer, test.name)),
      { name }
    )
    const client = { name, pid: child.pid, closed: false }
    f.clients.push(client)
    f.journal()
    void attempt.closed.then(() => {
      client.closed = true
    })
    const active = await activeSql(f, test.name, attempt),
      container = await owned(f, 'container', name)
    const processes = (await f.docker(['top', name, '-eo', 'pid,ppid,comm']))
      .trim()
      .split('\n')
      .slice(1)
    const sent = f.docker(['container', 'kill', '--signal', 'TERM', container.Id]).then(
      () => ({}),
      (error) => ({ error })
    )
    if (variant === 'no-tini') {
      await assert.rejects(naturalExit(attempt), (e) => e.code === 'EXIT_TIMEOUT')
      assert.equal((await owned(f, 'container', name)).State.Running, true)
      emit({
        run: f.run,
        variant,
        verdict: 'EXPECTED_RED',
        reason: 'no-natural-exit-before-original-45s',
        active,
        processes,
      })
    } else {
      const exit = await naturalExit(attempt),
        observed = await attempt.observed
      if (observed.error) throw observed.error
      assert.ok(exit.code > 0 && exit.elapsed < 45000)
      assert.ok(
        observed.result.sessions > 0 || observed.result.locks > 0,
        'Missing GUC unexpectedly met cleanup admission'
      )
      emit({
        run: f.run,
        variant,
        verdict: 'EXPECTED_RED',
        reason: 'sessions-or-locks-survive-original-200ms',
        active,
        exit,
        observed,
        processes,
      })
    }
    const signal = await sent
    if (signal.error) throw signal.error
    verdict = true
  } catch (error) {
    emit({ run: f.run, variant, verdict: 'ERROR', error: safeError(error) })
    process.exitCode = 1
  } finally {
    if (attempt) {
      if (!verdict)
        emit({ run: f.run, variant, verdict: 'ERROR', phase: 'before-diagnostic-cleanup' })
      attempt.cancellation.abort()
      try {
        await removeContainer(f, attempt.name)
        await closeAttached(attempt, (error) =>
          emit({ run: f.run, variant, verdict: 'CLEANUP_ERROR', error: safeError(error) })
        )
      } catch (error) {
        emit({ run: f.run, variant, verdict: 'CLEANUP_ERROR', error: safeError(error) })
        process.exitCode = 1
      }
    }
    await dispose(f)
  }
}
