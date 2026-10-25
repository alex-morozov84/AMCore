// Checks an adapted (JSON) Caddy config for the load-test trust boundary:
//   node caddy-check.mjs <config.json> <generator-ipv4>
// Used by preflight.sh on the planned config (caddy adapt) and on the running Caddy.
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

/** @returns {string[]} violations; empty means the boundary holds. */
export function checkLoadTestConfig(config, generatorIp) {
  const problems = []
  const servers = Object.values(config?.apps?.http?.servers ?? {})
  const on = (port) => servers.filter((s) => (s.listen ?? []).some((l) => l.endsWith(`:${port}`)))
  const test = on(8443)
  const normal = on(443)
  if (test.length !== 1) problems.push(`expected one :8443 server, found ${test.length}`)
  if (normal.length !== 1) problems.push(`expected one :443 server, found ${normal.length}`)
  for (const s of servers) {
    if (s.trusted_proxies && !test.includes(s)) problems.push(`trusted_proxies on ${s.listen}`)
  }
  for (const s of normal) {
    const auth = (s.tls_connection_policies ?? []).some((p) => p.client_authentication)
    if (auth) problems.push(':443 must not use client certificates (ordinary edge)')
  }
  const [t] = test
  if (t) {
    const ranges = t.trusted_proxies?.ranges ?? []
    if (
      t.trusted_proxies?.source !== 'static' ||
      ranges.length !== 1 ||
      ranges[0] !== `${generatorIp}/32`
    )
      problems.push(`:8443 must trust exactly ${generatorIp}/32, found ${JSON.stringify(ranges)}`)
    if (!t.trusted_proxies_strict) problems.push(':8443 must use trusted_proxies_strict')
    if (t.strict_sni_host !== true) problems.push(':8443 must use strict_sni_host on')
    const policies = t.tls_connection_policies ?? []
    const named = policies.filter((p) => p.match?.sni?.length)
    if (!named.length) problems.push(':8443 has no TLS policy for its site names')
    for (const p of named) {
      const auth = p.client_authentication
      if (auth?.mode !== 'require_and_verify' || !(auth.ca?.pem_files ?? []).length)
        problems.push(`:8443 policy for ${p.match.sni} must require_and_verify against the test CA`)
    }
    for (const p of policies.filter((x) => !x.match) ?? [])
      if (p.client_authentication?.mode && p.client_authentication.mode !== 'require_and_verify')
        problems.push(':8443 default TLS policy weakens client authentication')
    // Every host the test entry routes must be served only with a verified client
    // certificate; strict_sni_host ties Host to SNI but creates no client auth itself.
    const verified = new Set(
      named
        .filter((p) => p.client_authentication?.mode === 'require_and_verify')
        .flatMap((p) => p.match.sni)
    )
    const routed = (t.routes ?? []).flatMap((r) => (r.match ?? []).flatMap((m) => m.host ?? []))
    if (!routed.length) problems.push(':8443 routes match no host')
    for (const host of routed)
      if (!verified.has(host))
        problems.push(`:8443 routes ${host} without a client-certificate policy`)
    if ((t.routes ?? []).some((r) => !(r.match ?? []).some((m) => m.host?.length)))
      problems.push(':8443 has a route without a host matcher')
    for (const route of t.routes ?? []) {
      const text = JSON.stringify(route)
      const proxies = (text.match(/"handler":"reverse_proxy"/g) ?? []).length
      const strips = (text.match(/"delete":\[[^\]]*"X-AMCore-Client-Ip"/gi) ?? []).length
      if (proxies !== strips)
        problems.push(
          `:8443 route ${JSON.stringify(route.match)} does not strip X-AMCore-Client-Ip on every upstream`
        )
    }
  }
  return problems
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [file, ip] = process.argv.slice(2)
  const problems = checkLoadTestConfig(JSON.parse(readFileSync(file, 'utf8')), ip)
  for (const p of problems) console.error(`caddy-check: ${p}`)
  if (problems.length) process.exit(1)
  console.log('caddy-check: load-test trust boundary holds')
}
