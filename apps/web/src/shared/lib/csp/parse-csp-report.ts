const SAMPLE_MAX_LENGTH = 100

export interface NormalizedCspReport {
  documentUrl: string | undefined
  violatedDirective: string | undefined
  blockedUrl: string | undefined
  disposition: string | undefined
  sourceFile: string | undefined
  lineNumber: number | undefined
  sample: string | undefined
}

/**
 * Drops the query string from a URL-shaped value (a real query string can
 * carry session tokens, reset/invite links, etc. — this endpoint is public
 * and unauthenticated, so nothing it's handed should end up verbatim in
 * server logs). `blocked-uri`/`blockedURL` per spec can also be a bare
 * keyword (`inline`, `eval`, `self`, ...) rather than a URL — those pass
 * through unchanged since `new URL()` rejects them.
 */
function stripQuery(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined
  try {
    const url = new URL(value)
    return `${url.origin}${url.pathname}`
  } catch {
    return value.length > 200 ? `${value.slice(0, 200)}...` : value
  }
}

function truncateSample(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined
  return value.length > SAMPLE_MAX_LENGTH ? `${value.slice(0, SAMPLE_MAX_LENGTH)}...` : value
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
}

/**
 * Normalizes one report body — either the legacy `csp-report` shape
 * (`application/csp-report`, hyphen-case) or a single entry's `body` from
 * the modern Reporting API array (`application/reports+json`, camelCase)
 * — into a small, allowlisted, safe-to-log shape. Deliberately drops
 * `referrer`, `user_agent`, and `original-policy`/`originalPolicy`
 * (redundant with what this server already generated, and not needed to
 * diagnose a violation) — an allowlist of what's useful, not a blocklist of
 * what's sensitive, per FINAL PLAN §3 PR3 ("avoid logging raw sensitive
 * data where possible; normalize/redact noisy fields").
 */
function normalizeReportBody(body: Record<string, unknown>): NormalizedCspReport {
  return {
    documentUrl: stripQuery(body['document-uri'] ?? body.documentURL),
    violatedDirective: asString(
      body['violated-directive'] ?? body.effectiveDirective ?? body['effective-directive']
    ),
    blockedUrl: stripQuery(body['blocked-uri'] ?? body.blockedURL),
    disposition: asString(body.disposition),
    sourceFile: stripQuery(body['source-file'] ?? body.sourceFile),
    lineNumber: asNumber(body['line-number'] ?? body.lineNumber),
    sample: truncateSample(body['script-sample'] ?? body.sample),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Parses a raw CSP report request body per `contentType`, returning
 * normalized, safe-to-log entries — or `null` if the body doesn't match
 * either expected shape (malformed JSON, wrong content type, or a shape
 * this parser doesn't recognize). A `null` result means "don't log
 * anything," not "throw": an unauthenticated public endpoint will see
 * garbage/probing traffic, and that's an expected, non-exceptional case.
 */
export function parseCspReport(contentType: string, rawBody: string): NormalizedCspReport[] | null {
  try {
    const parsed: unknown = JSON.parse(rawBody)

    if (
      contentType === 'application/csp-report' &&
      isRecord(parsed) &&
      isRecord(parsed['csp-report'])
    ) {
      return [normalizeReportBody(parsed['csp-report'])]
    }

    if (contentType === 'application/reports+json' && Array.isArray(parsed)) {
      return parsed
        .filter(
          (entry): entry is Record<string, unknown> =>
            isRecord(entry) && entry.type === 'csp-violation'
        )
        .map((entry) => normalizeReportBody(isRecord(entry.body) ? entry.body : {}))
    }

    return null
  } catch {
    return null
  }
}
