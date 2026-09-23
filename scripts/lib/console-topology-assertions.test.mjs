import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import {
  assertConsoleTopologyAssertions,
  scanConsoleTopologyAssertions,
} from './console-topology-assertions.mjs'

const file = 'apps/web/src/_pages/console/UsersPage/UsersPage.test.tsx'
const scan = (source) => scanConsoleTopologyAssertions(file, source)

test('current Console UI assertions have explicit topology inputs', () => {
  assert.doesNotThrow(() => assertConsoleTopologyAssertions())
})

test('a default Console href assertion without local input fails with file and line', () => {
  const failures = scan(
    "it('route', () => { expect(link).toHaveAttribute('href', '/admin/users') })"
  )
  assert.equal(failures.length, 1)
  assert.match(failures[0], /UsersPage\.test\.tsx:1: hardcoded Console href/)
  assert.match(failures[0], /getConsole\*Href\(\)/)
})

test('test-local baseHref and a called fixture helper authorize matching assertions', () => {
  const direct = `it('route', () => {
    const page = UsersOutOfRange({ baseHref: '/en/admin/users' })
    expect(link).toHaveAttribute('href', '/en/admin/users?sortBy=createdAt')
  })`
  const helper = `function renderInput() { return <SearchInput baseHref="/en/admin/users" /> }
    it('route', () => {
      renderInput()
      expect(replaceMock).toHaveBeenCalledWith('/en/admin/users?search=alice')
    })`
  assert.deepEqual(scan(direct), [])
  assert.deepEqual(scan(helper), [])
})

test('pure URL-builder input and explicit path/host config are allowed', () => {
  const builder = `it('route', () => {
    expect(buildDiscoveryHref('/en/admin/users', { page: 1 })).toBe('/en/admin/users?page=1')
  })`
  const topology = `it('route', () => {
    mutableConfig.mode = 'path'
    mutableConfig.slug = 'admin'
    expect(getConsoleUsersHref()).toBe('/admin/users')
  })`
  assert.deepEqual(scan(builder), [])
  assert.deepEqual(scan(topology), [])
})

test('mocks and backend API paths remain outside this guard', () => {
  const source = `vi.mock('navigation', () => ({ usePathname: () => '/admin/users' }))
    it('api', () => {
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/admin/users')
      expect(fixtureMock).toHaveBeenCalledWith('/admin/users')
    })`
  assert.deepEqual(scan(source), [])
})

test('navigation-call values are checked while unrelated mocks are not', () => {
  const source = `it('route', () => {
    expect(pushMock).toHaveBeenCalledWith('/admin/users')
    expect(router.replace).toHaveBeenCalledWith('/ru/admin/users')
  })`
  assert.equal(scan(source).length, 2)
})

test('an unrelated fixture in another case does not exempt a bad assertion', () => {
  const source = `it('fixture', () => { const baseHref = '/admin/users' })
    it('bad', () => { expect(link).toHaveAttribute('href', '/admin/users') })`
  assert.equal(scan(source).length, 1)
})

test('a fixture introduced after an assertion cannot exempt it', () => {
  const source = `it('bad', () => {
    expect(link).toHaveAttribute('href', '/admin/users')
    const baseHref = '/admin/users'
  })`
  assert.equal(scan(source).length, 1)
})

test('the fast repository guard sees a new Console UI test file', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'amcore-console-url-'))
  try {
    const target = path.join(root, file)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(
      target,
      "it('route', () => expect(link).toHaveAttribute('href', '/admin/users'))\n"
    )
    assert.throws(() => assertConsoleTopologyAssertions(root), /UsersPage\.test\.tsx:1/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
