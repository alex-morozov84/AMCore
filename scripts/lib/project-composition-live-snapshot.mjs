import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { lstatSync, readFileSync, readlinkSync } from 'node:fs'
import path from 'node:path'

function publicPaths(root) {
  return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: root,
    encoding: 'utf8',
  })
    .split('\0')
    .filter(Boolean)
    .sort()
}

function pathRecord(root, relative) {
  const target = path.join(root, relative)
  let stat
  try {
    stat = lstatSync(target)
  } catch (error) {
    if (error.code === 'ENOENT') return `${relative}\0missing`
    throw error
  }
  if (stat.isSymbolicLink()) return `${relative}\0link\0${readlinkSync(target)}`
  if (!stat.isFile()) return `${relative}\0other\0${stat.mode & 0o7777}`
  const hash = createHash('sha256').update(readFileSync(target)).digest('hex')
  return `${relative}\0file\0${stat.mode & 0o7777}\0${hash}`
}

export function snapshotLivePublicTree(root) {
  const records = publicPaths(root).map((relative) => pathRecord(root, relative))
  return Object.freeze({
    fileCount: records.length,
    sha256: createHash('sha256').update(records.join('\n')).digest('hex'),
  })
}
