const { existsSync, realpathSync } = require('node:fs')
const { resolve, relative, dirname } = require('node:path')
const { Buffer } = require('node:buffer')
const { stripVTControlCharacters } = require('node:util')
const root = resolve(dirname(require.resolve('./ci-diagnostic.cjs')), '..')
const admission = new Map([
  ['Abnormal/forced/replayed API E2E attempt', 'attempt-lifecycle'],
  ['Mismatched attempt identity or failed cleanup', 'attempt-identity-or-cleanup'],
  ['Missing/duplicate/incomplete API E2E report', 'report-incomplete'],
  ['Incomplete/mismatched API E2E terminal outcome', 'terminal-outcome'],
  ['Mismatched suite start/end', 'suite-identity'],
  ['Failed/skipped/retried API E2E assertion', 'assertion-lifecycle'],
])
const matchers = new Set([
  'toBe',
  'toEqual',
  'toStrictEqual',
  'toHaveLength',
  'toHaveBeenCalledTimes',
  'toBeVisible',
  'toHaveURL',
  'toHaveCount',
  'toBeEnabled',
  'toMatchObject',
  'toContain',
])

function sourceLocation(file, line, column) {
  if (typeof file !== 'string' || !existsSync(file)) return { file: 'detail-withheld' }
  const path = relative(root, realpathSync(file)).replaceAll('\\', '/')
  if (!/^(apps|packages|scripts)\/[\w./-]+\.[cm]?[jt]sx?$/.test(path) || path.includes('..'))
    return { file: 'detail-withheld' }
  return {
    file: path,
    ...(Number.isInteger(line) && line > 0 ? { line } : {}),
    ...(Number.isInteger(column) && column > 0 ? { column } : {}),
  }
}

function failureLocation(error, fallback) {
  const stack = typeof error.stack === 'string' ? error.stack.slice(0, 8192) : ''
  for (const match of stack.matchAll(/((?:\/[^\s:()]+)+\.[cm]?[jt]sx?):(\d+):(\d+)/g)) {
    const location = sourceLocation(match[1], Number(match[2]), Number(match[3]))
    if (location.file !== 'detail-withheld') return location
  }
  return sourceLocation(fallback.file, fallback.line, fallback.column)
}

// Free-form messages, titles, values and attachments can contain one-use credentials.
// Keep only source identity, known categories and numeric assertion facts, before persistence.
function failure(error = {}, location = {}) {
  if (!error || typeof error !== 'object') error = {}
  const result =
    error.matcherResult && typeof error.matcherResult === 'object' ? error.matcherResult : {}
  const message = stripVTControlCharacters(typeof error.message === 'string' ? error.message : '')
  const matcher = matchers.has(result.name)
    ? result.name
    : ([...matchers].find((name) => message.includes(`${name}(`)) ?? null)
  const category = matcher
    ? 'assertion'
    : /timed out|exceeded.*timeout/i.test(message)
      ? 'timeout'
      : ['ENOSPC', 'ENOENT', 'ECONNREFUSED'].includes(error.code)
        ? error.code
        : 'detail-withheld'
  const numbers = Object.fromEntries(
    ['expected', 'actual'].flatMap((key) =>
      typeof result[key] === 'number' && Number.isFinite(result[key]) ? [[key, result[key]]] : []
    )
  )
  return {
    ...failureLocation(error, location),
    category,
    ...(admission.has(message) ? { admission: admission.get(message) } : {}),
    ...(matcher ? { matcher } : {}),
    ...numbers,
    originalBytes: Buffer.byteLength(message),
  }
}

function contextReads(data) {
  const phases = new Set(['journey', 'create-alpha', 'create-beta', 'select-beta', 'return-alpha'])
  const states = new Set(['started', 'response', 'finished', 'failed'])
  const requests = Array.isArray(data?.reads?.requests) ? data.reads.requests : []
  return requests
    .slice(-64)
    .filter((request) => request && typeof request === 'object')
    .map((request) => ({
      method: ['GET', 'POST', 'PATCH', 'DELETE'].includes(request.method)
        ? request.method
        : 'unknown',
      // Rebuild route templates from a fixed segment set; never trust an attachment's URL.
      route:
        typeof request.route === 'string'
          ? request.route
              .split('?')[0]
              .split('/')
              .slice(0, 16)
              .map((part) =>
                [
                  '',
                  'api',
                  'product-access',
                  'bootstrap',
                  'organizations',
                  'context',
                  'members',
                  'roles',
                ].includes(part)
                  ? part
                  : '<id>'
              )
              .join('/')
          : 'unknown',
      state: states.has(request.state) ? request.state : 'unknown',
      status: Number.isInteger(request.status) ? request.status : null,
      events: (Array.isArray(request.events) ? request.events : [])
        .slice(0, 4)
        .filter((event) => event && typeof event === 'object')
        .map((event) => ({
          phase: phases.has(event.phase) ? event.phase : 'unknown',
          ms: Number.isFinite(event.ms) ? event.ms : null,
        })),
    }))
}

module.exports = { failure, sourceLocation, contextReads }
