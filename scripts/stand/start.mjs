import { initializeMarker } from './bootstrap-marker.mjs'
import { writeFile } from 'node:fs/promises'
import { compose, docker, inspect } from './docker.mjs'
import { configuration } from './config.mjs'
import { dataAdmission, cleanup } from './ownership.mjs'
import { save } from './state.mjs'

export async function start(m) {
  // A changed source rebuild must not admit previous application image IDs.
  // Preserve only the already-owned volumes, then recreate the local services.
  if (!m.images && m.resources?.container?.length) await cleanup(m, false)
  await configuration(m)
  m.state = 'configured'
  await save(m)
  await compose(m, ['up', '-d', '--wait', '--no-deps', 'postgres', 'redis'])
  await initializeMarker(m)
  m.markerInitialized = true
  m.state = 'infrastructure-ready'
  await save(m)
  if (!m.images) {
    await compose(m, ['build', 'migrate', 'api', 'worker', 'web'])
    m.images = {}
    for (const service of ['migrate', 'api', 'worker', 'web']) {
      m.images[service] = JSON.parse(
        await docker(m, ['image', 'inspect', `${m.project}-${service}`], { capture: true })
      )[0].Id
    }
    await save(m)
  }
  await dataAdmission(m)
  await compose(m, ['up', '--no-deps', '--exit-code-from', 'migrate', 'migrate'])
  await dataAdmission(m)
  if (!m.catalogInitialized)
    await compose(m, [
      'run',
      '--rm',
      '--no-deps',
      'migrate',
      './node_modules/.bin/tsx',
      'prisma/seed.ts',
    ])
  m.catalogInitialized = true
  await save(m)
  await dataAdmission(m)
  m.state = 'migrated'
  await save(m)
  await compose(m, [
    'up',
    '-d',
    '--wait',
    '--no-deps',
    'api',
    'worker',
    'web',
    ...(m.topology === 'host' ? ['caddy'] : []),
  ])
  await dataAdmission(m)
  if (m.topology === 'host') {
    for (const id of m.resources.container) {
      const c = await inspect(m, 'container', id)
      if (c.Config.Labels['com.docker.compose.service'] !== 'caddy') continue
      m.caFile = `${m.worktree}/.amcore/stands/${m.id}/root.crt`
      const cert = await docker(
        m,
        ['exec', id, 'cat', '/data/caddy/pki/authorities/local/root.crt'],
        { capture: true }
      )
      await writeFile(m.caFile, cert, { mode: 0o600 })
    }
  }
  m.state = 'app-ready'
  await save(m)
}
