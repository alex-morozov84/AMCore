import 'server-only'

/**
 * The read-only queue board (Bull Board) is reachable from the browser ONLY through its own Console
 * route (`app/api/console/bull-board`). The generic product proxy forwards any `/api/v1/*` path with
 * the caller's bearer token, and the board's mount accepts a bearer: without this closure a product
 * session — including one in host mode, where the Console must demand its own audience — could reach
 * the board through `/api/admin/queues/...`.
 *
 * The check runs on the EFFECTIVE upstream path: `URL` has already resolved dot segments, and this
 * folds the encodings a hostile client might still try (`%2e`, `%2f`, `%5c`, double encoding,
 * backslashes, repeated slashes, any letter case). It only ever widens what is closed: a path is
 * classified as the board if ANY of those readings lands on it.
 */
const BOARD_PREFIX = '/api/v1/admin/queues'

function foldEncodings(path: string): string {
  let current = path
  for (let pass = 0; pass < 4; pass += 1) {
    const next = current
      .replace(/%2e/gi, '.')
      .replace(/%2f/gi, '/')
      .replace(/%5c/gi, '/')
      .replace(/%25/gi, '%')
      .replace(/%([0-9a-f]{2})/gi, (escape, hex: string) => {
        const character = String.fromCharCode(Number.parseInt(hex, 16))
        return /[A-Za-z0-9._~-]/.test(character) ? character : escape
      })
      .replaceAll('\\', '/')
    if (next === current) break
    current = next
  }
  return current
}

function resolveSegments(path: string): string {
  const resolved: string[] = []
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') resolved.pop()
    else resolved.push(segment)
  }
  return `/${resolved.join('/')}`
}

export function isQueueBoardRoute(upstream: URL): boolean {
  const path = resolveSegments(foldEncodings(upstream.pathname)).toLowerCase()
  return path === BOARD_PREFIX || path.startsWith(`${BOARD_PREFIX}/`)
}
