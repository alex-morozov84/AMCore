// C5b: admission.sh outside against a stub curl that models the API rate limit (burst 50,
// refill per second). In the shared model the direct API and the web app path of one real
// address use ONE bucket, as the API's per-handler key does; the forged model lets the
// X-Forwarded-For header choose the bucket, the defect the check must catch.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { ROOT } from './load-test-stubs.mjs'

const CURL = `#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const args = process.argv.slice(2)
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'limit.json'), 'utf8'))
const url = args.find((a) => a.startsWith('https://'))
const fmt = args[args.indexOf('-w') + 1] ?? ''
const headers = args.flatMap((a, i) => (args[i - 1] === '-H' ? [a] : []))
const xff = headers.find((h) => /^x-forwarded-for:/i.test(h))?.split(':')[1].trim()
const out = (code) => process.stdout.write(fmt.replace('%{http_code}', code).replace('\\\\n', '\\n'))
if (url.includes(':8443')) { out('000'); process.exit(35) }
if (url.endsWith('/api/auth/login')) {
  const jar = args[args.indexOf('-c') + 1]
  if (args.includes('-c')) fs.writeFileSync(jar, 'session')
  return out('200')
}
if (!/\\/api\\/(v1\\/)?auth\\/me$/.test(url)) return out('200')
// One GCRA-like bucket per key, guarded by a directory lock (requests run in parallel).
const key = cfg.model === 'forged' && xff ? xff : 'real-client'
const lock = path.join(__dirname, '..', 'lock')
for (;;) { try { fs.mkdirSync(lock); break } catch { const t = Date.now(); while (Date.now() - t < 2); } }
const file = path.join(__dirname, '..', 'buckets.json')
const buckets = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {}
const now = Date.now() / 1000
const b = buckets[key] ?? { tokens: 50, at: now }
b.tokens = Math.min(50, b.tokens + (now - b.at) * cfg.refillPerS)
b.at = now
const admitted = b.tokens >= 1
if (admitted) b.tokens -= 1
buckets[key] = b
fs.writeFileSync(file, JSON.stringify(buckets))
fs.rmdirSync(lock)
out(admitted ? (url.includes('/api/v1/') ? '401' : '200') : '429')
`

function outside(model, refillS = '6') {
  const d = mkdtempSync(join(tmpdir(), 'lt-admission-'))
  mkdirSync(join(d, 'bin'))
  writeFileSync(join(d, 'bin/curl'), CURL)
  chmodSync(join(d, 'bin/curl'), 0o755)
  writeFileSync(join(d, 'limit.json'), JSON.stringify({ model, refillPerS: 10 }))
  writeFileSync(join(d, 'fixture-password'), 'Lt0123456789abcdef9')
  // Outside the private network: no LT_SERVER_IP, names resolve through public DNS.
  writeFileSync(
    join(d, 'load-test.env'),
    `LT_WORK=${d}\nLT_WEB_HOST=app.example.test\nLT_API_HOST=api.example.test\nLT_PREFIX=/en\n`
  )
  return spawnSync('sh', [join(ROOT, 'scripts/load-test/admission.sh'), 'outside'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${join(d, 'bin')}:${process.env.PATH}`,
      LT_ENV: join(d, 'load-test.env'),
      LT_REFILL_S: refillS,
    },
  })
}

test('outside passes when API and web app share one bucket per real address', () => {
  const r = outside('shared')
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.match(r.stdout, /PASS edge-api: limited after/)
  assert.match(r.stdout, /PASS edge-web: limited after/)
  assert.match(r.stdout, /PASS edge-web-other: same bucket/)
})

test('outside fails when a forged X-Forwarded-For chooses the bucket', () => {
  const r = outside('forged')
  assert.notEqual(r.status, 0)
  assert.match(r.stdout, /FAIL edge-api-other: .*forged headers chose another bucket/)
})

test('without the refill wait the shared bucket fails the web check (the C5b defect)', () => {
  const r = outside('shared', '0')
  assert.notEqual(r.status, 0)
  assert.match(r.stdout, /FAIL edge-web: /)
})
