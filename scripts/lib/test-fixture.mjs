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

/**
 * A real, git-tracked-files-only copy of this repo's current `HEAD` in a
 * disposable tmpdir — for init:project tests, where a hand-written fixture
 * can't stand in for `apps/web`'s actual route tree (see
 * project-plan-web-structure.test.mjs and friends). `git archive` only
 * copies tracked files, so `ai/` (gitignored) is never present — same
 * safety property `createFixtureRepo()`'s guard tests rely on.
 */
export function createRealRepoCopy() {
  const root = mkdtempSync(path.join(tmpdir(), 'amcore-real-repo-copy-'))
  const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
  }).trim()

  execFileSync('sh', ['-c', `git archive HEAD | tar -x -C "${root}"`], {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

export function git(root, args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

/**
 * Installs a {@link createRealRepoCopy} copy's dependencies — `git archive`
 * only copies tracked files, so there is no `node_modules` yet. This is
 * test-harness setup, deliberately not something `runProjectVerification`
 * does itself (see verify.mjs's header): the real `init:project`/`init:brand`
 * CLIs run against a fork the owner already has installed, and must not
 * reach the network or rewrite `node_modules` as a side effect of a
 * migration. `CI=true` answers pnpm's own deps-status confirmation
 * non-interactively; resolved from the local store, so this does not hit
 * the network when the real repo's lockfile is already satisfied.
 */
export function installDependencies(root) {
  execFileSync('pnpm', ['install'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, CI: 'true' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

export function readFixtureFile(root, relPath) {
  return readFileSync(path.join(root, relPath), 'utf8')
}
