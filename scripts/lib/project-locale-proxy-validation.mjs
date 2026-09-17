const PATH = 'apps/web/src/proxy.ts'

const required = [
  "import { type NextRequest, NextResponse } from 'next/server'",
  'request.headers.delete(CSP_ENFORCE_HEADER)',
  'request.headers.delete(CSP_REPORT_ONLY_HEADER)',
  'request.headers.set(NONCE_REQUEST_HEADER, nonce)',
  'request.headers.set(cspHeaderName, cspHeaderValue)',
  'NextResponse.next({\n    request: {\n      headers: request.headers,\n    },\n  })',
  'response.headers.set(cspHeaderName, cspHeaderValue)',
  "'Reporting-Endpoints'",
  "matcher: ['/((?!api|_next|_vercel|.*\\\\..*).*)']",
]

const forbidden = ['next-intl/middleware', "'./i18n/routing'", 'handleI18nRouting']

export function proxyResiduals(contents) {
  const content = contents.get(PATH)
  if (content === undefined) return [`${PATH}:shared framework entrypoint missing`]
  return [
    ...required
      .filter((value) => !content.includes(value))
      .map((value) => `${PATH}:missing ${value}`),
    ...forbidden
      .filter((value) => content.includes(value))
      .map((value) => `${PATH}:stale ${value}`),
  ]
}
