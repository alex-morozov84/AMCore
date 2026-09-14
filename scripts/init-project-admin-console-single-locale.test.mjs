import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, it } from 'node:test'
import { INIT_PROJECT, commit, runInitProject } from './lib/init-project-test-helpers.mjs'
import { createRealRepoCopy, git, installDependencies } from './lib/test-fixture.mjs'
import {
  ADMIN_CONSOLE_SINGLE_LOCALE_BUILD_STEPS,
  ADMIN_CONSOLE_SINGLE_LOCALE_SCENARIOS,
} from './lib/scaffold-scenario-recipes.mjs'

const copies = []
const OTHER_LOCALE = { en: 'ru', ru: 'en' }

afterEach(() => copies.splice(0).forEach((fixture) => fixture.cleanup()))

function copy() {
  const fixture = createRealRepoCopy()
  commit(fixture.root)
  copies.push(fixture)
  return fixture.root
}

function apply(root, args) {
  const result = runInitProject(root, [...args, '--yes'])
  assert.equal(result.status, 0, result.stderr)
}

function assertSingleLocale(root, locale, { mode = 'path', slug = 'admin' } = {}) {
  assert.equal(existsSync(path.join(root, 'apps/web/src/app/[locale]')), false)
  assert.equal(existsSync(path.join(root, `apps/web/messages/${locale}.json`)), true)
  assert.equal(existsSync(path.join(root, `apps/web/messages/${OTHER_LOCALE[locale]}.json`)), false)
  const context = readFileSync(path.join(root, 'PROJECT_CONTEXT.md'), 'utf8')
  assert.match(context, new RegExp(`\\*\\*base_locale:\\*\\* ${locale}`))
  if (mode === 'disabled') {
    assert.match(context, /\*\*admin_console:\*\* disabled/)
    assert.equal(
      existsSync(path.join(root, 'apps/web/src/shared/lib/admin-console.generated.ts')),
      false
    )
    return
  }
  assert.equal(existsSync(path.join(root, `apps/web/src/app/${slug}`)), true)
  const config = readFileSync(
    path.join(root, 'apps/web/src/shared/lib/admin-console.generated.ts'),
    'utf8'
  )
  assert.match(config, new RegExp(`mode: '${mode}'`))
  assert.match(config, new RegExp(`slug: '${slug}'`))
  if (mode === 'host') {
    const nginx = readFileSync(path.join(root, 'docker/nginx/operations-console.conf'), 'utf8')
    const caddy = readFileSync(path.join(root, 'docker/caddy/Caddyfile.console-host'), 'utf8')
    assert.match(nginx, new RegExp(`/${slug}/\\$1 break`))
    assert.match(nginx, new RegExp(`rewrite \\^ /${slug} break`))
    assert.ok(nginx.includes('location ~* "\\.[a-z0-9]{1,16}$"'))
    assert.match(caddy, new RegExp(`/${slug}\\{path\\}`))
    assert.match(caddy, new RegExp(`rewrite \\* /${slug}\\n`))
    assert.match(caddy, /@staticAsset path_regexp staticAsset/)
  }
}

function buildWeb(root) {
  installDependencies(root)
  for (const args of ADMIN_CONSOLE_SINGLE_LOCALE_BUILD_STEPS) {
    const result = spawnSync('pnpm', args, { cwd: root, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stdout + result.stderr)
  }
}

const SCENARIOS = [
  ['single en default', 'en', [], {}],
  ['single ru default', 'ru', [], {}],
  ['single en host default', 'en', ['--admin-console=host'], { mode: 'host' }],
  [
    'single ru host panel',
    'ru',
    ['--admin-console=host', '--admin-console-slug=panel'],
    { mode: 'host', slug: 'panel' },
  ],
  [
    'single en path panel',
    'en',
    ['--admin-console=path', '--admin-console-slug=panel'],
    { slug: 'panel' },
  ],
  ['single en disabled', 'en', ['--admin-console=disabled'], { mode: 'disabled' }],
  ['single ru disabled', 'ru', ['--admin-console=disabled'], { mode: 'disabled' }],
]

describe('init:project single-locale console topology', () => {
  for (const [name, locale, consoleArgs, expected] of SCENARIOS) {
    it(name, () => {
      const root = copy()
      apply(root, ['--mode=single', `--locale=${locale}`, ...consoleArgs])
      assertSingleLocale(root, locale, expected)
    })
  }

  it('builds representative retained and disabled outputs', () => {
    const expectedByName = {
      'admin-console-single-locale-ru-host-panel': { locale: 'ru', mode: 'host', slug: 'panel' },
      'admin-console-single-locale-en-disabled': { locale: 'en', mode: 'disabled' },
    }
    for (const scenario of ADMIN_CONSOLE_SINGLE_LOCALE_SCENARIOS) {
      const { locale, ...expected } = expectedByName[scenario.name]
      const root = copy()
      apply(
        root,
        scenario.flags.filter((flag) => flag !== '--yes')
      )
      assertSingleLocale(root, locale, expected)
      buildWeb(root)
    }
  })

  it('rejects occupied segments and leaves the fixture git-clean', () => {
    for (const slug of ['login', 'auth', 'settings', 'forgot-password']) {
      const root = copy()
      const result = runInitProject(root, [
        '--admin-console=host',
        `--admin-console-slug=${slug}`,
        '--yes',
      ])
      assert.match(result.stderr, /collides with an existing public route/)
      assert.equal(git(root, ['status', '--porcelain']), '')
    }
  })

  it('rejects a first-segment dynamic or catch-all route', () => {
    for (const segment of ['[slug]', '[...path]']) {
      const root = copy()
      const routeDir = path.join(root, 'apps/web/src/app/[locale]', segment)
      mkdirSync(routeDir)
      writeFileSync(
        path.join(routeDir, 'page.tsx'),
        'export default function Page() { return null }\n'
      )
      git(root, ['add', '.'])
      git(root, ['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-m', 'dynamic'])
      const result = runInitProject(root, [
        '--admin-console=host',
        '--admin-console-slug=panel',
        '--yes',
      ])
      assert.match(result.stderr, /collides with an existing public route/)
      assert.equal(git(root, ['status', '--porcelain']), '')
    }
  })

  it('prints the documented help without writing', () => {
    const result = spawnSync('node', [INIT_PROJECT, '--help'], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /--admin-console=disabled\|path\|host/)
    assert.match(result.stdout, /--admin-console-slug=<segment>/)
  })
})
