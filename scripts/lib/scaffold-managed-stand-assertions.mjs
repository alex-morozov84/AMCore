import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export async function assertManagedStandProjection(root, scenario) {
  const enabled = scenario.factors.console !== 'disabled'
  const locale = scenario.factors.locales[0]
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, HUSKY: '0' }
  const help = execFileSync(process.execPath, ['scripts/stand.mjs', 'help'], {
    cwd: root,
    env,
    encoding: 'utf8',
  })
  assert.equal(help.includes('console-real-stack'), enabled)
  assert.match(help, /mocked\|real-stack/)
  const matrix = JSON.parse(
    execFileSync(process.execPath, ['scripts/e2e-ci.mjs', '--matrix'], {
      cwd: root,
      env,
      encoding: 'utf8',
    })
  )
  assert.equal(matrix.lane.includes('host'), enabled)
  assert.ok(matrix.lane.includes('path-standard'))
  assert.ok(matrix.lane.includes('safety'))
  assert.ok(matrix.lane.includes('mocked'))
  for (const file of [
    'scripts/stand/proxy-smoke.mjs',
    'scripts/stand/wrapper-cancellation.test.mjs',
    'scripts/run-console-session-e2e.mjs',
    'docker/compose/console-host.yml',
    'docker/testing/console-session-e2e.yml',
  ])
    assert.equal(existsSync(join(root, file)), enabled, file)
  for (const file of [
    'scripts/stand.mjs',
    'scripts/stand/process.mjs',
    'scripts/stand/preview.mjs',
    'scripts/stand/closeout.mjs',
    'apps/api/src/core/admin/admin-sessions.service.ts',
  ])
    assert.ok(existsSync(join(root, file)), file)
  const guide = readFileSync(join(root, 'docs/operations/local-stands.md'), 'utf8')
  assert.equal(guide.includes('console-real-stack'), enabled)
  assert.match(guide, /pnpm stand closeout/)
  if (!enabled) {
    const result = spawnSync(
      process.execPath,
      ['scripts/stand.mjs', 'e2e', '--lane', 'console-real-stack'],
      { cwd: root, env, encoding: 'utf8' }
    )
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Unknown lane/)
    assert.equal(existsSync(join(root, '.amcore')), false, 'reject before allocating runtime')
    for (const file of ['config.mjs', 'mock-environment.mjs'])
      assert.doesNotMatch(readFileSync(join(root, 'scripts/stand', file), 'utf8'), /ADMIN_CONSOLE_/)
    assert.doesNotMatch(
      readFileSync(join(root, 'CONTRIBUTING.md'), 'utf8'),
      /boot `docker compose.*first/
    )
  }
  const { previewLabels } = await import(
    pathToFileURL(join(root, 'scripts/stand/preview-labels.mjs')).href
  )
  const labels = await previewLabels({
    snapshot: root,
    baseLocale: locale,
    consoleEnabled: enabled,
  })
  assert.deepEqual(
    labels.product,
    locale === 'ru'
      ? { email: 'Email', password: 'Пароль', submit: 'Войти' }
      : { email: 'Email', password: 'Password', submit: 'Sign in' }
  )
  assert.equal(Boolean(labels.console), enabled)
  if (enabled) assert.equal(labels.console.submit, locale === 'ru' ? 'Войти' : 'Sign in')
}
