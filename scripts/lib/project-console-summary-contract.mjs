import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const overview = 'apps/web/src/_pages/console/OverviewPage/'
const stories = ['OverviewProblems.stories.tsx', 'OverviewFileObservations.stories.tsx']
const modules = ['console-metrics-target', 'console-metrics-link']
const read = (root, name) => readFileSync(path.join(root, name), 'utf8')

export function checkSummaryProjection(root, flags) {
  const disabled = flags.includes('--admin-console=disabled')
  if (disabled) {
    for (const name of [
      overview,
      'apps/web/e2e/shared/overview-summary-journey.ts',
      'scripts/stand/console-summary-fixture.mjs',
      'docker/testing/console-summary',
      ...modules.flatMap((name) => [
        `apps/web/src/shared/lib/${name}.ts`,
        `apps/web/src/shared/lib/${name}.test.ts`,
      ]),
    ])
      assert.equal(existsSync(path.join(root, name)), false, name)
    for (const name of [
      '.env.example',
      'docker-compose.yml',
      'scripts/stand/config.mjs',
      'scripts/stand/create.mjs',
      'scripts/stand/start.mjs',
      'scripts/stand.mjs',
      'scripts/stand/config-proof.test.mjs',
      'apps/web/e2e/support/managed-target.d.mts',
      'docs/README.md',
      'docs/operations/local-stands.md',
      'CHANGELOG.md',
    ])
      assert.doesNotMatch(
        read(root, name),
        /ADMIN_CONSOLE_METRICS_GRAFANA_URL|console-summary|SUMMARY_|PROBLEM_SUMMARY_|Metrics around this time|overview\.md#find-what-needs-checking|metrics\?: string/,
        name
      )
    const config = read(root, 'scripts/stand/config.mjs')
    assert.match(
      config,
      /const expectedApi = apiTargets\[m\.fixtureProfile\] \?\? 'http:\/\/api:5002'/
    )
    assert.match(config, /API_URL !== expectedApi/)
    assert.match(config, /Foreign invitation HTTP origin/)
    for (const name of [
      'docs/operations/runbooks/db.md',
      'apps/api/src/core/admin/admin-overview.service.ts',
    ])
      assert.ok(existsSync(path.join(root, name)), name)
    assert.match(read(root, 'docs/operations/runbooks/db.md'), /## Database check failed/)
    return
  }
  assert.match(read(root, overview + 'overview-file-problems.ts'), /privateObservation/)
  for (const name of modules)
    assert.ok(existsSync(path.join(root, `apps/web/src/shared/lib/${name}.ts`)))
  const noStories = flags.includes('--storybook=disabled')
  for (const story of stories)
    assert.equal(existsSync(path.join(root, overview + story)), !noStories)
  if (!flags.includes('--mode=single')) return
  const locale = flags.includes('--locale=ru') ? 'ru' : 'en'
  const other = locale === 'en' ? 'ru' : 'en'
  if (!noStories) {
    const provider = read(root, 'apps/web/.storybook/preview.tsx')
    assert.match(provider, new RegExp(`/messages/${locale}\\.json`))
    assert.doesNotMatch(provider, new RegExp(`/messages/${other}\\.json`))
    for (const story of stories) {
      const text = read(root, overview + story)
      assert.match(text, new RegExp(`/messages/${locale}\\.json`))
      assert.doesNotMatch(text, new RegExp(`/messages/${other}\\.json`))
    }
    const text = read(root, overview + stories[1])
    assert.match(text, /locale=\{russianLocale\} messages=\{ru\}/)
    assert.match(text, /SUPPORTED_LOCALES/)
    assert.match(text, /baseCopy\('fileOverviewResult'/)
  }
  for (const name of [
    'apps/web/e2e/real-stack/admin-overview.spec.ts',
    'apps/web/e2e/console-real-stack/overview.spec.ts',
    'apps/web/e2e/shared/overview-summary-journey.ts',
  ]) {
    const text = read(root, name)
    assert.doesNotMatch(text, /\\?\/(?:en|ru)\\?\//, name)
    assert.doesNotMatch(text, /locale switcher|locale switch preserves/, name)
    assert.match(text, /DEFAULT_LOCALE/, name)
  }
}
