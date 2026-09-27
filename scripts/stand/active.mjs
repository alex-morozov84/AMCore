import { resolve } from 'node:path'
import { targetProof } from './target-proof.mjs'
import { lstat } from 'node:fs/promises'
import { connect } from 'node:net'
import { readFile } from 'node:fs/promises'

const path = process.env.AMCORE_STAND_MANIFEST
const token = process.env.AMCORE_STAND_TOKEN
if (!path || !token) throw new Error('Use pnpm stand e2e; an active managed run is required')
const m = JSON.parse(await readFile(path, 'utf8'))
const localRoot = resolve(import.meta.dirname, '../..')
if (localRoot !== m.worktree && localRoot !== m.snapshot) throw new Error('Foreign run source')
if (
  resolve(path) !== `${m.worktree}/.amcore/stands/${m.id}/manifest.json` ||
  !/^[a-z0-9-]{1,80}$/.test(m.id)
)
  throw new Error('Foreign run manifest path')
for (const file of [
  path,
  `${m.worktree}/.amcore`,
  `${m.worktree}/.amcore/stands`,
  `${m.worktree}/.amcore/stands/${m.id}`,
]) {
  if ((await lstat(file)).isSymbolicLink()) throw new Error('Symlink run path refused')
}
const owner = JSON.parse(
  await readFile(`${m.worktree}/.amcore/stands/${m.id}/lease/owner.json`, 'utf8')
)
if (owner.token !== token || m.runToken !== token) throw new Error('Managed run lease mismatch')
await new Promise((resolve, reject) => {
  if (m.controlSocket !== `/private/tmp/amcore-${m.uuid}.sock`)
    throw new Error('Foreign control socket')
  const socket = connect(m.controlSocket)
  socket.setTimeout(3000, () => socket.destroy(new Error('Run supervisor unavailable')))
  socket.on('error', reject)
  socket.once('connect', () => socket.end(token))
  let result = ''
  socket.on('data', (data) => {
    result += data
  })
  socket.on('end', () =>
    result === targetProof(m) ? resolve() : reject(new Error('Run generation/target mismatch'))
  )
})
console.log(JSON.stringify(m))
