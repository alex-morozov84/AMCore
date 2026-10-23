import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { bounded, safeError } from '../migrator-lifecycle/safety.mjs'
import { closeAttached } from '../migrator-lifecycle/exit.mjs'

export async function command(f, name, args, expected = 0) {
  const child = spawn('docker', ['--host', f.endpoint, ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const client = { name, pid: child.pid, closed: false }
  let output = ''
  child.stdout.on('data', (bytes) => {
    if (output.length < 1024 * 1024) output += bytes.toString()
  })
  child.stderr.resume() // CLI errors can contain credentials from the disposable Compose file.
  const closed = new Promise((resolve) => {
    child.once('error', (error) => resolve({ error }))
    child.once('close', (code, signal) => {
      client.closed = true
      resolve({ code, signal })
    })
  })
  let result, failure
  try {
    f.clients.push(client)
    f.journal()
    result = await bounded(closed, 120000, 'APPLICATION_COMMAND_TIMEOUT')
    if (result.error)
      throw Object.assign(new Error('Docker spawn failed'), { code: 'SPAWN_FAILED' })
    assert.equal(result.signal, null)
    if (expected === 0) assert.equal(result.code, 0, 'Application command failed')
    else assert.ok(result.code > 0, 'Expected application command refusal')
  } catch (error) {
    failure = error
    console.error(
      JSON.stringify({
        run: f.run,
        phase: 'application-command',
        verdict: 'FAIL',
        error: safeError(error),
      })
    )
  }
  try {
    await closeAttached(
      { child, closed, cancellation: new globalThis.AbortController() },
      (error) =>
        console.error(
          JSON.stringify({
            run: f.run,
            phase: 'application-command-close',
            verdict: 'CLEANUP_ERROR',
            error: safeError(error),
          })
        )
    )
  } catch (error) {
    throw new AggregateError(
      [...(failure ? [failure] : []), error],
      'Application command/close failed'
    )
  }
  if (failure) throw failure
  return output
}

export async function probe(f, name, code, args = []) {
  return JSON.parse(
    await command(f, name, ['exec', name, 'node', '--input-type=module', '-e', code, ...args])
  )
}

export async function eventually(operation, description) {
  const deadline = performance.now() + 120000
  while (performance.now() < deadline) {
    if (await operation()) return
    await delay(200)
  }
  throw Object.assign(new Error(description), { code: 'APPLICATION_WAIT_TIMEOUT' })
}

export async function ready(f, name) {
  await eventually(async () => {
    const [c] = JSON.parse(await f.docker(['container', 'inspect', name]))
    assert.equal(c.State.Running, true, 'Application exited before readiness')
    return (
      (
        await probe(
          f,
          name,
          `let status=0;try{status=(await fetch('http://localhost:5002/api/v1/health/ready',{signal:AbortSignal.timeout(2000)})).status}catch{};console.log(JSON.stringify({status}))`
        )
      ).status === 200
    )
  }, 'Application did not become ready')
}
