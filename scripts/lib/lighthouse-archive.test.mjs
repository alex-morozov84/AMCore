import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { digest } from './lighthouse-plan.mjs'
import { writePair, writeManifest } from './lighthouse-reports.mjs'
import { packReports, unpackReports } from './lighthouse-archive.mjs'

test('archive round-trip validates both archive and manifest hashes before materializing safe reports', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'amcore-audit-archive-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = join(root, 'source')
  await mkdir(source)
  const files = await writePair(source, 'login', { json: '{}', html: '<html>safe</html>' }, [])
  const manifestHash = await writeManifest(source, { version: 1, files })
  const archive = join(root, 'payload.json.gz')
  const archiveHash = await packReports(source, archive)
  const unpacked = await unpackReports(archive, join(root, 'retrieved'), archiveHash, manifestHash)
  assert.equal(unpacked.sha256, manifestHash)
  assert.equal(await readFile(join(root, 'retrieved/login.html'), 'utf8'), '<html>safe</html>')
  await assert.rejects(unpackReports(archive, join(root, 'wrong'), 'f'.repeat(64), manifestHash))
  await assert.rejects(
    unpackReports(archive, join(root, 'wrong-manifest'), archiveHash, 'f'.repeat(64))
  )
  const malicious = gzipSync(JSON.stringify({ version: 1, entries: [['../escape', 'secret']] }))
  await writeFile(join(root, 'bad.gz'), malicious)
  await assert.rejects(
    unpackReports(join(root, 'bad.gz'), join(root, 'bad'), digest(malicious), manifestHash)
  )
})
