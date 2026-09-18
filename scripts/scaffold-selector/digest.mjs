import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'

export function declarationDigest(rootPath) {
  const rootBytes = readFileSync(rootPath)
  const root = JSON.parse(rootBytes.toString('utf8'))
  const hash = createHash('sha256')
  hash.update(path.basename(rootPath)).update('\0').update(rootBytes).update('\0')
  for (const name of [...root.fragments].sort()) {
    const bytes = readFileSync(path.join(path.dirname(rootPath), name))
    hash.update(name).update('\0').update(bytes).update('\0')
  }
  return hash.digest('hex')
}
