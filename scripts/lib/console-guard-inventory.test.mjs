import assert from 'node:assert/strict'
import { test } from 'node:test'

import { inspectConsoleGuards, inspectGuardFile } from './console-guard-inventory.mjs'

const page = (text) => inspectGuardFile('page.tsx', text, 'page')
const route = (text) => inspectGuardFile('route.ts', text, 'route')

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
  assert.equal(page("export { default } from './other'").length, 1)
})

test('a route that returns the guard first passes, including alias and expression bodies', () => {
  const text =
    'function h(r: Request) {\n  return withConsoleHostGuard(r, async () => new Response())\n}\n' +
    'export const GET = h\nexport const POST = (r: Request) => withConsoleHostGuard(r, () => x(r))'
  assert.deepEqual(route(text), [])
})

test('a pure 405 refusal stub passes', () => {
  const text =
    'export const GET = (r: Request) => withConsoleHostGuard(r, () => x(r))\n' +
    "export const PUT = () => new Response(null, { status: 405, headers: { Allow: 'GET' } })"
  assert.deepEqual(route(text), [])
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
