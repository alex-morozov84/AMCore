import assert from 'node:assert/strict'
import { test } from 'node:test'
import { migrationConnectionUrl } from '../../docker/migrator/connection-options.mjs'

const original =
  'postgresql://USER:PASSWORD@[::1]:5433/amcore?schema=public&sslmode=require&sslcert=%2Ftmp%2Fca.pem&channel_binding=require'
const withOptions = (options) => {
  const url = new URL(original)
  url.searchParams.set('options', options)
  return url.href
}

test('migration-only URL preserves credentials, target, TLS and the source URL', () => {
  const result = new URL(migrationConnectionUrl(original))
  const source = new URL(original)
  for (const key of ['username', 'password', 'host', 'pathname'])
    assert.equal(result[key], source[key])
  for (const [key, value] of source.searchParams) assert.equal(result.searchParams.get(key), value)
  assert.equal(result.searchParams.get('options'), '-c client_connection_check_interval=50ms')
  assert.equal(source.searchParams.has('options'), false)
})

for (const options of [
  '-c application_name=two\\ words',
  '-c application_name=ends-with-space\\ ',
  '-c application_name=back\\\\slash --search_path=core,public',
])
  test(`migration options preserve PostgreSQL escaping: ${options}`, () => {
    const result = new URL(migrationConnectionUrl(withOptions(options)))
    assert.equal(
      result.searchParams.get('options'),
      `${options} -c client_connection_check_interval=50ms`
    )
  })

for (const options of [
  '-c client_connection_check_interval=50ms',
  '-cclient_connection_check_interval=50',
  '--client_connection_check_interval=0.05s -c application_name=kept',
])
  test(`matching effective interval is not duplicated: ${options}`, () => {
    assert.equal(
      new URL(migrationConnectionUrl(withOptions(options))).searchParams.get('options'),
      options
    )
  })

for (const options of [
  '-c client_connection_check_interval=0',
  '--client_connection_check_interval=1s',
  '-c client_connection_check_interval=50ms -c client_connection_check_interval=50ms',
  '-c',
  '-c application_name=trailing\\',
  '-- -c application_name=ignored',
  '-c application_name=zero\0byte',
])
  test(`unsafe migration options refuse without exposing the URL: ${JSON.stringify(options)}`, () => {
    assert.throws(
      () => migrationConnectionUrl(withOptions(options)),
      (error) => {
        assert.doesNotMatch(error.message, /USER|PASSWORD|postgresql:\/\//)
        return /Malformed|Conflicting/.test(error.message)
      }
    )
  })

test('ambiguous URL, wrong protocol and explicitly pooled mode refuse safely', () => {
  for (const value of [
    'not a URL with PASSWORD',
    'https://USER:PASSWORD@localhost/amcore',
    `${original}&options=a&options=b`,
    `${original}&pgbouncer=true`,
  ])
    assert.throws(
      () => migrationConnectionUrl(value),
      (error) => {
        assert.doesNotMatch(error.message, /USER|PASSWORD/)
        return true
      }
    )
})
