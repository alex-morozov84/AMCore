import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, test } from 'node:test'

import { materializeProjectContentPath } from './project-content-materializer.mjs'
import { createOperationRegistry } from './path-algebra-operation-registry.mjs'
import { planStructuralComposition } from './path-algebra-structural-compose.mjs'
import { registerRouteProgressStructuralOperations } from './project-route-progress-content.mjs'
import {
  ROUTE_PROGRESS_OPERATION_KEY,
  ROUTE_PROGRESS_SOURCE_PATH,
  routeProgressOwnership,
} from './project-route-progress-ownership.mjs'
import { validateOwnership } from './ownership-validate.mjs'
import { write } from './ownership-test-support.mjs'

const NOTE = ` *
 * This fork chose \`--route-progress=disabled\` at scaffold time, so the bar
 * starts off. Flip the line below to \`true\` to turn it back on — and keep
 * \`PROJECT_CONTEXT.md\`'s \`frontend_route_progress\` field truthful when you do.
`
const fact = {
  kind: 'content',
  dimension: 'route-progress',
  path: ROUTE_PROGRESS_SOURCE_PATH,
  operationKey: ROUTE_PROGRESS_OPERATION_KEY,
  params: { enabled: false },
}

let root
afterEach(() => root && rmSync(root, { recursive: true, force: true }))

function fixture(content) {
  root = mkdtempSync(path.join(tmpdir(), 'route-progress-content-'))
  write(root, ROUTE_PROGRESS_SOURCE_PATH, content)
  write(root, 'apps/web/tsconfig.json', '{"compilerOptions":{}}\n')
  return root
}

function materialize(content) {
  const fixtureRoot = fixture(content)
  return materializeProjectContentPath(fixtureRoot, ROUTE_PROGRESS_SOURCE_PATH, [fact]).after
}

test('finds the exported const structurally and changes its initializer to false', () => {
  const before = `import { keep } from './keep'\n\n/** Keep this custom explanation. */\nexport const ROUTE_PROGRESS_ENABLED: boolean = true // keep formatting\n\nexport const OTHER = keep\n`
  const after = materialize(before)
  assert.match(after, /ROUTE_PROGRESS_ENABLED: boolean = false \/\/ keep formatting/)
  assert.ok(after.includes("import { keep } from './keep'"))
  assert.ok(after.includes('Keep this custom explanation.'))
  assert.ok(after.includes('export const OTHER = keep'))
  assert.equal(after.replace(NOTE, '').replace('false', 'true'), before)
})

test('fails closed when the semantic const is missing or ambiguous', () => {
  const missing = '/** unrelated */\nexport const OTHER = true\n'
  assert.throws(() => materialize(missing), /missing-semantic-node.*ROUTE_PROGRESS_ENABLED/)
  assert.equal(readFileSync(path.join(root, ROUTE_PROGRESS_SOURCE_PATH), 'utf8'), missing)
  const duplicate = `/** first */\nexport const ROUTE_PROGRESS_ENABLED = true\n/** second */\nexport const ROUTE_PROGRESS_ENABLED = true\n`
  assert.throws(() => materialize(duplicate), /ambiguous-semantic-node.*ROUTE_PROGRESS_ENABLED/)
})

test('M3 seam validation rejects a missing or duplicated semantic anchor', () => {
  const fixtureRoot = fixture('/** flag */\nexport const ROUTE_PROGRESS_ENABLED = true\n')
  assert.doesNotThrow(() => validateOwnership(fixtureRoot, routeProgressOwnership))
  write(fixtureRoot, ROUTE_PROGRESS_SOURCE_PATH, '/** flag */\nexport const OTHER = true\n')
  assert.throws(
    () => validateOwnership(fixtureRoot, routeProgressOwnership),
    /route-progress\.source-default expected 1 semantic matches, found 0/
  )
  write(
    fixtureRoot,
    ROUTE_PROGRESS_SOURCE_PATH,
    '/** flag */\nexport const ROUTE_PROGRESS_ENABLED = ROUTE_PROGRESS_ENABLED\n'
  )
  assert.throws(
    () => validateOwnership(fixtureRoot, routeProgressOwnership),
    /route-progress\.source-default expected 1 semantic matches, found 2/
  )
})

test('the route-progress semantic claim conflicts before adapter application', () => {
  const registry = createOperationRegistry()
  registerRouteProgressStructuralOperations(registry)
  registry.define('test.enable-route-progress', {
    paramsSchema: () => true,
    deriveSemanticWrites: () => [
      { location: 'ts:exported-const:ROUTE_PROGRESS_ENABLED:initializer', value: true },
    ],
    adapter: () => {},
  })
  assert.throws(
    () =>
      planStructuralComposition(registry, [
        { ...fact, kind: 'structural' },
        {
          kind: 'structural',
          dimension: 'test',
          path: ROUTE_PROGRESS_SOURCE_PATH,
          operationKey: 'test.enable-route-progress',
          params: {},
        },
      ]),
    /semantic-write-conflict.*ROUTE_PROGRESS_ENABLED:initializer/
  )
})
