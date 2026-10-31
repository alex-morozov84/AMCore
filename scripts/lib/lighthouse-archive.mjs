import { readFile, writeFile, mkdir, lstat } from 'node:fs/promises'
import { join } from 'node:path'
import { gzip, gunzip } from 'node:zlib'
import { promisify } from 'node:util'
import { verifyBundle, limits, safeBody } from './lighthouse-reports.mjs'
import { invariant, digest } from './lighthouse-plan.mjs'

// A bounded gzip JSON envelope avoids filesystem paths, links and extraction hooks.
export async function packReports(directory, archive) {
  const { manifest } = await verifyBundle(directory)
  const names = ['manifest.json', ...manifest.files.map((f) => f.name)]
  const entries = await Promise.all(
    names.map(async (name) => [name, await readFile(join(directory, name), 'utf8')])
  )
  const body = JSON.stringify({ version: 1, entries })
  invariant(Buffer.byteLength(body) <= limits.total, 'archive-json-too-large')
  const bytes = await promisify(gzip)(body)
  invariant(bytes.length <= limits.total, 'archive-too-large')
  await writeFile(archive, bytes, { flag: 'wx', mode: 0o600 })
  return digest(bytes)
}

export async function unpackReports(archive, directory, archiveHash, manifestHash) {
  const stat = await lstat(archive)
  invariant(stat.isFile() && !stat.isSymbolicLink() && stat.size <= limits.total, 'unsafe-archive')
  const bytes = await readFile(archive)
  invariant(digest(bytes) === archiveHash, 'archive-hash-mismatch')
  const body = await promisify(gunzip)(bytes, { maxOutputLength: limits.total })
  const payload = JSON.parse(body.toString('utf8'))
  invariant(
    payload.version === 1 &&
      Array.isArray(payload.entries) &&
      payload.entries.length <= limits.files,
    'invalid-archive-shape'
  )
  const entries = new Map()
  for (const pair of payload.entries) {
    invariant(
      Array.isArray(pair) &&
        pair.length === 2 &&
        /^(?:manifest\.json|[a-z][a-z0-9-]{0,50}\.(?:json|html))$/.test(pair[0]) &&
        !entries.has(pair[0]),
      'unsafe-archive-entry'
    )
    entries.set(pair[0], safeBody(pair[1]))
  }
  invariant(
    entries.has('manifest.json') && digest(entries.get('manifest.json')) === manifestHash,
    'archive-manifest-mismatch'
  )
  const manifest = JSON.parse(entries.get('manifest.json'))
  invariant(manifest.files?.length === entries.size - 1, 'archive-file-inventory-mismatch')
  for (const f of manifest.files)
    invariant(
      entries.has(f.name) &&
        Buffer.byteLength(entries.get(f.name)) === f.bytes &&
        digest(entries.get(f.name)) === f.sha256,
      'archive-report-mismatch'
    )
  await mkdir(directory, { recursive: false, mode: 0o700 })
  for (const [name, text] of entries)
    await writeFile(join(directory, name), text, { flag: 'wx', mode: 0o600 })
  return verifyBundle(directory)
}
