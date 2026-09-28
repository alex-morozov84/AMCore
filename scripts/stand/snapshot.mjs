import { copyFile, lstat, mkdir, readFile, readlink } from 'node:fs/promises'
import { dirname, join, resolve, relative } from 'node:path'
import { createHash } from 'node:crypto'
import { run } from './process.mjs'

const excluded = new Set([
  '.git',
  '.worktrees',
  '.amcore',
  'node_modules',
  '.next',
  'dist',
  'build',
  'coverage',
  '.turbo',
  '.pnpm-store',
  '.claude',
  '.codex',
  '.agents',
  '.ssh',
  'secrets',
  'generated',
])
export function admitSource(path) {
  const parts = path.split('/')
  return (
    parts[0] !== 'ai' &&
    !parts.some(
      (p) =>
        excluded.has(p) ||
        (p.startsWith('.env') && p !== '.env.example') ||
        ['.npmrc', '.netrc', '.envrc', 'id_rsa', 'id_ed25519'].includes(p) ||
        p.startsWith('playwright-report') ||
        p.startsWith('test-results') ||
        /\.(pem|key|log|tsbuildinfo)$/.test(p)
    )
  )
}
export async function snapshot(root, destination) {
  const files = (
    await run('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
      cwd: root,
      capture: true,
    })
  )
    .split('\0')
    .filter(Boolean)
    .filter(admitSource)
    .sort()
  const hash = createHash('sha256')
  for (const file of files) {
    const source = join(root, file)
    const target = destination ? join(destination, file) : undefined
    const info = await lstat(source).catch((e) => {
      if (e.code !== 'ENOENT') throw e
    })
    if (!info) continue
    if (info.isSymbolicLink()) {
      const link = resolve(dirname(source), await readlink(source))
      throw new Error(`Source symlink requires explicit admission: ${relative(root, link)}`)
    }
    if (!info.isFile()) throw new Error(`Unexpected source entry: ${file}`)
    const content = await readFile(source)
    hash.update(file).update('\0').update(content).update('\0')
    if (destination) {
      await mkdir(dirname(target), { recursive: true })
      await copyFile(source, target)
    }
  }
  return hash.digest('hex')
}
