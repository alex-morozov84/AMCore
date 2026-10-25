// Server-side request statistics from the Caddy test-entry access log (JSON lines).
//   node stats.mjs <log-dir> <from-epoch> <to-epoch>   → JSON on stdout, exit 1 on bad data
// Reads load-test-access.log and its rolled files (plain or .gz) once each, so a roll during
// a step loses or doubles nothing. An empty window or an unreadable line is an error.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { gunzipSync } from 'node:zlib'

const LOG = /^load-test-access(-[0-9T.:-]+)?\.log(\.gz)?$/

export function readRecords(dir) {
  const records = []
  for (const name of readdirSync(dir)
    .filter((n) => LOG.test(n))
    .sort()) {
    const raw = readFileSync(join(dir, name))
    const text = (name.endsWith('.gz') ? gunzipSync(raw) : raw).toString('utf8')
    text.split('\n').forEach((line, i) => {
      if (!line.trim()) return
      let r
      try {
        r = JSON.parse(line)
      } catch {
        throw new Error(`${name}:${i + 1}: not a JSON log record`)
      }
      if (
        typeof r.ts !== 'number' ||
        typeof r.duration !== 'number' ||
        typeof r.status !== 'number'
      )
        throw new Error(`${name}:${i + 1}: record lacks ts, duration or status`)
      records.push(r)
    })
  }
  return records
}

// Route class: path without query, organization ids and the locale prefix folded.
export function routeClass(uri) {
  return String(uri ?? '')
    .replace(/\?.*$/, '')
    .replace(/\/organizations\/[^/]+(?=\/|$)/, '/organizations/:id')
    .replace(/^\/[a-z]{2}(-[A-Z]{2})?(?=\/)/, '/:locale')
}

export function percentiles(values) {
  const a = [...values].sort((x, y) => x - y)
  const at = (q) => a[Math.min(a.length - 1, Math.max(0, Math.ceil((a.length * q) / 100) - 1))]
  return { n: a.length, p50: at(50) * 1000, p95: at(95) * 1000, p99: at(99) * 1000 }
}

// Caddy routes access logs by host name, not by port, so the same file also receives the
// :80 requests for these names (ACME validation, HTTP redirects). Only a request with a
// verified client certificate came through the :8443 test entry.
export const isTestEntry = (r) => Boolean(r.request?.tls?.client_common_name)

export function windowStats(records, from, to) {
  if (!(from < to)) throw new Error('measured window is empty or reversed')
  const timed = records.filter((r) => r.ts >= from && r.ts < to)
  const inWindow = timed.filter(isTestEntry)
  if (!inWindow.length) throw new Error(`no test-entry records between ${from} and ${to}`)
  const status = {}
  const byRoute = {}
  for (const r of inWindow) {
    status[r.status] = (status[r.status] ?? 0) + 1
    ;(byRoute[routeClass(r.request?.uri)] ??= []).push(r.duration)
  }
  const routes = Object.fromEntries(
    Object.entries(byRoute)
      .sort()
      .map(([k, v]) => [k, percentiles(v)])
  )
  return {
    from,
    to,
    requests: inWindow.length,
    // Same names on another entry (port 80) in the window: reported, never counted.
    otherEntryRecords: timed.length - inWindow.length,
    status,
    all: percentiles(inWindow.map((r) => r.duration)),
    routes,
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [dir, from, to] = process.argv.slice(2)
  try {
    console.log(JSON.stringify(windowStats(readRecords(dir), Number(from), Number(to))))
  } catch (error) {
    console.error(`stats: ${error.message}`)
    process.exit(1)
  }
}
