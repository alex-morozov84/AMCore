import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import {
  readFileSync,
  writeFileSync,
  existsSync,
  unlinkSync,
  mkdirSync,
  renameSync,
  rmSync,
} from 'node:fs'
import { join, isAbsolute } from 'node:path'
import { randomUUID } from 'node:crypto'
import { clientsStopped } from '../migrator-lifecycle/resources.mjs'
import { localEndpoint } from '../migrator-lifecycle/docker.mjs'
import { bounded, safeError } from '../migrator-lifecycle/safety.mjs'
import { closeAttached } from '../migrator-lifecycle/exit.mjs'
export const label = 'io.amcore.migrator-preparation.run'
export function save(f) {
  const path = join(f.output, 'resources.json')
  writeFileSync(`${path}.tmp`, JSON.stringify(f, null, 2) + '\n', {
    mode: 0o600,
  })
  renameSync(`${path}.tmp`, path)
}
export function docker(f, args) {
  return execFileSync('docker', ['--host', f.endpoint, ...args], {
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 2 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}
export async function resources(output) {
  assert.ok(isAbsolute(output), 'Use a new absolute output directory outside the checkout')
  assert.equal(
    existsSync(output),
    false,
    'Output directory must be new; recover an earlier run separately'
  )
  mkdirSync(output, { mode: 0o700 })
  const f = {
    version: 1,
    output,
    run: randomUUID(),
    endpoint: await localEndpoint(),
    builders: [],
    images: [],
    containers: [],
    volumes: [],
    clients: [],
  }
  assert.ok(f.endpoint.startsWith('unix://'))
  save(f)
  return f
}
export async function command(f, args) {
  console.log(JSON.stringify({ run: f.run, phase: args[0], operation: args.slice(0, 3) }))
  const child = spawn('docker', ['--host', f.endpoint, ...args], { stdio: 'inherit' })
  const client = { pid: child.pid, closed: false }
  const closed = new Promise((resolve) => {
    child.once('error', (error) => resolve({ error }))
    child.once('close', (code, signal) => {
      client.closed = true
      resolve({ code, signal })
    })
  })
  let failure
  try {
    f.clients.push(client)
    save(f)
    const result = await bounded(closed, 900000, 'PREPARATION_TIMEOUT')
    if (result.error) throw result.error
    assert.equal(result.signal, null)
    assert.equal(result.code, 0, 'Preparation command failed')
  } catch (error) {
    failure = error
  }
  try {
    await closeAttached(
      { child, closed, cancellation: new globalThis.AbortController() },
      (error) =>
        console.error(
          JSON.stringify({ run: f.run, verdict: 'CLEANUP_ERROR', error: safeError(error) })
        )
    )
  } catch (error) {
    throw new AggregateError([...(failure ? [failure] : []), error], 'Command/close failed')
  }
  save(f)
  if (failure) throw failure
}
export function load(output) {
  const f = JSON.parse(readFileSync(join(output, 'resources.json'), 'utf8'))
  assert.equal(f.version, 1)
  assert.equal(f.output, output)
  assert.match(f.run, /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/)
  assert.ok(f.endpoint.startsWith('unix://'))
  for (const name of [...f.builders, ...f.images, ...f.containers])
    assert.ok(name.startsWith(`amcore-migrator-prep-${f.run}-`), 'Refuse foreign resource name')
  return f
}
export async function recover(output) {
  if (existsSync(join(output, 'resources.json'))) await cleanup(load(output))
  else
    assert.equal(
      existsSync(join(output, 'resources.json.tmp')),
      false,
      'Uncommitted preparation journal; preserve the output directory for inspection'
    )
}
export async function cleanup(f) {
  const failures = []
  for (const name of f.containers) {
    try {
      if (
        !docker(f, [
          'container',
          'ls',
          '--all',
          '--filter',
          `name=^/${name}$`,
          '--format',
          '{{.ID}}',
        ]).trim()
      )
        continue
      const [c] = JSON.parse(docker(f, ['container', 'inspect', name]))
      assert.equal(c.Config.Labels[label], f.run)
      docker(f, ['container', 'rm', '--force', '--volumes', name])
      assert.equal(
        docker(f, [
          'container',
          'ls',
          '--all',
          '--filter',
          `name=^/${name}$`,
          '--format',
          '{{.ID}}',
        ]).trim(),
        ''
      )
    } catch (e) {
      failures.push(e)
    }
  }
  for (const name of f.builders) {
    try {
      const names = docker(f, ['buildx', 'ls', '--format', '{{.Name}}']).trim().split('\n')
      if (!names.includes(name)) continue
      const container = `buildx_buildkit_${name}0`
      if (
        docker(f, [
          'container',
          'ls',
          '--all',
          '--filter',
          `name=^/${container}$`,
          '--format',
          '{{.ID}}',
        ]).trim()
      ) {
        const [c] = JSON.parse(docker(f, ['container', 'inspect', container]))
        assert.ok(
          c.Config.Env.includes(`AMCORE_MIGRATOR_PREPARATION_RUN=${f.run}`),
          'Refuse foreign builder'
        )
        f.volumes.push(...c.Mounts.filter((m) => m.Type === 'volume').map((m) => m.Name))
        save(f)
      }
      docker(f, ['buildx', 'rm', '--force', name])
      assert.ok(
        !docker(f, ['buildx', 'ls', '--format', '{{.Name}}']).trim().split('\n').includes(name)
      )
      assert.equal(
        docker(f, [
          'container',
          'ls',
          '--all',
          '--filter',
          `name=^/${container}$`,
          '--format',
          '{{.ID}}',
        ]).trim(),
        ''
      )
    } catch (e) {
      failures.push(e)
    }
  }
  for (const name of f.images) {
    try {
      if (
        !docker(f, ['image', 'ls', '--filter', `reference=${name}`, '--format', '{{.ID}}']).trim()
      )
        continue
      const [i] = JSON.parse(docker(f, ['image', 'inspect', name]))
      assert.equal(i.Config.Labels[label], f.run)
      docker(f, ['image', 'rm', name])
      assert.equal(
        docker(f, ['image', 'ls', '--filter', `reference=${name}`, '--format', '{{.ID}}']).trim(),
        ''
      )
    } catch (e) {
      failures.push(e)
    }
  }
  for (const name of f.volumes)
    try {
      assert.equal(
        docker(f, ['volume', 'ls', '--filter', `name=^${name}$`, '--format', '{{.Name}}']).trim(),
        '',
        'Builder volume survived'
      )
    } catch (e) {
      failures.push(e)
    }
  try {
    await clientsStopped(f.clients)
  } catch (error) {
    failures.push(error)
  }
  if (failures.length) throw new AggregateError(failures, 'Preparation cleanup incomplete')
  rmSync(join(f.output, 'resources.json.tmp'), { force: true })
  writeFileSync(
    join(f.output, 'cleanup.json'),
    JSON.stringify(
      {
        run: f.run,
        complete: true,
        builders: f.builders,
        images: f.images,
        containers: f.containers,
        volumes: f.volumes,
      },
      null,
      2
    ) + '\n'
  )
  unlinkSync(join(f.output, 'resources.json'))
}
