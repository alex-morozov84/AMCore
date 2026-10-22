import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { dockerClient, localEndpoint, owned } from './docker.mjs'
import { closeClient, safeError } from './safety.mjs'

export async function resources(journalPath = process.env.AMCORE_MIGRATOR_LIFECYCLE_JOURNAL) {
  const run = randomUUID()
  const endpoint = await localEndpoint()
  const docker = dockerClient(endpoint)
  const directory = join(tmpdir(), `amcore-migrator-lifecycle-${run}`)
  const journal = journalPath ?? join(directory, 'resources.json')
  assert.ok(isAbsolute(journal), 'Use an absolute journal path')
  assert.equal(
    existsSync(journal),
    false,
    'Recover the previous journal before starting another run'
  )
  mkdirSync(directory, { mode: 0o700 })
  const f = {
    run,
    directory,
    endpoint,
    network: `migrator-lifecycle-${run}`,
    containers: [`migrator-lifecycle-${run}-database`],
    clients: [],
    history: [],
    journalPath: journal,
  }
  f.docker = docker
  f.journal = () => writeJournal(f)
  try {
    f.journal()
  } catch (error) {
    await rm(directory, { recursive: true, force: true })
    throw error
  }
  return f
}

function writeJournal(f) {
  const { run, directory, endpoint, network, containers, clients, history } = f
  const temporary = `${f.journalPath}.tmp`
  writeFileSync(
    temporary,
    JSON.stringify({ version: 1, run, directory, endpoint, network, containers, clients, history }),
    { mode: 0o600 }
  )
  renameSync(temporary, f.journalPath)
}

export async function removeContainer(f, name) {
  const container = await owned(f, 'container', name)
  if (!container) return // An unsuccessful spawn need not have created a container.
  await f.docker(['container', 'rm', '--force', '--volumes', container.Id])
  assert.equal(await owned(f, 'container', name), undefined, 'Container cleanup incomplete')
}

export async function clientsStopped(clients = [], probe = (pid) => process.kill(pid, 0)) {
  for (const client of clients) {
    if (client.closed || client.pid === undefined) continue
    const deadline = performance.now() + 5000
    // Never kill a recovered PID: it may already belong to another process.
    while (!client.closed) {
      try {
        probe(client.pid)
      } catch (error) {
        if (error.code === 'ESRCH') break
        throw error
      }
      if (performance.now() >= deadline)
        throw Object.assign(new Error('Client still exists'), { code: 'RECORDED_CLIENT_ALIVE' })
      await delay(25)
    }
  }
}

export async function dispose(f) {
  const failures = []
  for (const operation of [
    () => closeClient(f.observer),
    ...f.containers.map((name) => () => removeContainer(f, name)),
    async () => {
      const network = await owned(f, 'network', f.network)
      if (network) await f.docker(['network', 'rm', network.Id])
      assert.equal(await owned(f, 'network', f.network), undefined, 'Network cleanup incomplete')
    },
    () => clientsStopped(f.clients),
  ]) {
    try {
      await operation()
    } catch (error) {
      failures.push(error)
    }
  }
  if (failures.length) {
    console.error(
      JSON.stringify({
        run: f.run,
        verdict: 'CLEANUP_ERROR',
        journal: f.journalPath,
        errors: failures.map(safeError),
      })
    )
    throw new AggregateError(failures, 'Cleanup incomplete')
  }
  // Only a verified successful cleanup may remove its recovery journal.
  await rm(f.directory, { recursive: true, force: true })
  await rm(f.journalPath, { force: true })
  await rm(`${f.journalPath}.tmp`, { force: true })
}

export function recovery(journalPath) {
  assert.ok(isAbsolute(journalPath), 'Use an absolute recovery journal path')
  const f = JSON.parse(readFileSync(journalPath, 'utf8'))
  assert.equal(f.version, 1)
  assert.match(f.run, /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/)
  assert.equal(f.directory, join(tmpdir(), `amcore-migrator-lifecycle-${f.run}`))
  assert.equal(f.network, `migrator-lifecycle-${f.run}`)
  assert.ok(
    f.containers.every((name) =>
      new RegExp(
        `^migrator-lifecycle-${f.run}-(?:database|statement_(?:term|int)|transaction_(?:term|int))$`
      ).test(name)
    )
  )
  assert.ok(
    (f.clients ?? []).every(
      (client) =>
        f.containers.includes(client.name) &&
        (client.pid === undefined || (Number.isSafeInteger(client.pid) && client.pid > 0)) &&
        typeof client.closed === 'boolean'
    )
  )
  return { ...f, journalPath, docker: dockerClient(f.endpoint) }
}
