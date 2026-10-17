import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { installerPin } from '../../docker/migrator/installer.mjs'
import { verifyMigrator } from './migrator-contract.mjs'

export function dockerPins(path, text) {
  const found = new Map()
  for (const match of text.matchAll(
    /^FROM\s+(\S+?:\S+?)@sha256:([a-f0-9]{64})(?:\s+AS\s+(\S+))?/gim
  )) {
    const [, ref, pinned, stage] = match
    const key = `${ref}@${pinned}`
    if (!found.has(key)) found.set(key, { path, ref, pinned, stages: [] })
    if (stage) found.get(key).stages.push(stage)
  }
  return [...found.values()]
}

export async function migratorFreshness(root, request = fetch) {
  try {
    verifyMigrator(root)
    const manifest = JSON.parse(readFileSync(join(root, 'docker/migrator/package.json'), 'utf8'))
    const dependencies = { ...manifest.dependencies, pnpm: installerPin(manifest).version }
    return await Promise.all(
      Object.entries(dependencies).map(async ([name, current]) => {
        try {
          const response = await request(`https://registry.npmjs.org/${encodeURIComponent(name)}`, {
            signal: globalThis.AbortSignal.timeout(15000),
            headers: { Accept: 'application/vnd.npm.install-v1+json' },
          })
          if (!response.ok) throw new Error(`registry HTTP ${response.status}`)
          const latest = (await response.json())['dist-tags']?.latest
          if (typeof latest !== 'string' || !latest) throw new Error('registry latest tag missing')
          return { name, current, latest }
        } catch (error) {
          return { name, current, error: error.message }
        }
      })
    )
  } catch (error) {
    return [{ name: 'docker/migrator', error: error.message }]
  }
}

export function renderMigrator(rows) {
  return [
    '## Migrator dependencies and isolated installer',
    '',
    'Separate frozen graph: `docker/migrator`. Update Prisma family and both locks together; review majors/prereleases manually.',
    '',
    '| Package | Pinned | Latest signal |',
    '|---|---|---|',
    ...rows.map(
      (row) =>
        `| ${row.name} | ${row.current ?? '?'} | ${row.error ? `unknown: ${row.error}` : row.latest} |`
    ),
    '',
  ]
}
