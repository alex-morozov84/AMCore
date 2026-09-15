import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

function flagValue(scenario, name) {
  return scenario.flags.find((flag) => flag.startsWith(`--${name}=`))?.split('=')[1]
}

function assertLocale(root, scenario) {
  const locale = flagValue(scenario, 'locale')
  if (!locale) return
  const other = locale === 'en' ? 'ru' : 'en'
  assert.equal(existsSync(path.join(root, 'apps/web/src/app/[locale]')), false)
  assert.equal(existsSync(path.join(root, `apps/web/messages/${locale}.json`)), true)
  assert.equal(existsSync(path.join(root, `apps/web/messages/${other}.json`)), false)
  const context = readFileSync(path.join(root, 'PROJECT_CONTEXT.md'), 'utf8')
  assert.match(context, new RegExp(`\\*\\*base_locale:\\*\\* ${locale}`))
}

function assertStorybook(root, scenario) {
  if (flagValue(scenario, 'storybook') !== 'disabled') return
  assert.equal(existsSync(path.join(root, 'apps/web/.storybook')), false)
  const packageJson = readFileSync(path.join(root, 'apps/web/package.json'), 'utf8')
  assert.doesNotMatch(packageJson, /storybook/i)
}

function assertRouteProgress(root, scenario) {
  if (flagValue(scenario, 'route-progress') !== 'disabled') return
  const flag = readFileSync(
    path.join(root, 'apps/web/src/shared/lib/route-progress/route-progress-flag.ts'),
    'utf8'
  )
  assert.match(flag, /export const ROUTE_PROGRESS_ENABLED = false/)
}

function assertHostProxy(root, scenario, slug) {
  const nginx = readFileSync(path.join(root, 'docker/nginx/operations-console.conf'), 'utf8')
  const caddy = readFileSync(path.join(root, 'docker/caddy/Caddyfile.console-host'), 'utf8')
  const single = scenario.factors.proxy === 'single-host'
  const nginxRewrite = single ? `/${slug}/$1 break` : `/$1/${slug}$2 break`
  const caddyRewrite = single ? `/${slug}{path}` : `/{re.consolePage.1}/${slug}{re.consolePage.2}`
  assert.ok(nginx.includes(nginxRewrite))
  assert.ok(caddy.includes(caddyRewrite))
  assert.equal(nginx.includes('location ~* "\\.[a-z0-9]{1,16}$"'), single)
  assert.equal(caddy.includes('@staticAsset path_regexp staticAsset'), single)
}

function assertConsole(root, scenario) {
  const mode = flagValue(scenario, 'admin-console') ?? 'path'
  const configPath = path.join(root, 'apps/web/src/shared/lib/admin-console.generated.ts')
  if (mode === 'disabled') {
    assert.equal(existsSync(configPath), false)
    return
  }
  const slug = flagValue(scenario, 'admin-console-slug') ?? 'admin'
  const config = readFileSync(configPath, 'utf8')
  assert.match(config, new RegExp(`mode: '${mode}'`))
  assert.match(config, new RegExp(`slug: '${slug}'`))
  if (mode === 'host') assertHostProxy(root, scenario, slug)
}

async function assertSingleLocaleUrl(root, scenario) {
  if (flagValue(scenario, 'locale') !== 'en') return
  const dist = pathToFileURL(path.join(root, 'packages/shared/dist/index.js')).href
  const { localizedFrontendUrl } = await import(dist)
  assert.equal(
    localizedFrontendUrl('https://example.com', 'en', 'reset-password', { token: 'abc' }),
    'https://example.com/reset-password?token=abc'
  )
}

export async function assertGeneratedScaffold(root, scenario) {
  assertLocale(root, scenario)
  assertStorybook(root, scenario)
  assertRouteProgress(root, scenario)
  assertConsole(root, scenario)
  await assertSingleLocaleUrl(root, scenario)
}
