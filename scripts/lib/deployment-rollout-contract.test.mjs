import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
const section = (text, start, end) =>
  text.slice(text.indexOf(start), text.indexOf(end, text.indexOf(start)))
const deployment = read('docs/operations/deployment.md')
const singleHost = read('docs/operations/single-host-compose.md')

function assertOrderedStarts(text, expected) {
  const lines = text.split('\n').filter((line) => /^docker compose up /.test(line))
  assert.equal(lines.length, expected.length)
  for (const [index, service] of expected.entries()) {
    assert.match(lines[index], /--no-build\b/)
    assert.match(lines[index], /--no-deps\b/)
    assert.match(lines[index], /--wait\b/)
    assert.match(lines[index], /--wait-timeout 180\b/)
    assert.ok(lines[index].endsWith(` ${service}`), `expected ${service}`)
  }
}

const fresh = section(deployment, 'Then start\nservices in this order', '### Registry upgrades')
test('ordered registry startup cannot traverse dependencies back to migrate', () => {
  assertOrderedStarts(fresh, ['worker', 'api web', 'caddy'])
})

test('the rollout contract rejects the historical Caddy dependency regression', () => {
  const regression = fresh.replace(
    '--no-deps --wait --wait-timeout 180 caddy',
    '--wait --wait-timeout 180 caddy'
  )
  assert.notEqual(regression, fresh)
  assert.throws(() => assertOrderedStarts(regression, ['worker', 'api web', 'caddy']))
})

for (const [name, text] of [
  [
    'registry upgrade',
    section(deployment, '### Registry upgrades', '### Verify the deployed artifact'),
  ],
  [
    'local-build upgrade',
    section(deployment, '### Upgrades (new migrations', 'Workers go first because'),
  ],
  ['single-host upgrade', section(singleHost, '## Upgrades', '## Visitor IP')],
])
  test(`${name} waits for the worker before API/web without repeated migration`, () => {
    assertOrderedStarts(text, ['worker', 'api web'])
    const migration = text.indexOf('docker compose run --rm --no-deps migrate')
    assert.ok(migration >= 0)
    assert.ok(migration < text.indexOf('docker compose up '))
  })

test('single-host first start waits without revisiting completed migration', () => {
  assertOrderedStarts(section(singleHost, '## 7. Start the stack', '## 8. Verify'), [
    'worker',
    'api web',
    'caddy',
  ])
})

test('migrator preflight examples retain the complete installation overlay selection', () => {
  const guide = read('docs/operations/migrator-image.md')
  const text = guide.slice(guide.indexOf('### Endpoint preflight'))
  assert.doesNotMatch(text, /^docker compose -f /m)
  assert.match(text, /docker compose run --rm --no-deps migrate/)
})

test('production overlay delegates to the complete canonical rollout procedure', () => {
  const overlay = read('docker/compose/prod.yml')
  assert.doesNotMatch(overlay, /docker compose -f /)
  assert.match(overlay, /saved complete COMPOSE_FILE/)
  assert.match(overlay, /docs\/operations\/deployment.md/)
})

test('migration evidence stops before removal when execution or inspection fails', () => {
  const proof = section(deployment, 'docker compose run --name amcore-migration-proof', '\n```')
  const commands = proof.split('\n')
  assert.match(commands[0], /migrate \|\| exit 1$/)
  assert.match(commands[1], /amcore-migration-proof \|\| exit 1$/)
  assert.equal(commands[2], 'docker rm amcore-migration-proof')
})

test('single-host starts bundled Redis before no-deps worker startup', () => {
  const infrastructure = section(singleHost, '## 5. Start infrastructure', '## 6. Migrate')
  const starts = infrastructure.split('\n').filter((line) => /^docker compose up /.test(line))
  assert.equal(starts.length, 1)
  assert.match(starts[0], /--no-build --wait --wait-timeout 180 postgres redis$/)
  assert.throws(() =>
    assert.match(starts[0].replace(' postgres redis', ' postgres'), /postgres redis$/)
  )
})
