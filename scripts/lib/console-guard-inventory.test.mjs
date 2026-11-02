import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { inspectConsoleGuards, inspectGuardFile } from './console-guard-inventory.mjs'

const MODULE = '@/shared/lib/console-host-guard'
const pageImport = `import { requireConsoleEnabled } from '${MODULE}'\n`
const routeImport = `import { withConsoleHostGuard } from '${MODULE}'\n`
const page = (text, { imported = true } = {}) =>
  inspectGuardFile('page.tsx', (imported ? pageImport : '') + text, 'page')
const route = (text, { imported = true } = {}) =>
  inspectGuardFile('route.ts', (imported ? routeImport : '') + text, 'route')

test('the real Console entrypoints all refuse first', () => {
  const result = inspectConsoleGuards(process.cwd())
  assert.ok(result.pages > 0 && result.routes > 0, 'inventory found nothing to check')
  assert.deepEqual(result.problems, [])
})

test('a page that starts with the guard passes', () => {
  assert.deepEqual(
    page('export default function P() {\n  requireConsoleEnabled()\n  return null\n}'),
    []
  )
})

test('negative: a page without the guard fails', () => {
  assert.equal(page('export default function P() {\n  return null\n}').length, 1)
})

test('negative: work before the guard fails', () => {
  const text =
    'export default async function P() {\n  const s = await session()\n  requireConsoleEnabled()\n}'
  assert.equal(page(text).length, 1)
})

test('negative: generateMetadata without the guard fails', () => {
  const text =
    'export function generateMetadata() {\n  return {}\n}\nexport default function P() {\n  requireConsoleEnabled()\n}'
  assert.equal(page(text).length, 1)
})

test('negative: a re-exported page cannot be checked and fails', () => {
  const problems = page("export { default } from './other'", { imported: false })
  assert.ok(problems.length >= 1)
  assert.match(problems[0], /must start with/)
})

test('negative: a guard declared in the file itself is not the real guard', () => {
  const text =
    'function requireConsoleEnabled() {}\nexport default function P() {\n  requireConsoleEnabled()\n  return null\n}'
  const problems = page(text, { imported: false })
  assert.equal(problems.length, 1)
  assert.match(problems[0], /declared in this file/)
})

test('negative: a guard imported from another module is not the real guard', () => {
  const text =
    "import { requireConsoleEnabled } from './fake'\nexport default function P() {\n  requireConsoleEnabled()\n}"
  const problems = page(text, { imported: false })
  assert.equal(problems.length, 1)
  assert.match(problems[0], /must be imported from/)
})

test('negative: a page guard that is called with an argument fails', () => {
  assert.equal(
    page('export default function P() {\n  requireConsoleEnabled(startWork())\n}').length,
    1
  )
})

test('negative: the guard must not be awaited or hidden in a nested call', () => {
  assert.equal(
    page('export default async function P() {\n  await requireConsoleEnabled()\n}').length,
    1
  )
  assert.equal(
    page('export default function P() {\n  return wrap(requireConsoleEnabled())\n}').length,
    1
  )
})

test('a route that returns the guard first passes, including alias and expression bodies', () => {
  const text =
    'function h(r: Request) {\n  return withConsoleHostGuard(r, async () => new Response())\n}\n' +
    'export const GET = h\nexport const POST = (r: Request) => withConsoleHostGuard(r, () => x(r))'
  assert.deepEqual(route(text), [])
})

test('a pure literal 405 refusal stub passes', () => {
  const text =
    'export const GET = (r: Request) => withConsoleHostGuard(r, () => x(r))\n' +
    "export const PUT = () => new Response(null, { status: 405, headers: { Allow: 'GET' } })"
  assert.deepEqual(route(text), [])
})

test('negative: a 405 response that computes its body is not a refusal stub', () => {
  const text = 'export const POST = () => new Response(startSideEffect(), { status: 405 })'
  assert.equal(route(text).length, 1)
})

