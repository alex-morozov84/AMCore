import { readFile, lstat } from 'node:fs/promises'
import { dirname } from 'node:path'

export async function verifyRunnerRemoval(record) {
  if (!record.wrapper) return
  const leasePresent = await lstat(`${dirname(record.targetManifest)}/lease`).then(
    () => true,
    (error) => {
      if (error.code !== 'ENOENT') throw error
      return false
    }
  )
  const target = await readFile(record.targetManifest, 'utf8').then(JSON.parse, (error) => {
    if (error.code !== 'ENOENT') throw error
  })
  if (leasePresent || (target && target.state !== 'purged'))
    throw new Error(`Managed runner cleanup incomplete; retain recovery: ${record.targetManifest}`)
}
