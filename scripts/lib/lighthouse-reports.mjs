import { mkdir, readFile, writeFile, lstat, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { digest, invariant } from './lighthouse-plan.mjs'

export const limits = { pair: 8 * 1024 ** 2, total: 256 * 1024 ** 2, files: 200 }
const reportName = /^[a-z][a-z0-9-]{0,50}\.(json|html)$/
export function safeBody(body, secrets = []) {
  invariant(typeof body === 'string', 'missing-report-body')
  invariant(!secrets.some((s) => s && body.includes(s)), 'unsafe-report-content')
  invariant(
    !/(?:Bearer\s+[A-Za-z0-9_-]{20}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.|(?:accessToken|refreshToken|passwordHash|storageState)"\s*:\s*"[^"\s]{8})/.test(
      body
    ),
    'unsafe-report-content'
  )
  return body
}
export async function writePair(directory, id, reports, secrets) {
  const entries = Object.entries(reports)
  invariant(
    entries.length === 2 && entries.every(([ext]) => ['json', 'html'].includes(ext)),
    'incomplete-report-pair'
  )
  invariant(
    entries.reduce((sum, [, body]) => sum + Buffer.byteLength(body), 0) <= limits.pair,
    'report-pair-too-large'
  )
  for (const [, body] of entries) safeBody(body, secrets)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const files = []
  for (const [ext, body] of entries) {
    const name = `${id}.${ext}`
    invariant(reportName.test(name), 'invalid-report-name')
    await writeFile(join(directory, name), body, { flag: 'wx', mode: 0o600 })
    files.push({ name, bytes: Buffer.byteLength(body), sha256: digest(body) })
  }
  return files
}

export async function writeManifest(directory, manifest) {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const body = safeBody(JSON.stringify(manifest, null, 2))
  await writeFile(join(directory, 'manifest.json'), body, { flag: 'wx', mode: 0o600 })
  await verifyBundle(directory)
  return digest(body)
}

export async function verifyBundle(directory, expected = {}) {
  const directoryStat = await lstat(directory)
  invariant(
    directoryStat.isDirectory() && !directoryStat.isSymbolicLink(),
    'unsafe-bundle-directory'
  )
  const manifestFile = join(directory, 'manifest.json')
  invariant(
    (await lstat(manifestFile)).isFile() && !(await lstat(manifestFile)).isSymbolicLink(),
    'unsafe-manifest-file'
  )
  const raw = await readFile(manifestFile, 'utf8')
  invariant(Buffer.byteLength(raw) <= 1024 ** 2, 'manifest-too-large')
  const m = JSON.parse(safeBody(raw))
  for (const [key, value] of Object.entries(expected))
    invariant(m[key] === value, 'bundle-provenance-mismatch')
  invariant(Array.isArray(m.files) && m.files.length <= limits.files - 1, 'invalid-file-inventory')
  const names = m.files.map((f) => f.name)
  invariant(
    new Set(names).size === names.length && names.every((n) => reportName.test(n)),
    'invalid-file-allowlist'
  )
  const actual = await readdir(directory)
  invariant(
    actual.length === names.length + 1 &&
      actual.every((n) => n === 'manifest.json' || names.includes(n)),
    'unexpected-or-missing-file'
  )
  let bytes = Buffer.byteLength(raw)
  for (const file of m.files) {
    const stat = await lstat(join(directory, file.name))
    invariant(
      stat.isFile() &&
        !stat.isSymbolicLink() &&
        stat.size === file.bytes &&
        stat.size <= limits.pair,
      'unsafe-file-size-or-type'
    )
    const body = await readFile(join(directory, file.name), 'utf8')
    invariant(digest(safeBody(body)) === file.sha256, 'report-hash-mismatch')
    bytes += stat.size
  }
  invariant(bytes <= limits.total, 'bundle-too-large')
  for (const id of new Set(names.map((name) => name.replace(/\.(html|json)$/, '')))) {
    const pair = m.files.filter((f) => f.name.startsWith(`${id}.`))
    invariant(
      pair.length === 2 && pair.reduce((sum, f) => sum + f.bytes, 0) <= limits.pair,
      'incomplete-or-oversize-pair'
    )
  }
  return { manifest: m, sha256: digest(raw) }
}
