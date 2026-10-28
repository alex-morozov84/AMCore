// Synthetic regular trees only; resource lifecycle belongs to verify-recovery.mjs.
import assert from 'node:assert/strict'
import { mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileIo } from './recovery-file-proof.io.mjs'

export async function fileProof({ f, root, container, run }) {
  const data = join(f.directory, 'files')
  const archive = join(f.directory, 'file-archive')
  await mkdir(archive)
  for (const dir of [
    'objects/private',
    'objects/public',
    'meta/private',
    'public/public',
    'objects/.amcore-probes',
  ])
    await mkdir(join(data, dir), { recursive: true })
  const files = {
    'objects/private/secret': 'private bytes',
    'objects/public/avatar': 'avatar bytes',
    'meta/private/secret.json': '{"contentType":"text/plain"}',
    'public/public/avatar': 'avatar bytes',
  }
  for (const [file, bytes] of Object.entries(files)) await writeFile(join(data, file), bytes)
  await writeFile(join(data, 'objects/.amcore-probes/canary'), 'omit')
  const io = fileIo({ f, data, archive, root, container, run })
  const { invoke } = io
  try {
    await symlink('secret', join(data, 'objects/private/link'))
    await invoke('backup', false)
    await rm(join(data, 'objects/private/link'))
    await invoke('backup')
    await invoke('restore', false) // Refuse existing files before extracting.
    await rm(data, { recursive: true })
    await mkdir(data)
    await invoke('restore')
    for (const [file, bytes] of Object.entries(files))
      assert.equal(await io.runtime('cat "$1"', `/data/${file}`), bytes)
    await io.runtime(
      'test ! -e /data/objects/.amcore-probes/canary && test "$(stat -c %u /data/objects/private/secret)" = 1001 && touch /data/runtime-write'
    )
    await io.reset()
    await writeFile(join(archive, 'local-files.tar.sha256'), 'wrong')
    await invoke('restore', false)
    // A trusted-tool-shaped archive with a matching checksum must still reject links.
    await mkdir(join(data, 'objects'))
    await symlink('/not-a-restorable-object', join(data, 'objects/link'))
    await io.root(
      'tar -cf /archive/local-files.tar -C /data . && cd /archive && sha256sum local-files.tar > local-files.tar.sha256'
    )
    await rm(data, { recursive: true })
    await mkdir(data)
    await invoke('restore', false)
    console.log(
      'recovery: bytes/metadata/public copies, exclusions, uid1001, link/nonempty/checksum refusal PASS'
    )
  } finally {
    await io.reset()
  }
}
