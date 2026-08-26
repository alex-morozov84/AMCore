// Builds a disposable, git-initialized fixture tree mirroring just the
// files init-brand touches, so scripts/init-brand.test.mjs can exercise the
// real entrypoint (via AMCORE_INIT_ROOT) instead of only its pure helpers.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

export function fakePng(width, height) {
  const buf = Buffer.alloc(24)
  PNG_SIGNATURE.copy(buf, 0)
  buf.writeUInt32BE(width, 16)
  buf.writeUInt32BE(height, 20)
  return buf
}

function write(root, relPath, content) {
  const full = path.join(root, relPath)
  mkdirSync(path.dirname(full), { recursive: true })
  writeFileSync(full, content)
}

export function createFixtureRepo() {
  const root = mkdtempSync(path.join(tmpdir(), 'amcore-init-brand-test-'))

  write(
    root,
    'PROJECT_CONTEXT.md',
    [
      '# Project Context',
      '',
      '## Identity',
      '',
      '- **Mode:** `upstream-starter`',
      '- **Product:** AMCore',
      '- **Purpose:** Continue development of AMCore.',
      '- **Canonical upstream:** https://github.com/example/amcore',
      '- **Workflow mode:** `strict` (protected main).',
      '- **initialized_from_amcore_version:** N/A — this checkout is AMCore itself.',
      '',
    ].join('\n')
  )
  write(
    root,
    'package.json',
    `${JSON.stringify({ name: 'amcore', version: '0.1.0', description: 'Production-oriented NestJS application starter' }, null, 2)}\n`
  )
  write(
    root,
    'apps/web/src/app/manifest.ts',
    [
      'export default function manifest() {',
      '  return {',
      "    name: 'AMCore',",
      "    short_name: 'AMCore',",
      "    description: 'Production-oriented application starter for secure, modular products.',",
      '  }',
      '}',
      '',
    ].join('\n')
  )
  write(
    root,
    'apps/web/src/shared/lib/theme.ts',
    "export const DEFAULT_THEME_SETTING: ThemeSetting = 'system'\n"
  )
  write(
    root,
    'apps/web/messages/en.json',
    `${JSON.stringify({ meta: { title: 'AMCore', description: 'Production-oriented application starter.' } }, null, 2)}\n`
  )
  write(
    root,
    'apps/web/messages/ru.json',
    `${JSON.stringify({ meta: { title: 'AMCore', description: 'Стартовый шаблон.' } }, null, 2)}\n`
  )

  git(root, ['init', '--quiet', '--initial-branch=main'])
  git(root, ['add', '-A'])
  git(root, [
    '-c',
    'user.name=test',
    '-c',
    'user.email=test@example.com',
    'commit',
    '--quiet',
    '-m',
    'fixture',
  ])

  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

export function git(root, args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

export function readFixtureFile(root, relPath) {
  return readFileSync(path.join(root, relPath), 'utf8')
}
