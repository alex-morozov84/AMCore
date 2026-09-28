import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmod, lstat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  allocateControlSocket,
  validateControlSocket,
  disposeControlSocket,
} from './control-socket.mjs'

test('private short socket admission refuses mode/path replacement; stale socket directory cleanup is verified', async () => {
  const path = await allocateControlSocket()
  const dir = dirname(path)
  assert.ok(Buffer.byteLength(path) <= 103)
  await validateControlSocket(path)
  await assert.rejects(() => validateControlSocket(`${dir}/other.sock`), /Foreign/)
  await chmod(dir, 0o755)
  await assert.rejects(() => validateControlSocket(path), /Unsafe/)
  await chmod(dir, 0o700)
  await writeFile(path, 'foreign regular file')
  await assert.rejects(() => disposeControlSocket(path), /Unproved/)
  const { unlink } = await import('node:fs/promises')
  await unlink(path)
  await disposeControlSocket(path)
  await assert.rejects(() => lstat(dir), { code: 'ENOENT' })
})