test('negative: a 405 stub with a computed status or header value is not a stub', () => {
  assert.equal(route('export const POST = () => new Response(null, { status: code() })').length, 1)
  assert.equal(
    route(
      "export const POST = () => new Response(null, { status: 405, headers: { Allow: allow() } })"
    ).length,
    1
  )
  assert.equal(
    route('export const POST = () => new Response(null, { ...init, status: 405 })').length,
    1
  )
})

test('negative: a stub with extra statements is not a stub', () => {
  const text =
    'export function POST() {\n  start()\n  return new Response(null, { status: 405 })\n}'
  assert.equal(route(text).length, 1)
})

test('negative: the guard callback argument is evaluated before the guard', () => {
  const text = 'export const GET = (r: Request) => withConsoleHostGuard(r, startWork())'
  assert.equal(route(text).length, 1)
})

test('negative: the guard request argument must be a plain identifier', () => {
  const text = 'export const GET = (r: Request) => withConsoleHostGuard(await prepare(r), () => x())'
  assert.equal(route(text).length, 1)
  assert.equal(
    route('export const GET = (r: Request) => withConsoleHostGuard(r, () => x(), extra())').length,
    1
  )
})

test('negative: a route guard declared in the file itself is not the real guard', () => {
  const text =
    'function withConsoleHostGuard(r: Request, h: () => Response) { return h() }\n' +
    'export const GET = (r: Request) => withConsoleHostGuard(r, () => new Response())'
  assert.match(route(text, { imported: false })[0], /declared in this file/)
})

test('negative: awaiting before the guard fails', () => {
  const text =
    'export async function GET(r: Request, c: C) {\n  const p = await c.params\n  return withConsoleHostGuard(r, () => x(p))\n}'
  assert.equal(route(text).length, 1)
})

test('negative: a handler that does work and returns 200 fails', () => {
  assert.equal(
    route('export async function GET() {\n  return new Response(null, { status: 200 })\n}').length,
    1
  )
})

test('negative: a route file with no method export fails', () => {
  assert.equal(route('export const x = 1').length, 1)
})

// The folder to scan is named by the alias in `admin-console.json`; the mode must not matter.
test('the inventory follows the alias, also for a moved alias and a disabled Console', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'console-inventory-'))
  try {
    const file = (relative, text) => {
      const target = path.join(root, relative)
      mkdirSync(path.dirname(target), { recursive: true })
      writeFileSync(target, text)
    }
    file(
      'packages/shared/src/config/admin-console.json',
      JSON.stringify({ version: 1, mode: 'disabled', alias: 'office' })
    )
    const pages = 'apps/web/src/app/[locale]'
    file(
      `${pages}/office/page.tsx`,
      `${pageImport}export default function P() {\n  requireConsoleEnabled()\n}`
    )
    file(`${pages}/office/users/layout.tsx`, 'export default function L() {\n  return null\n}')
    // The old folder is not the Console any more and must not be inspected.
    file(`${pages}/admin/page.tsx`, 'export default function P() {\n  return null\n}')
    file(
      'apps/web/src/app/api/console/users/route.ts',
      `${routeImport}export const GET = (r: Request) => withConsoleHostGuard(r, () => x(r))`
    )
    const result = inspectConsoleGuards(root)
    assert.equal(result.pages, 2)
    assert.equal(result.routes, 1)
    assert.ok(result.problems.length >= 1)
    assert.ok(
      result.problems.every((problem) => /office[\\/]users[\\/]layout\.tsx/.test(problem)),
      `only the unguarded office layout is a problem: ${result.problems.join('; ')}`
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a missing alias folder is reported instead of passing with nothing to check', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'console-inventory-'))
  try {
    const target = path.join(root, 'packages/shared/src/config/admin-console.json')
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, JSON.stringify({ version: 1, mode: 'path', alias: 'office' }))
    const result = inspectConsoleGuards(root)
    assert.match(result.problems[0], /Console page folder is missing/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
