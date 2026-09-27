import { projectChoices } from './project.mjs'
import { randomBytes, randomUUID, createHash } from 'node:crypto'
import { join } from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { root, directory, save } from './state.mjs'
import { snapshot } from './snapshot.mjs'
import { allocate } from './ports.mjs'
import { engine } from './docker.mjs'

export async function create(id, purpose, topology, mocked = false) {
  const choices = await projectChoices(root)
  topology ??= choices.topology
  const uuid = randomUUID()
  const attempt = randomUUID()
  const suffix = uuid.replaceAll('-', '').slice(0, 12)
  const hostnames = {
    product: `app-${suffix}.localhost`,
    console: `console-${suffix}.localhost`,
    api: `api-${suffix}.localhost`,
  }
  const ports = await allocate(uuid)
  const origins =
    topology === 'host'
      ? Object.fromEntries(
          Object.entries(hostnames).map(([k, v]) => [k, `https://${v}:${ports.tls}`])
        )
      : {
          product: mocked
            ? `http://127.0.0.1:${ports.web}`
            : `http://${hostnames.product}:${ports.web}`,
          api: `http://127.0.0.1:${ports.api}`,
        }
  if (mocked) {
    origins.product = `http://127.0.0.1:${ports.web}`
    delete origins.api
    delete origins.console
  }
  const m = {
    version: 1,
    ...choices,
    fixtureVersion: 1,
    mocked,
    id,
    uuid,
    attempt,
    purpose,
    topology,
    worktree: root,
    project: `amcore-${createHash('sha256').update(root).digest('hex').slice(0, 8)}-${purpose}-${suffix}`,
    engine: mocked ? undefined : await engine(),
    ports,
    hostnames,
    origins,
    dbPassword: randomBytes(24).toString('hex'),
    jwtSecret: randomBytes(32).toString('hex'),
    snapshot: join(directory(id), `source-${attempt}`),
    state: 'allocated',
    resources: {},
  }
  await save(m)
  m.sourceHash = await snapshot(root, m.snapshot)
  if (topology === 'host') {
    const path = join(m.snapshot, 'apps/web/src/shared/lib/admin-console.generated.ts')
    const content = await readFile(path, 'utf8')
    if (!content.includes('enabled: true'))
      throw new Error('Console host lane unavailable in this fork')
    await writeFile(path, content.replace("mode: 'path'", "mode: 'host'"))
  }
  await save(m)
  return m
}
