import { cleanup } from './cleanup.mjs'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { root } from '../migrator-operations/context.mjs'
import { journal } from './context.mjs'
import { label, dockerClient } from '../migrator-lifecycle/docker.mjs'
import { bounded, safeError } from '../migrator-lifecycle/safety.mjs'

const emit = (event) => console.log(JSON.stringify(event))
export async function stopHarness(image, signal) {
  const path = journal(signal.toLowerCase())
  assert.equal(existsSync(path), false, 'Recover the previous control journal before starting')
  const child = spawn('node', [`${root}/scripts/verify-migrator-lifecycle.mjs`, image], {
    cwd: root,
    env: { ...process.env, AMCORE_MIGRATOR_LIFECYCLE_JOURNAL: path },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const events = []
  let buffer = '',
    sent = false,
    run,
    parseError
  const closed = new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code, term) => resolve({ code, signal: term }))
  })
  child.stderr.resume()
  child.stdout.on('data', (d) => {
    buffer += d.toString()
    let newline
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline)
      buffer = buffer.slice(newline + 1)
      if (!line.startsWith('{')) continue
      let event
      try {
        event = JSON.parse(line)
      } catch (error) {
        parseError = error
        child.kill('SIGTERM')
        continue
      }
      events.push(event)
      run = event.run
      if (event.verdict === 'OBSERVED_SLEEP' && !sent) {
        sent = true
        emit({
          run,
          check: 'interrupt-harness',
          signal,
          verdict: 'CONTROL_SIGNAL',
          active: event.active,
        })
        child.kill(signal)
      }
    }
  })
  try {
    const status = await bounded(closed, 70000, 'CONTROL_STOP_TIMEOUT')
    if (parseError) throw parseError
    assert.equal(sent, true, 'No active SQL before harness stop')
    assert.ok(status.code !== 0 || status.signal !== null, 'Interrupted harness returned success')
    assert.equal(
      events.some((e) => e.verdict === 'PASS'),
      false,
      'Interrupted attempt must not PASS'
    )
    if (signal === 'SIGKILL') {
      assert.equal(existsSync(path), true, 'Killed harness lost recovery journal')
      const state = JSON.parse(readFileSync(path, 'utf8'))
      const docker = dockerClient(state.endpoint)
      const before = (
        await docker([
          'container',
          'ls',
          '--all',
          '--filter',
          `label=${label}=${run}`,
          '--format',
          '{{.Names}}',
        ])
      )
        .trim()
        .split('\n')
        .filter(Boolean)
      assert.ok(before.length > 0, 'No retained run resources before independent recovery')
      await cleanup(path)
      assert.equal(
        (
          await docker([
            'container',
            'ls',
            '--all',
            '--filter',
            `label=${label}=${run}`,
            '--format',
            '{{.ID}}',
          ])
        ).trim(),
        ''
      )
      assert.equal(
        (
          await docker([
            'network',
            'ls',
            '--filter',
            `label=${label}=${run}`,
            '--format',
            '{{.ID}}',
          ])
        ).trim(),
        ''
      )
      emit({
        run,
        check: 'sigkill-independent-recovery',
        verdict: 'PASS',
        status,
        retainedBeforeRecovery: before.length,
      })
    } else {
      assert.ok(
        events.some((e) => e.verdict === 'ERROR'),
        'No persisted interruption error'
      )
      assert.equal(existsSync(path), false, 'Graceful interrupted cleanup incomplete')
      emit({
        run,
        check: 'harness-interruption',
        verdict: 'PASS',
        control: signal,
        status,
        originalInterruptionPreserved: true,
      })
    }
  } catch (error) {
    emit({ run, verdict: 'ERROR', error: safeError(error) })
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL')
      await bounded(closed, 10000, 'CONTROL_CLOSE_TIMEOUT')
    }
    throw error
  } finally {
    if (existsSync(path)) await cleanup(path)
  }
}
