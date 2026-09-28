import { mkdtemp, realpath, lstat, rmdir, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'

// /tmp is the Unix platform directory, independent of the runner's private TMPDIR.
export async function allocateControlSocket() {
  const parent = await realpath('/tmp')
  const directory = await mkdtemp(join(parent, 'amcore-control-'))
  return join(directory, 'control.sock')
}

export async function validateControlSocket(path) {
  const parent = await realpath('/tmp')
  if (
    typeof path !== 'string' ||
    Buffer.byteLength(path) > 103 ||
    !path.startsWith(`${parent}/amcore-control-`) ||
    !/^amcore-control-[a-zA-Z0-9]{6}$/.test(dirname(path).slice(parent.length + 1)) ||
    path !== join(dirname(path), 'control.sock')
  )
    throw new Error('Foreign control socket')
  const directory = await lstat(dirname(path))
  if (
    !directory.isDirectory() ||
    directory.isSymbolicLink() ||
    directory.uid !== process.getuid() ||
    (directory.mode & 0o777) !== 0o700
  )
    throw new Error('Unsafe control socket directory')
}

export async function removeControlDirectory(path) {
  await validateControlSocket(path)
  await rmdir(dirname(path))
}

export async function disposeControlSocket(path) {
  if (!path) return
  // Older completed runs retained their (now absent) macOS socket name.
  // No legacy/foreign location is mutated or adopted by this compatibility check.
  if (/^\/private\/tmp\/amcore-[0-9a-f-]{36}\.sock$/.test(path)) {
    const present = await lstat(path).then(
      () => true,
      (error) => {
        if (error.code !== 'ENOENT') throw error
        return false
      }
    )
    if (present)
      throw new Error('Legacy socket still exists; preserve recovery and inspect ownership')
    return
  }
  try {
    await validateControlSocket(path)
  } catch (error) {
    if (error.code === 'ENOENT') return
    throw error
  }
  const socket = await lstat(path).catch((error) => {
    if (error.code !== 'ENOENT') throw error
  })
  if (socket) {
    if (!socket.isSocket() || socket.uid !== process.getuid())
      throw new Error('Unproved control socket removal refused')
    await unlink(path)
  }
  await removeControlDirectory(path)
}
