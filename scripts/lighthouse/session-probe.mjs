import { digest, invariant } from '../lib/lighthouse-plan.mjs'

const observations = new WeakMap()
export const probeProof = (context) => observations.get(context) ?? []

export function sessionCookie(cookies, audience) {
  const name = audience === 'product' ? 'amcore_session' : `__Host-amcore_${audience}_session`
  return { audience, cookie: cookies.find((c) => c.name === name) }
}

function jarIdentity(cookies) {
  return cookies
    .filter((c) => /^(?:amcore_session|__Host-amcore_(?:staff|console)_session)$/.test(c.name))
    .map(({ name, domain, path, secure, httpOnly, sameSite, value }) =>
      JSON.stringify([name, domain, path, secure, httpOnly, sameSite, digest(value)])
    )
    .sort()
    .join('\n')
}

export async function sessionProbe(context, url, expected, audience = 'product', accessPath) {
  const before = await context.cookies(url)
  const { cookie } = sessionCookie(before, audience)
  invariant(!expected || cookie, 'measured-subject-refused')
  const binding =
    expected && cookie
      ? digest(JSON.stringify(['product-context-v2', audience, cookie.value, expected]))
      : undefined
  for (const path of [
    ...(audience === 'console' ? [] : ['/api/auth/me']),
    ...(accessPath ? [accessPath] : []),
  ]) {
    const started = Date.now(),
      observation = { path, passed: false }
    const proof = probeProof(context)
    observations.set(context, proof)
    proof.push(observation)
    let response
    try {
      response = await context.request.get(new URL(path, url).href, {
        maxRedirects: 0,
        timeout: 5000,
      })
      observation.status = response.status()
      invariant(
        jarIdentity(before) === jarIdentity(await context.cookies(url)),
        'measured-session-cookie-changed'
      )
      if (path === '/api/auth/me') {
        const body = await response.json()
        invariant(
          expected
            ? response.status() === 200 && body.user?.id === expected
            : response.status() === 401 && !body.user,
          'measured-subject-refused'
        )
        if (expected)
          invariant(
            binding && response.headers()['x-amcore-context-session'] === binding,
            'measured-session-fence-missing'
          )
      } else invariant(response.status() === 204, 'console-audience-refused')
      observation.passed = true
    } finally {
      observation.durationMs = Date.now() - started
      await response?.dispose()
    }
  }
  return binding
}

export async function boundDocument(document, binding) {
  invariant(
    await document.evaluate(
      (doc, expected) =>
        doc === globalThis.document && doc.documentElement.outerHTML.includes(expected),
      binding
    ),
    'measured-session-fence-missing'
  )
}
