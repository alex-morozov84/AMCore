import { cleanup } from './cleanup.mjs'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import { journal } from './context.mjs'
import { resources, dispose } from '../migrator-lifecycle/resources.mjs'
import { fixture } from '../migrator-lifecycle/fixture.mjs'
import { owned, label } from '../migrator-lifecycle/docker.mjs'
import { safeError } from '../migrator-lifecycle/safety.mjs'

const execute = promisify(execFile)
const emit = (event) => console.log(JSON.stringify(event))
function remember(f, suffix) {
  const name = `migrator-lifecycle-${f.run}-${suffix}`
  f.containers.push(name)
  f.journal()
  return name
}
export async function networkAndCleanup(image) {
  const path = journal(),
    f = await resources(path)
  let disposed = false,
    failure
  try {
    await fixture(f, image)
    assert.equal((await f.observer.query('SELECT 1 AS ok')).rows[0].ok, 1)
    const canary = remember(f, 'statement_int')
    await f.docker([
      'run',
      '--pull=never',
      '--detach',
      '--name',
      canary,
      '--label',
      `${label}=${f.run}`,
      '--network',
      'bridge',
      '--entrypoint',
      'node',
      image,
      '-e',
      "require('node:http').createServer((q,s)=>s.end('canary')).listen(8080,'0.0.0.0')",
    ])
    const c = await owned(f, 'container', canary),
      ip = c.NetworkSettings.Networks.bridge.IPAddress
    const probe = (expected) =>
      `const http=require('node:http');const req=http.get('http://${ip}:8080',r=>{r.resume();console.log('CONNECTED');process.exit(${expected === 'connected' ? 0 : 2})});req.setTimeout(2000,()=>req.destroy(Object.assign(new Error('timeout'),{code:'ETIMEDOUT'})));req.on('error',e=>{console.log(e.code);process.exit(${expected === 'blocked' ? 0 : 3})})`
    const baseline = remember(f, 'transaction_term')
    await f.docker([
      'run',
      '--pull=never',
      '--name',
      baseline,
      '--label',
      `${label}=${f.run}`,
      '--network',
      'bridge',
      '--entrypoint',
      'node',
      image,
      '-e',
      probe('connected'),
    ])
    const blocked = remember(f, 'transaction_int')
    const blockedResult = await f.docker([
      'run',
      '--pull=never',
      '--name',
      blocked,
      '--label',
      `${label}=${f.run}`,
      '--network',
      f.network,
      '--entrypoint',
      'node',
      image,
      '-e',
      probe('blocked'),
    ])
    assert.match(blockedResult, /ETIMEDOUT|ENETUNREACH|EHOSTUNREACH/)
    const blockedContainer = await owned(f, 'container', blocked)
    assert.deepEqual(Object.keys(blockedContainer.NetworkSettings.Networks), [f.network])
    const cli = remember(f, 'statement_term'),
      url = new URL(f.database.getConnectionUri())
    url.hostname = 'migration-db'
    url.port = '5432'
    const { stdout } = await execute(
      'docker',
      [
        '--host',
        f.endpoint,
        'run',
        '--pull=never',
        '--name',
        cli,
        '--label',
        `${label}=${f.run}`,
        '--network',
        f.network,
        '--env',
        'DATABASE_URL',
        image,
        './node_modules/.bin/prisma',
        'db',
        'execute',
        '--file',
        './migrator-check.sql',
      ],
      { env: { ...process.env, DATABASE_URL: url.href }, timeout: 15000, maxBuffer: 1024 * 1024 }
    )
    emit({
      run: f.run,
      check: 'network',
      verdict: 'PASS',
      hostObserver: true,
      actualPrismaPreflight: true,
      externalCanaryPositiveControl: true,
      internalCanaryBlocked: blockedResult.trim(),
      cliOutputBytes: stdout.length,
    })
    const docker = f.docker
    f.docker = async (args) => {
      if (args[0] === 'container' && args[1] === 'rm')
        throw Object.assign(new Error('injected removal denial'), { code: 'EACCES' })
      return docker(args)
    }
    await assert.rejects(dispose(f), (error) => error instanceof AggregateError)
    assert.equal(existsSync(path), true)
    emit({ run: f.run, check: 'cleanup-denial', verdict: 'EXPECTED_ERROR', journalRetained: true })
    await cleanup(path)
    disposed = true
    emit({
      run: f.run,
      check: 'independent-recovery-after-denial',
      verdict: 'PASS',
      journalRemoved: true,
    })
  } catch (error) {
    failure = error
    emit({ run: f.run, verdict: 'ERROR', error: safeError(error) })
  }
  try {
    if (!disposed && existsSync(path)) await cleanup(path)
  } catch (error) {
    throw new AggregateError([...(failure ? [failure] : []), error], 'Control and recovery failed')
  }
  if (failure) throw failure
}
