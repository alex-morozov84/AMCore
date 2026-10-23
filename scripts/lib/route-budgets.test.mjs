import assert from 'node:assert/strict'
import { rmSync, symlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

import { createFixture } from './route-budgets-fixture.mjs'

/** Applies `mutate` to a fresh fixture and asserts the check fails with `message`. */
function failsWith(name, message, mutate) {
  test(name, () => {
    const fixture = createFixture()
    try {
      mutate(fixture)
      const result = fixture.run()
      assert.equal(result.status, 1, result.stdout + result.stderr)
      assert.match(result.stderr, message)
    } finally {
      fixture.cleanup()
    }
  })
}

const STATS = 'apps/web/.next/diagnostics/route-bundle-stats.json'
const MANIFEST = 'apps/web/.next/app-path-routes-manifest.json'
const CORE = 'apps/web/route-budgets.json'
const CONSOLE = 'apps/web/src/_pages/console/route-budgets.json'
const CONFIG = 'apps/web/src/shared/lib/admin-console.generated.ts'

test('a complete build within budget passes; redirects and _global-error need no row', () => {
  const fixture = createFixture()
  try {
    const result = fixture.run()
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /ok {3}app:\/ /)
    assert.match(result.stdout, /ok {3}admin-console:\/ /)
    assert.match(result.stdout, /ok {3}product-admin:\/organizations /)
    assert.doesNotMatch(result.stdout, /\/organizations\s.*route|_global-error/)
  } finally {
    fixture.cleanup()
  }
})

failsWith('missing stats file', /route-bundle-stats\.json is missing/, (f) =>
  rmSync(path.join(f.root, STATS))
)
failsWith('broken stats JSON', /not valid JSON/, (f) => f.write(STATS, '{'))
failsWith('missing build ID', /BUILD_ID is missing/, (f) =>
  rmSync(path.join(f.root, 'apps/web/.next/BUILD_ID'))
)
failsWith('empty build ID', /BUILD_ID is empty/, (f) => f.write('apps/web/.next/BUILD_ID', '\n'))
failsWith('empty stats', /has no rows/, (f) => f.write(STATS, []))
failsWith('unsupported Next version', /not a verified route-bundle-stats format/, (f) =>
  f.write('apps/web/node_modules/next/package.json', { version: '16.5.0' })
)
failsWith('empty manifest', /lists no pages/, (f) => f.write(MANIFEST, {}))
failsWith('page missing from stats', /misses pages: \/\[locale\]\/register/, (f) =>
  f.write(
    STATS,
    f.stats.filter((row) => row.route !== '/[locale]/register')
  )
)
failsWith('extra stats route', /unknown routes: \/\[locale\]\/extra/, (f) =>
  f.write(STATS, [...f.stats, { ...f.stats[0], route: '/[locale]/extra' }])
)
failsWith('missing chunk file', /chunk is missing/, (f) =>
  rmSync(path.join(f.web, '.next/static/chunks/c.js'))
)
failsWith('duplicate chunk', /repeats a chunk/, (f) =>
  f.write(
    STATS,
    f.stats.map((row, i) =>
      i
        ? row
        : {
            ...row,
            firstLoadChunkPaths: ['.next/static/chunks/a.js', '.next/static/chunks/a.js'],
            firstLoadUncompressedJsBytes: 200,
          }
    )
  )
)
failsWith('chunk escaping .next/static', /outside \.next\/static/, (f) => {
  writeFileSync(path.join(f.root, 'outside.js'), 'x'.repeat(100))
  symlinkSync(path.join(f.root, 'outside.js'), path.join(f.web, '.next/static/chunks/link.js'))
  f.write(
    STATS,
    f.stats.map((row, i) =>
      i ? row : { ...row, firstLoadChunkPaths: ['.next/static/chunks/link.js'] }
    )
  )
})
failsWith(
  'recorded sum differs from chunk files',
  /records 100 bytes but its chunks sum to 200/,
  (f) =>
    f.write(
      STATS,
      f.stats.map((row) =>
        row.route === '/[locale]/login' ? { ...row, firstLoadUncompressedJsBytes: 100 } : row
      )
    )
)
failsWith('report-only row with a missing chunk', /chunk is missing/, (f) =>
  f.write(
    STATS,
    f.stats.map((row) =>
      row.route === '/_not-found'
        ? { ...row, firstLoadChunkPaths: ['.next/static/chunks/gone.js'] }
        : row
    )
  )
)
failsWith('two routes normalize to one key', /both map to app:\/login/, (f) => {
  f.write(MANIFEST, { ...f.manifest, '/(plain)/login/page': '/login' })
  f.write(STATS, [...f.stats, { ...f.stats[1], route: '/login' }])
})
failsWith('route claimed by two scopes', /claimed by scopes product-admin, admin-console/, (f) =>
  f.write(CONFIG, "  enabled: true,\n  slug: 'manage',\n")
)
failsWith('duplicate key across budget files', /budgeted in both/, (f) =>
  f.write(CONSOLE, { routes: { 'admin-console:/': 200, 'app:/login': 200 } })
)
failsWith('unknown scope', /unknown scope "billing"/, (f) =>
  f.write(CORE, { routes: { ...f.routes, 'billing:/': 200 } })
)
failsWith('Console config missing while its seam is present', /Console config is missing/, (f) =>
  rmSync(path.join(f.root, CONFIG))
)
failsWith('Console config disabled while its seam is present', /needs enabled: true/, (f) =>
  f.write(CONFIG, "  enabled: false,\n  slug: 'admin',\n")
)
failsWith('page without a budget row', /app:\/register has no budget row/, (f) => {
  const { 'app:/register': _removed, ...routes } = f.routes
  f.write(CORE, { routes })
})
failsWith('budget row without a page', /app:\/gone is budgeted but is not a built page/, (f) =>
  f.write(CORE, { routes: { ...f.routes, 'app:/gone': 200 } })
)
failsWith('mandatory route left report-only', /product-admin:\/organizations is mandatory/, (f) =>
  f.write(CORE, { routes: { ...f.routes, 'product-admin:/organizations': 'report-only' } })
)
failsWith(
  'route over budget',
  /app:\/login first-load JS is 200 bytes, over its 150-byte budget/,
  (f) => f.write(CORE, { routes: { ...f.routes, 'app:/login': 150 } })
)
