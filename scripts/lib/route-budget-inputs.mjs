// Reads and validates the build diagnostics a route budget is measured from. Every
// function fails closed: Next writes route-bundle-stats.json as an internal diagnostic
// and swallows missing-file errors while summing, so a well-formed file alone does not
// prove a complete measurement.
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import path from 'node:path'

export class RouteBudgetError extends Error {}

const fail = (message) => {
  throw new RouteBudgetError(message)
}

/** Next minors whose route-bundle-stats format was verified; re-verify before widening. */
export const SUPPORTED_NEXT = /^16\.4\.\d+$/

/** App routes Next itself leaves out of route-bundle-stats (`filterAndSortList`, 16.4). */
export const STATS_EXCLUDED_ROUTES = new Set(['/_global-error', '/favicon.ico'])

export function readJson(file, label) {
  if (!existsSync(file)) fail(`${label} is missing: ${file} (run the web build first)`)
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return fail(`${label} is not valid JSON: ${file}`)
  }
}

export function assertSupportedNext(version) {
  if (!SUPPORTED_NEXT.test(version ?? ''))
    fail(`Next ${version} is not a verified route-bundle-stats format (${SUPPORTED_NEXT})`)
}

/** The page routes Next should have measured: manifest `/page` keys mapped to their URLs. */
export function expectedPages(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest))
    fail('app-path-routes-manifest.json has an unexpected shape')
  const pages = Object.entries(manifest)
    .filter(([key]) => key.endsWith('/page'))
    .map(([, route]) => route)
    .filter((route) => !STATS_EXCLUDED_ROUTES.has(route))
  if (!pages.length) fail('app-path-routes-manifest.json lists no pages')
  if (new Set(pages).size !== pages.length) fail('app-path-routes-manifest.json repeats a page')
  return new Set(pages)
}

/** Validates the stats rows and returns them keyed by route. */
export function statsRows(stats) {
  if (!Array.isArray(stats) || !stats.length) fail('route-bundle-stats.json has no rows')
  const rows = new Map()
  for (const row of stats) {
    const { route, firstLoadUncompressedJsBytes: bytes, firstLoadChunkPaths: chunks } = row ?? {}
    if (typeof route !== 'string' || !Number.isSafeInteger(bytes) || bytes < 0)
      fail(`route-bundle-stats.json row has an unexpected shape: ${JSON.stringify(row)}`)
    if (!Array.isArray(chunks) || !chunks.length) fail(`${route} lists no first-load chunks`)
    if (rows.has(route)) fail(`route-bundle-stats.json repeats ${route}`)
    rows.set(route, { route, bytes, chunks })
  }
  return rows
}

/** The measured route set must equal the expected page set: nothing missing, nothing extra. */
export function assertSameRoutes(expected, rows) {
  const missing = [...expected].filter((route) => !rows.has(route))
  const extra = [...rows.keys()].filter((route) => !expected.has(route))
  if (missing.length) fail(`route-bundle-stats.json misses pages: ${missing.join(', ')}`)
  if (extra.length) fail(`route-bundle-stats.json has unknown routes: ${extra.join(', ')}`)
}

/** Re-sums each row from the chunk files and rejects missing, duplicate or escaping paths. */
export function assertChunks(webRoot, rows) {
  const staticRoot = realpathSync(path.join(webRoot, '.next/static'))
  for (const { route, bytes, chunks } of rows.values()) {
    if (new Set(chunks).size !== chunks.length) fail(`${route} repeats a chunk`)
    let sum = 0
    for (const chunk of chunks) {
      if (typeof chunk !== 'string' || !chunk.endsWith('.js'))
        fail(`${route} lists a non-JS chunk: ${chunk}`)
      const file = path.join(webRoot, chunk)
      if (!existsSync(file)) fail(`${route} chunk is missing: ${chunk}`)
      const real = realpathSync(file)
      if (!real.startsWith(staticRoot + path.sep))
        fail(`${route} chunk is outside .next/static: ${chunk}`)
      sum += statSync(real).size
    }
    if (sum !== bytes) fail(`${route} records ${bytes} bytes but its chunks sum to ${sum}`)
  }
}
