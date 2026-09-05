import { describe, expect, it } from 'vitest'

import { parseCspReport } from './parse-csp-report'

describe('parseCspReport', () => {
  it('parses the legacy application/csp-report shape', () => {
    const body = JSON.stringify({
      'csp-report': {
        'document-uri': 'https://example.com/en/login?token=secret',
        'violated-directive': 'script-src',
        'blocked-uri': 'https://evil.example/x.js',
        disposition: 'report',
        'source-file': 'https://example.com/app.js',
        'line-number': 42,
        'script-sample': 'a'.repeat(200),
      },
    })

    const reports = parseCspReport('application/csp-report', body)

    expect(reports).toHaveLength(1)
    expect(reports![0]).toEqual({
      documentUrl: 'https://example.com/en/login',
      violatedDirective: 'script-src',
      blockedUrl: 'https://evil.example/x.js',
      disposition: 'report',
      sourceFile: 'https://example.com/app.js',
      lineNumber: 42,
      sample: `${'a'.repeat(100)}...`,
    })
  })

  it('parses the modern application/reports+json shape, filtering to csp-violation entries', () => {
    const body = JSON.stringify([
      {
        type: 'csp-violation',
        body: {
          documentURL: 'https://example.com/en/dashboard',
          effectiveDirective: 'style-src-elem',
          blockedURL: 'inline',
          disposition: 'enforce',
        },
      },
      { type: 'deprecation', body: { id: 'unrelated' } },
    ])

    const reports = parseCspReport('application/reports+json', body)

    expect(reports).toHaveLength(1)
    expect(reports![0].violatedDirective).toBe('style-src-elem')
    expect(reports![0].blockedUrl).toBe('inline')
  })

  it('drops the query string, never logging it verbatim', () => {
    const body = JSON.stringify({
      'csp-report': { 'document-uri': 'https://example.com/reset-password?token=abc123' },
    })

    const reports = parseCspReport('application/csp-report', body)

    expect(reports![0].documentUrl).toBe('https://example.com/reset-password')
    expect(reports![0].documentUrl).not.toContain('abc123')
  })

  it('never surfaces referrer, user_agent, or the original policy text', () => {
    const body = JSON.stringify({
      'csp-report': {
        'document-uri': 'https://example.com/',
        referrer: 'https://example.com/secret-referrer',
        'original-policy': "script-src 'self'",
      },
    })

    const reports = parseCspReport('application/csp-report', body)

    expect(JSON.stringify(reports)).not.toContain('secret-referrer')
    expect(JSON.stringify(reports)).not.toContain('original-policy')
  })

  it('returns null for malformed JSON', () => {
    expect(parseCspReport('application/csp-report', '{not json')).toBeNull()
  })

  it('returns null for a well-formed body that does not match the expected shape', () => {
    expect(parseCspReport('application/csp-report', JSON.stringify({ hello: 'world' }))).toBeNull()
    expect(
      parseCspReport('application/reports+json', JSON.stringify({ not: 'an array' }))
    ).toBeNull()
  })
})
