import { chmod, lstat, mkdir, mkdtemp, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createHash } from 'node:crypto'
import { run } from './process.mjs'
import { readSnapshotSource } from './snapshot-source.mjs'

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
async function collect(root, destination) {
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
    const source = await readSnapshotSource(root, file)
    if (!source) continue
    hash.update(file).update('\0').update(source.content).update('\0')
    if (destination) {
      const target = join(destination, file)
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, source.content, { mode: source.mode })
      await chmod(target, source.mode)
    }
  }
  return hash.digest('hex')
}

export async function snapshot(root, destination) {
  // Resolve external aliases such as macOS /var once, while refusing a symlink as the checkout itself.
  const rootInfo = await lstat(root, { bigint: true })
  if (!rootInfo.isDirectory())
    throw new Error('Snapshot checkout must be a directory, not a symlink')
  const sourceRoot = await realpath(root)
  const sourceInfo = await lstat(sourceRoot, { bigint: true })
  if (sourceInfo.dev !== rootInfo.dev || sourceInfo.ino !== rootInfo.ino)
    throw new Error('Snapshot checkout changed during resolution')
  if (!destination) return collect(sourceRoot)
  await mkdir(dirname(destination), { recursive: true })
  const staging = await mkdtemp(join(dirname(destination), '.snapshot-'))
  try {
    const hash = await collect(sourceRoot, staging)
    await rename(staging, destination)
    return hash
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}
