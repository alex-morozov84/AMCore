import { isCorrelationId } from '@amcore/shared'

/**
 * Where "Find in logs" links point. A discriminated union so that another log tool adds a kind
 * here and in `logSearchHref`, and no component changes. `baseUrl` is an already validated address
 * (see `console-log-search-target.ts`).
 */
export type LogSearchTarget = { kind: 'grafana-loki'; baseUrl: string }

/**
 * The uid of the Loki data source that `docker/log-search/grafana/provisioning/datasources/loki.yml`
 * provisions. A Grafana of your own needs a Loki data source with this uid; a contract test keeps the
 * two in step.
 */
export const LOKI_DATASOURCE_UID = 'amcore-loki'

/** One range for every link: the default retention of the log-search overlay. */
export const LOG_SEARCH_RANGE = { from: 'now-7d', to: 'now' } as const

/** The services whose lines carry an ID: the API (request and command lines) and the worker. */
const LOG_SEARCH_SERVICES = 'api|worker'

/** Explore needs a pane key of three characters that are not all digits. */
const PANE_KEY = 'lgs'

/** The LogQL line filter of the log-search guide's "One queued job" row; a test pins the two. */
export function logSearchQuery(id: string): string {
  return `{service=~"${LOG_SEARCH_SERVICES}"} |= "${id}"`
}

/** The address of a Grafana whose path may be a sub-path (`https://host/grafana`), with no query or hash. */
function grafanaBase(baseUrl: string): string {
  const url = new URL(baseUrl)
  url.search = ''
  url.hash = ''
  if (!url.pathname.endsWith('/')) url.pathname += '/'
  return url.href
}

/**
 * The address that opens the log search for one ID, or `null` when the ID is not a well-formed
 * correlation ID (job, delivery, run and request IDs all are). The ID is the only caller input and
 * its character set cannot break out of the quoted LogQL string, nor of the encoded address.
 */
export function logSearchHref(target: LogSearchTarget, id: string): string | null {
  if (!isCorrelationId(id)) return null
  const panes = {
    [PANE_KEY]: {
      datasource: LOKI_DATASOURCE_UID,
      queries: [
        {
          refId: 'A',
          datasource: { type: 'loki', uid: LOKI_DATASOURCE_UID },
          expr: logSearchQuery(id),
          queryType: 'range',
          editorMode: 'code',
        },
      ],
      range: LOG_SEARCH_RANGE,
    },
  }
  return `${grafanaBase(target.baseUrl)}explore?schemaVersion=1&panes=${encodeURIComponent(JSON.stringify(panes))}&orgId=1`
}
