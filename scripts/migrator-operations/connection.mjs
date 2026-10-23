import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { requireApi, emit } from './context.mjs'
import { bounded, closeClient, safeError } from '../migrator-lifecycle/safety.mjs'
import { closeAttached } from '../migrator-lifecycle/exit.mjs'
const { Client } = requireApi('pg')
export function localUrl(f, database = 'amcore', role = 'postgres', password) {
  const u = new URL(f.database.getConnectionUri())
  u.pathname = `/${database}`
  if (role !== 'postgres') {
    u.username = role
    u.password = password ?? f.roles[role]
  }
  return u.href
}
export function imageUrl(f, database = 'amcore', role = 'amcore_migrator', options = {}) {
  const u = new URL(localUrl(f, database, role))
  u.hostname = 'migration-db'
  u.port = '5432'
  u.searchParams.set('sslmode', 'require')
  u.searchParams.set('sslaccept', 'strict')
  u.searchParams.set('sslcert', '/run/amcore-migration/ca.crt')
  for (const [k, v] of Object.entries(options)) u.searchParams.set(k, v)
  return u.href
}
export async function connect(f, database, role = 'postgres', password) {
  const client = new Client({
    connectionString: localUrl(f, database, role, password),
    ssl: { ca: f.ca, rejectUnauthorized: true },
    query_timeout: 10000,
    connectionTimeoutMillis: 10000,
  })
  try {
    await client.connect()
    return client
  } catch (error) {
    try {
      await closeClient(client)
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Connection and cleanup failed')
    }
    throw error
  }
}
export async function withConnection(f, database, role, operation) {
  const client = await connect(f, database, role)
  return usingConnection(client, operation)
}

export async function usingConnection(client, operation) {
  let result, failure
  try {
    result = await operation(client)
  } catch (error) {
    failure = error
  }
  try {
    await closeClient(client)
  } catch (error) {
    throw new AggregateError([...(failure ? [failure] : []), error], 'Operation and cleanup failed')
  }
  if (failure) throw failure
  return result
}
export async function password(f, role) {
  const child = spawn(
    'docker',
    [
      '--host',
      f.endpoint,
      'exec',
      '-i',
      f.database.getId(),
      'psql',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-c',
      `\\password ${role}`,
    ],
    { stdio: ['pipe', 'pipe', 'pipe'] }
  )
  child.stdout.resume()
  child.stderr.resume()
  const client = { name: f.containers[0], pid: child.pid, closed: false }
  f.clients.push(client)
  const closed = new Promise((resolve) => {
    child.once('error', (error) => resolve({ error }))
    child.once('close', (code) => {
      client.closed = true
      resolve({ code })
    })
  })
  child.stdin.on('error', () => {}) // A failed exec is reported by error/close.
  f.journal()
  child.stdin.end(`${f.roles[role]}\n${f.roles[role]}\n`)
  let failure
  try {
    const result = await bounded(closed, 10000, 'PASSWORD_TIMEOUT')
    if (result.error) throw result.error
    assert.equal(result.code, 0, 'psql password provisioning failed')
  } catch (error) {
    failure = error
    emit(f, 'password-provisioning', { verdict: 'ERROR', error: safeError(error) })
  }
  try {
    await closeAttached(
      { child, closed, cancellation: new globalThis.AbortController() },
      (error) =>
        emit(f, 'password-provisioning', { verdict: 'CLEANUP_ERROR', error: safeError(error) })
    )
  } catch (error) {
    throw new AggregateError([...(failure ? [failure] : []), error], 'Password/cleanup failed')
  }
  if (failure) throw failure
}
