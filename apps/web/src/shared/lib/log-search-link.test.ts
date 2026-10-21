import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  LOG_SEARCH_RANGE,
  logSearchHref,
  logSearchQuery,
  type LogSearchTarget,
  LOKI_DATASOURCE_UID,
} from './log-search-link'

const repoFile = (path: string) => readFileSync(resolve(__dirname, '../../../../..', path), 'utf8')
const target = (baseUrl: string): LogSearchTarget => ({ kind: 'grafana-loki', baseUrl })

/** Reads the Explore state back out of an address, like Grafana does. */
function decode(href: string) {
  const url = new URL(href)
  return {
    url,
    panes: JSON.parse(url.searchParams.get('panes') ?? '{}') as Record<
      string,
      {
        datasource: string
        range: unknown
        queries: { refId: string; expr: string; editorMode: string; datasource: unknown }[]
      }
    >,
  }
}

describe('logSearchHref', () => {
  it('opens Explore with the one-job query, the overlay data source and the fixed range', () => {
    const href = logSearchHref(target('http://localhost:3002/'), 'abc-123')
    expect(href).not.toBeNull()
    const { url, panes } = decode(href!)
    expect(url.origin + url.pathname).toBe('http://localhost:3002/explore')
    expect(url.searchParams.get('schemaVersion')).toBe('1')
    expect(url.searchParams.get('orgId')).toBe('1')
    const [key, pane] = Object.entries(panes)[0]!
    expect(key).toMatch(/^[a-z0-9]{3}$/i)
    expect(key).not.toMatch(/^\d+$/)
    expect(pane.datasource).toBe(LOKI_DATASOURCE_UID)
    expect(pane.range).toEqual(LOG_SEARCH_RANGE)
    expect(pane.queries).toHaveLength(1)
    expect(pane.queries[0]).toMatchObject({
      refId: 'A',
      expr: '{service=~"api|worker"} |= "abc-123"',
      editorMode: 'code',
      datasource: { type: 'loki', uid: LOKI_DATASOURCE_UID },
    })
  })

  it.each([
    ['https://host.example.com/grafana', 'https://host.example.com/grafana/explore'],
    ['https://host.example.com/grafana/', 'https://host.example.com/grafana/explore'],
    ['https://host.example.com/d/x?orgId=2#panel', 'https://host.example.com/d/x/explore'],
  ])('keeps the sub-path of %s and drops its query and hash', (base, explore) => {
    const { url } = decode(logSearchHref(target(base), 'job1')!)
    expect(url.origin + url.pathname).toBe(explore)
    expect(url.hash).toBe('')
  })

  it.each(['a:b.c_d-e', 'Z'.repeat(128), 'req-55'])('accepts the well-formed ID %s', (id) => {
    expect(logSearchHref(target('http://localhost:3002/'), id)).not.toBeNull()
  })

  it.each(['', 'a b', 'a"b', 'a\\b', '{x}', 'a|b', '日本', 'x'.repeat(129), 'a\nb', '../x'])(
    'gives no link for the ID %j',
    (id) => {
      expect(logSearchHref(target('http://localhost:3002/'), id)).toBeNull()
    }
  )

  it('encodes the whole state in one parameter, so no part of it can add a parameter', () => {
    const href = logSearchHref(target('http://localhost:3002/'), 'a.b:c-d_e')!
    const query = new URL(href).search
    expect([...new URLSearchParams(query).keys()].sort()).toEqual([
      'orgId',
      'panes',
      'schemaVersion',
    ])
    expect(href).not.toContain('"')
  })
})

describe('the query and the data source are the ones the overlay documents and provisions', () => {
  it('equals the "One queued job" row of the log-search guide', () => {
    const row = repoFile('docs/operations/log-search.md')
      .split('\n')
      .find((line) => line.startsWith('| One queued job'))
    expect(row).toBeDefined()
    const cell = row!
      .split(/(?<!\\)\|/)[2]!
      .trim()
      .replace(/\\\|/g, '|')
    expect(cell).toBe(`\`${logSearchQuery('<jobId>')}\``)
  })

  it('uses the uid that the Grafana provisioning file defines', () => {
    const provisioned = repoFile('docker/log-search/grafana/provisioning/datasources/loki.yml')
    expect(provisioned).toMatch(new RegExp(`^\\s+uid: ${LOKI_DATASOURCE_UID}$`, 'm'))
  })
})
