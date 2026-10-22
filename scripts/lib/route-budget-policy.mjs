// Route budget policy: route keys `scope:/path`, budget files and the per-route verdict.
// A scope resolver claims the routes under one physical prefix (for example the product
// administration alias); unclaimed routes belong to scope `app`.
import { RouteBudgetError } from './route-budget-inputs.mjs'

const fail = (message) => {
  throw new RouteBudgetError(message)
}

export const REPORT_ONLY = 'report-only'

/** Strips the locale segment, so single- and multi-locale builds share one key. */
export function localeNeutral(route) {
  if (route === '/[locale]') return '/'
  return route.startsWith('/[locale]/') ? route.slice('/[locale]'.length) : route
}

/** Maps every measured route to its full key; two routes may never share one. */
export function keyRoutes(routes, resolvers) {
  const keyed = new Map()
  for (const route of routes) {
    const neutral = localeNeutral(route)
    const claims = resolvers.filter(
      ({ prefix }) => neutral === prefix || neutral.startsWith(`${prefix}/`)
    )
    if (claims.length > 1)
      fail(`${route} is claimed by scopes ${claims.map(({ scope }) => scope).join(', ')}`)
    const [claim] = claims
    const key = claim
      ? `${claim.scope}:${neutral.slice(claim.prefix.length) || '/'}`
      : `app:${neutral}`
    if (keyed.has(key)) fail(`${route} and ${keyed.get(key)} both map to ${key}`)
    keyed.set(key, route)
  }
  return keyed
}

/** Merges budget files; every row names a registered scope and appears once. */
export function mergeBudgets(files, scopes) {
  const budgets = new Map()
  const origin = new Map()
  for (const { file, json } of files) {
    const rows = json?.routes
    if (!rows || typeof rows !== 'object' || Array.isArray(rows))
      fail(`${file} needs a "routes" object`)
    for (const [key, limit] of Object.entries(rows)) {
      const scope = key.slice(0, key.indexOf(':'))
      if (!scopes.has(scope)) fail(`${file}: ${key} uses an unknown scope "${scope}"`)
      if (limit !== REPORT_ONLY && !(Number.isSafeInteger(limit) && limit > 0))
        fail(`${file}: ${key} needs a positive byte limit or "${REPORT_ONLY}"`)
      if (budgets.has(key)) fail(`${key} is budgeted in both ${origin.get(key)} and ${file}`)
      budgets.set(key, limit)
      origin.set(key, file)
    }
  }
  return budgets
}

/** Compares measured bytes with the budgets; returns report rows and failure messages. */
export function evaluate(keyed, rows, budgets, mandatory) {
  const failures = []
  for (const key of keyed.keys()) if (!budgets.has(key)) failures.push(`${key} has no budget row`)
  for (const key of budgets.keys())
    if (!keyed.has(key)) failures.push(`${key} is budgeted but is not a built page`)
  for (const key of mandatory)
    if (!Number.isSafeInteger(budgets.get(key)))
      failures.push(`${key} is mandatory and needs a byte limit, not "${budgets.get(key)}"`)
  const report = [...keyed]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, route]) => {
      const bytes = rows.get(route).bytes
      const limit = budgets.get(key)
      const over = Number.isSafeInteger(limit) && bytes > limit
      if (over)
        failures.push(`${key} first-load JS is ${bytes} bytes, over its ${limit}-byte budget`)
      return { key, route, bytes, limit, over }
    })
  return { report, failures }
}
