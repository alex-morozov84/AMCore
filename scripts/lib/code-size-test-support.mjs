import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const reporter = fileURLToPath(new URL('../code-size-report.mjs', import.meta.url))

export function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'amcore-size-report-'))
  function git(...args) {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
    if (result.status !== 0) throw new Error(result.stderr)
  }
  git('init', '-q')
  git('config', 'user.email', 'fixture@example.test')
  git('config', 'user.name', 'Fixture')
  git('commit', '--allow-empty', '-qm', 'initial')
  return {
    root,
    git,
    write(file, content) {
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
      writeFileSync(path.join(root, file), content)
      git('add', file)
    },
    run() {
      return spawnSync(process.execPath, [reporter], { cwd: root, encoding: 'utf8' })
    },
    close() {
      rmSync(root, { recursive: true, force: true })
    },
  }
}
