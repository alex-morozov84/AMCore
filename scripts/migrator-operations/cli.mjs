import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { imageUrl } from './connection.mjs'
import { bounded, safeError } from '../migrator-lifecycle/safety.mjs'
import { closeAttached } from '../migrator-lifecycle/exit.mjs'
import { label } from '../migrator-lifecycle/docker.mjs'
import { removeContainer } from '../migrator-lifecycle/resources.mjs'
import { emit } from './context.mjs'

function argumentsFor(f, name, { schema, ca, env, mounts }) {
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
    `type=bind,src=${f.ssl}/${ca},dst=/run/amcore-migration/ca.crt,readonly`,
  ]
  if (schema) args.push('--mount', `type=bind,src=${schema},dst=/app/apps/api/prisma,readonly`)
  for (const [source, destination] of mounts)
    args.push('--mount', `type=bind,src=${source},dst=${destination},readonly`)
  for (const key of Object.keys(env)) args.push('--env', key)
  return args
}

export async function cli(f, args = [], options = {}) {
  const {
    url = imageUrl(f),
    schema,
    ca = 'ca.crt',
    expected = 0,
    slot = 'statement_term',
    artifact = f.artifact.Id,
    env = {},
    mounts = [],
  } = options
  const name = `migrator-lifecycle-${f.run}-${slot}`
  if (!f.containers.includes(name)) f.containers.push(name)
  f.journal()
  const command = args.length ? ['./node_modules/.bin/prisma', ...args] : []
  const started = performance.now()
  const child = spawn(
    'docker',
    [...argumentsFor(f, name, { schema, ca, env, mounts }), artifact, ...command],
    {
      env: { ...process.env, DATABASE_URL: url, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  )
  const client = { name, pid: child.pid, closed: false }
  f.clients.push(client)
  let text = ''
  const collect = (data) => {
    if (text.length < 1024 * 1024) text += data.toString()
  }
  child.stdout.on('data', collect)
  child.stderr.on('data', collect)
  const closed = new Promise((resolve) => {
    child.once('error', (error) => resolve({ error }))
    child.once('close', (code, signal) => {
      client.closed = true
      resolve({ code, signal })
    })
  })
  f.journal()
  let failure, result
  try {
    result = await bounded(closed, 45000, 'CLI_TIMEOUT')
    if (result.error) throw result.error
    assert.equal(result.signal, null, 'CLI must exit naturally')
    if (expected === 0) assert.equal(result.code, 0, 'CLI command failed')
    else assert.ok(result.code > 0, 'Expected CLI refusal')
  } catch (error) {
    failure = error
    emit(f, f.phase, {
      verdict: 'FAIL',
      error: safeError(error),
      prismaCode: text.match(/P\d{4}/)?.[0],
    })
  }
  const cleanupErrors = []
  try {
    await removeContainer(f, name)
  } catch (error) {
    cleanupErrors.push(error)
  }
  try {
    await closeAttached(
      { child, closed, cancellation: new globalThis.AbortController() },
      (error) => emit(f, f.phase, { verdict: 'CLEANUP_ERROR', error: safeError(error) })
    )
  } catch (error) {
    cleanupErrors.push(error)
  }
  if (cleanupErrors.length)
    emit(f, f.phase, { verdict: 'CLEANUP_ERROR', errors: cleanupErrors.map(safeError) })
  if (failure || cleanupErrors.length)
    throw new AggregateError(
      [...(failure ? [failure] : []), ...cleanupErrors],
      'CLI verification failed'
    )
  return { ...result, text, elapsed: performance.now() - started }
}
