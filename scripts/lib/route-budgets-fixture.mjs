// Disposable repository layout for check-route-budgets.mjs tests: a minimal web build
// (stats, manifest, chunks), product-admin and Console config, and budget files.
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const scripts = path.resolve(import.meta.dirname, '..')
const CHUNK = 'x'.repeat(100)

/** Pages as `[manifestKey, route, chunkNames]`; chunk files hold 100 bytes each. */
export const PAGES = [
  ['/[locale]/(dashboard)/page', '/[locale]', ['a']],
  ['/[locale]/(auth)/login/page', '/[locale]/login', ['a', 'b']],
  ['/[locale]/(auth)/register/page', '/[locale]/register', ['a', 'b']],
  ['/[locale]/(dashboard)/settings/sessions/page', '/[locale]/settings/sessions', ['a']],
  ['/[locale]/(product-admin)/manage/page', '/[locale]/manage', ['a']],
  [
    '/[locale]/(product-admin)/manage/(protected)/organizations/page',
    '/[locale]/manage/organizations',
    ['a', 'c'],
  ],
  ['/[locale]/admin/(protected)/page', '/[locale]/admin', ['a']],
  ['/_not-found/page', '/_not-found', ['a']],
]

export function createFixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'route-budgets-'))
  const web = path.join(root, 'apps/web')
  const write = (file, content) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    writeFileSync(
      path.join(root, file),
      typeof content === 'string' ? content : JSON.stringify(content)
    )
  }
  cpSync(
    path.join(scripts, 'check-route-budgets.mjs'),
    path.join(root, 'scripts/check-route-budgets.mjs')
  )
  for (const lib of ['route-budget-inputs.mjs', 'route-budget-policy.mjs'])
    cpSync(path.join(scripts, 'lib', lib), path.join(root, 'scripts/lib', lib))
  write('apps/web/node_modules/next/package.json', { version: '16.4.2' })
  write('packages/shared/src/config/product-admin.json', { alias: 'manage' })
  write(
    'apps/web/src/shared/lib/admin-console.generated.ts',
    "export const ADMIN_CONSOLE_CONFIG = {\n  enabled: true,\n  mode: 'path',\n  slug: 'admin',\n}\n"
  )
  for (const name of ['a', 'b', 'c']) write(`apps/web/.next/static/chunks/${name}.js`, CHUNK)
  write('apps/web/.next/BUILD_ID', 'fixture-build')
  const manifest = Object.fromEntries(PAGES.map(([key, route]) => [key, route]))
  manifest['/[locale]/(organization-access)/organizations/route'] = '/[locale]/organizations'
  manifest['/_global-error/page'] = '/_global-error'
  write('apps/web/.next/app-path-routes-manifest.json', manifest)
  const stats = PAGES.map(([, route, chunks]) => ({
    route,
    firstLoadUncompressedJsBytes: chunks.length * CHUNK.length,
    firstLoadChunkPaths: chunks.map((name) => `.next/static/chunks/${name}.js`),
  }))
  write('apps/web/.next/diagnostics/route-bundle-stats.json', stats)
  const routes = {
    'app:/': 200,
    'app:/login': 200,
    'app:/register': 200,
    'app:/settings/sessions': 200,
    'app:/_not-found': 'report-only',
    'product-admin:/': 200,
    'product-admin:/organizations': 200,
  }
  write('apps/web/route-budgets.json', { routes })
  write('apps/web/src/_pages/console/route-budgets.json', { routes: { 'admin-console:/': 200 } })
  return {
    root,
    web,
    write,
    stats,
    manifest,
    routes,
    run: () =>
      spawnSync(process.execPath, ['scripts/check-route-budgets.mjs'], {
        cwd: root,
        encoding: 'utf8',
      }),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  }
}
