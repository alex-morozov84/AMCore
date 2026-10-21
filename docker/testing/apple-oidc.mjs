// Test-only process preload, mounted exclusively by the owned OAuth E2E fixture.
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { URLSearchParams } from 'node:url'

const { Request, Response } = globalThis

const issuer = 'https://appleid.apple.com'
const clientId = 'com.amcore.test-service'
const signing = generateKeyPairSync('rsa', { modulusLength: 2048 })
const wrongSigning = generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwk = { ...signing.publicKey.export({ format: 'jwk' }), kid: 'fixture-key', alg: 'RS256' }
const originalFetch = globalThis.fetch.bind(globalThis)
const json = (value) => Response.json(value)

function idToken(input) {
  const now = Math.floor(Date.now() / 1000)
  const claims = {
    iss: input.scenario === 'issuer' ? 'https://wrong.example.test' : issuer,
    aud: input.scenario === 'audience' ? 'other-client' : clientId,
    sub: input.scenario === 'subject' ? '' : `fixture:${input.email}`,
    iat: now,
    exp: input.scenario === 'expired' ? now - 900 : now + 300,
    ...(input.scenario === 'missing-email'
      ? {}
      : { email: input.scenario === 'email-type' ? 123 : input.email }),
    email_verified:
      input.scenario === 'verified-type'
        ? 'yes'
        : input.scenario === 'unverified'
          ? 'false'
          : 'true',
  }
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'fixture-key' })).toString(
    'base64url'
  )
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
  const material = `${header}.${payload}`
  const key = input.scenario === 'signature' ? wrongSigning.privateKey : signing.privateKey
  return `${material}.${sign('RSA-SHA256', Buffer.from(material), key).toString('base64url')}`
}

globalThis.fetch = async (input, init) => {
  const url = input instanceof Request ? input.url : String(input)
  if (!url.startsWith(`${issuer}/`)) {
    const handled = await getProviderResponse(url, input, init)
    return handled ?? originalFetch(input, init)
  }
  if (url === `${issuer}/.well-known/openid-configuration`)
    return json({
      issuer,
      authorization_endpoint: `${issuer}/auth/authorize`,
      token_endpoint: `${issuer}/auth/token`,
      jwks_uri: `${issuer}/auth/keys`,
      response_types_supported: ['code'],
      subject_types_supported: ['pairwise'],
      id_token_signing_alg_values_supported: ['RS256'],
      token_endpoint_auth_methods_supported: ['client_secret_post'],
    })
  if (url === `${issuer}/auth/keys`) return json({ keys: [jwk] })
  if (url !== `${issuer}/auth/token`) throw new Error('Unexpected Apple fixture endpoint')
  const form = new URLSearchParams(String(init?.body))
  let code
  try {
    code = JSON.parse(Buffer.from(form.get('code') ?? '', 'base64url').toString())
  } catch {
    throw new Error('Invalid fixture authorization code')
  }
  if (
    !/^[a-z0-9._+-]+@e2e\.amcore\.test$/i.test(code.email ?? '') ||
    form.get('client_id') !== clientId ||
    form.get('grant_type') !== 'authorization_code' ||
    form.get('redirect_uri') !== code.redirectUri ||
    createHash('sha256')
      .update(form.get('code_verifier') ?? '')
      .digest('base64url') !== code.challenge
  )
    throw new Error('Fixture callback/PKCE contract failed')
  return json({
    access_token: '<fake-fixture-access-token>',
    token_type: 'Bearer',
    expires_in: 300,
    ...(code.scenario === 'missing' ? {} : { id_token: idToken(code) }),
  })
}

// GET-callback providers use their existing protocols and shared application callbacks.
// Google endpoints follow its public discovery metadata; Apple never uses UserInfo.
const google = {
  issuer: 'https://accounts.google.com',
  authorization: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://oauth2.googleapis.com/token',
  keys: 'https://www.googleapis.com/oauth2/v3/certs',
  userinfo: 'https://openidconnect.googleapis.com/v1/userinfo',
}
const profiles = new Map()
let sequence = 0

function verifiedCode(form, provider) {
  const code = JSON.parse(Buffer.from(form.get('code') ?? '', 'base64url').toString())
  if (
    !/^[a-z0-9._+-]+@e2e\.amcore\.test$/i.test(code.email ?? '') ||
    form.get('client_id') !== `fixture-${provider}-client` ||
    form.get('redirect_uri') !== code.redirectUri ||
    createHash('sha256')
      .update(form.get('code_verifier') ?? '')
      .digest('base64url') !== code.challenge
  )
    throw new Error('Fixture GET provider callback/PKCE contract failed')
  return code
}

function googleIdentity(code) {
  const now = Math.floor(Date.now() / 1000)
  const claims = {
    iss: google.issuer,
    aud: 'fixture-google-client',
    sub: `google:${code.email}`,
    email: code.email,
    email_verified: true,
    name: 'Fixture Google',
    iat: now,
    exp: now + 300,
  }
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: jwk.kid })).toString('base64url')
  const material = `${header}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}`
  return {
    claims,
    token: `${material}.${sign('RSA-SHA256', Buffer.from(material), signing.privateKey).toString('base64url')}`,
  }
}

async function getProviderResponse(url, input, init) {
  if (url === `${google.issuer}/.well-known/openid-configuration`)
    return json({
      issuer: google.issuer,
      authorization_endpoint: google.authorization,
      token_endpoint: google.token,
      jwks_uri: google.keys,
      userinfo_endpoint: google.userinfo,
      response_types_supported: ['code'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256'],
      token_endpoint_auth_methods_supported: ['client_secret_post'],
    })
  if (url === google.keys) return json({ keys: [jwk] })
  if (url === google.token) {
    const form = new URLSearchParams(String(init?.body))
    if (form.get('grant_type') !== 'authorization_code')
      throw new Error('Unexpected Google fixture grant')
    const identity = googleIdentity(verifiedCode(form, 'google'))
    const access = `fake-fixture-google-access-${++sequence}`
    profiles.set(access, identity.claims)
    return json({
      access_token: access,
      token_type: 'Bearer',
      expires_in: 300,
      id_token: identity.token,
    })
  }
  if (url === 'https://github.com/login/oauth/access_token') {
    const form = new URLSearchParams(Object.entries(JSON.parse(String(init?.body))))
    const code = verifiedCode(form, 'github')
    const access = `fake-fixture-github-access-${++sequence}`
    profiles.set(access, {
      email: code.email,
      id: createHash('sha256').update(code.email).digest().readUInt32BE(0),
    })
    return json({ access_token: access, token_type: 'bearer', scope: 'read:user,user:email' })
  }
  if (
    [google.userinfo, 'https://api.github.com/user', 'https://api.github.com/user/emails'].includes(
      url
    )
  ) {
    const headers = new globalThis.Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined)
    )
    const profile = profiles.get((headers.get('authorization') ?? '').replace(/^Bearer /i, ''))
    if (!profile) throw new Error('Unknown fixture provider access token')
    if (url === google.userinfo) return json(profile)
    if (url.endsWith('/emails'))
      return json([{ email: profile.email, primary: true, verified: true }])
    return json({
      id: profile.id,
      name: 'Fixture GitHub',
      login: 'fixture-user',
      email: profile.email,
      avatar_url: null,
    })
  }
  return null
}
