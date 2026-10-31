import { readFile, writeFile, lstat, readdir, mkdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { digest, invariant } from './lighthouse-plan.mjs'
import { verifyBundle, limits, safeBody } from './lighthouse-reports.mjs'
import { viewRows } from './lighthouse-view-model.mjs'
import { renderIndex } from './lighthouse-view-html.mjs'

async function regularFile(path) {
  const stat = await lstat(path)
  invariant(
    stat.isFile() && !stat.isSymbolicLink() && stat.size <= limits.total,
    'unsafe-view-file'
  )
  return stat
}

export async function readViewBundle(directory, plan, lane) {
  const present = await lstat(directory).then(
    () => true,
    (error) => {
      if (error.code !== 'ENOENT') throw error
      return false
    }
  )
  if (!present) return undefined
  return verifyBundle(directory, {
    plan: plan.digest,
    run: plan.run,
    attempt: plan.attempt,
    source: plan.source,
    lane,
  })
}

export async function verifyView(directory, plan, lane, manifest, expected = {}) {
  const stat = await lstat(directory)
  invariant(stat.isDirectory() && !stat.isSymbolicLink(), 'unsafe-view-directory')
  const rows = viewRows(plan, lane, manifest)
  const reports = rows.filter((r) => r.filename)
  const names = [
    'index.html',
    ...(manifest ? ['payload.json.gz'] : []),
    ...reports.map((r) => r.filename),
  ]
  const actual = await readdir(directory)
  invariant(
    actual.length === names.length && actual.every((name) => names.includes(name)),
    'unexpected-view-files'
  )
  let bytes = 0
  for (const name of names) bytes += (await regularFile(join(directory, name))).size
  invariant(bytes <= limits.total && names.length <= limits.files, 'view-upload-limit-exceeded')
  const index = safeBody(await readFile(join(directory, 'index.html'), 'utf8'))
  const indexHash = digest(index)
  invariant(
    index === renderIndex(plan, lane, rows) &&
      (!expected.indexHash || indexHash === expected.indexHash),
    'view-index-mismatch'
  )
  for (const row of reports) {
    const file = manifest.files.find((f) => f.name === row.filename)
    const body = await readFile(join(directory, row.filename), 'utf8')
    invariant(
      Buffer.byteLength(body) === file.bytes && digest(safeBody(body)) === file.sha256,
      'view-report-mismatch'
    )
  }
  if (manifest && expected.archiveHash)
    invariant(
      digest(await readFile(join(directory, 'payload.json.gz'))) === expected.archiveHash,
      'view-archive-mismatch'
    )
  return { indexHash, bytes, files: names.length }
}

export async function writeView(directory, plan, lane, bundleDirectory, archive) {
  const bundle = await readViewBundle(bundleDirectory, plan, lane)
  const rows = viewRows(plan, lane, bundle?.manifest)
  const bodies = new Map([['index.html', safeBody(renderIndex(plan, lane, rows))]])
  if (bundle) {
    await regularFile(archive)
    bodies.set('payload.json.gz', await readFile(archive))
    for (const row of rows.filter((r) => r.filename))
      bodies.set(row.filename, await readFile(join(bundleDirectory, row.filename)))
  }
  invariant(
    bodies.size <= limits.files &&
      [...bodies.values()].reduce((sum, body) => sum + Buffer.byteLength(body), 0) <= limits.total,
    'view-upload-limit-exceeded'
  )
  const present = await lstat(directory).then(
    () => true,
    (e) => {
      if (e.code !== 'ENOENT') throw e
      return false
    }
  )
  invariant(!present, 'view-already-exists')
  const staging = `${directory}.pending-${randomUUID()}`
  await mkdir(staging, { mode: 0o700 })
  try {
    for (const [name, body] of bodies)
      await writeFile(join(staging, name), body, { flag: 'wx', mode: 0o600 })
    const result = await verifyView(staging, plan, lane, bundle?.manifest, {
      archiveHash: bundle ? digest(bodies.get('payload.json.gz')) : undefined,
    })
    await rename(staging, directory)
    return result
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}
