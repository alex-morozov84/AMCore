import { constants } from 'node:fs'
import { open, stat } from 'node:fs/promises'
import { join } from 'node:path'

const directoryFlags = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
const fileFlags = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
// Darwin sys/fcntl.h. Node does not export this flag by name.
const noFollowAny = 0x20000000

// Anchor each lookup to the opened parent so a renamed path cannot redirect it.
async function openLinux(path) {
  let parent = await open('/', directoryFlags)
  const components = path.slice(1).split('/')
  try {
    for (const component of components.slice(0, -1)) {
      const next = await open(`/proc/self/fd/${parent.fd}/${component}`, directoryFlags)
      await parent.close()
      parent = next
    }
    return await open(`/proc/self/fd/${parent.fd}/${components.at(-1)}`, fileFlags)
  } catch (error) {
    if (error.code === 'ENOENT') {
      await stat(`/proc/self/fd/${parent.fd}`).catch((cause) => {
        throw new Error('Snapshot source isolation requires Linux /proc/self/fd', { cause })
      })
    }
    throw error
  } finally {
    await parent.close()
  }
}

async function openSource(path) {
  try {
    if (process.platform === 'darwin')
      return await open(path, constants.O_RDONLY | constants.O_NONBLOCK | noFollowAny)
    if (process.platform === 'linux') return await openLinux(path)
    throw new Error(`Snapshot source isolation is unavailable on ${process.platform}`)
  } catch (error) {
    if (error.code === 'ELOOP' || error.code === 'ENOTDIR')
      throw new Error('Source symlink or non-directory component refused: ' + path, {
        cause: error,
      })
    throw error
  }
}

function sameFile(before, after) {
  return (
    before.dev === after.dev &&
    before.ino === after.ino &&
    before.size === after.size &&
    before.ctimeNs === after.ctimeNs &&
    before.mtimeNs === after.mtimeNs
  )
}

export async function readSnapshotSource(root, file) {
  const path = join(root, file)
  const source = await openSource(path).catch((error) => {
    if (error.code !== 'ENOENT') throw error
  })
  if (!source) return
  try {
    const before = await source.stat({ bigint: true })
    if (!before.isFile()) throw new Error(`Unexpected source entry: ${file}`)
    const content = await source.readFile()
    const current = await openSource(path)
    try {
      if (!sameFile(before, await current.stat({ bigint: true })))
        throw new Error(`Snapshot source changed during read: ${file}`)
    } finally {
      await current.close()
    }
    return { content, mode: Number(before.mode & 0o777n) }
  } finally {
    await source.close()
  }
}
