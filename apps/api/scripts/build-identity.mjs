import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const root = path.resolve(import.meta.dirname, '../../..')
const dist = path.resolve(import.meta.dirname, '../dist')
const hash = createHash('sha256')
const inputs = (await readdir(dist, { recursive: true })).filter((p) => p.endsWith('.js')).sort()
for (const input of inputs) hash.update(input).update(await readFile(path.join(dist, input)))
const shared = path.join(root, 'packages/shared/dist')
for (const input of (await readdir(shared)).filter((p) => /\.(js|cjs)$/.test(p)).sort()) {
  hash.update(`shared/${input}`).update(await readFile(path.join(shared, input)))
}
for (const input of ['pnpm-lock.yaml', 'package.json'])
  hash.update(await readFile(path.join(root, input)))
let commit = process.env.BUILD_SOURCE_COMMIT || null
if (!commit) {
  try {
    const dirty = execFileSync('git', ['status', '--porcelain'], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim()
    if (!dirty) commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root }).toString().trim()
  } catch {
    /* Docker has no Git metadata; CI supplies the verified source SHA. */
  }
}
if (commit && !/^[a-f0-9]{40,64}$/.test(commit)) throw new Error('Invalid source commit')
const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
await writeFile(
  path.join(dist, 'build-identity.json'),
  JSON.stringify({ id: hash.digest('hex'), version, commit })
)
