import { generateKeyPairSync } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const oauthProfiles = ['product-admin-oauth', 'product-admin-oauth-path']
function assertOAuthPurpose(m) {
  const expectedHost = m.fixtureProfile === 'product-admin-oauth'
  if (m.purpose !== 'e2e' || Boolean(m.productAdminHost) !== expectedHost)
    throw new Error('OAuth fixture requires its selected owned E2E topology')
}

export async function prepareAppleOAuthFixture(m) {
  if (!oauthProfiles.includes(m.fixtureProfile)) return
  assertOAuthPurpose(m)
  const key = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({
    type: 'pkcs8',
    format: 'pem',
  })
  await writeFile(join(m.snapshot, 'docker/testing/apple-client-key.pem'), key, { mode: 0o600 })
}

export async function appleOAuthEnvironment(m) {
  if (!oauthProfiles.includes(m.fixtureProfile)) return {}
  assertOAuthPurpose(m)
  return {
    GOOGLE_CLIENT_ID: 'fixture-google-client',
    GOOGLE_CLIENT_SECRET: '<fake-google-client-secret>',
    GOOGLE_CALLBACK_URL: `${m.origins.product}/api/auth/oauth/google/callback`,
    GITHUB_CLIENT_ID: 'fixture-github-client',
    GITHUB_CLIENT_SECRET: '<fake-github-client-secret>',
    GITHUB_CALLBACK_URL: `${m.origins.product}/api/auth/oauth/github/callback`,
    APPLE_CLIENT_ID: 'com.amcore.test-service',
    APPLE_TEAM_ID: 'FIXTURETEAM',
    APPLE_KEY_ID: 'FIXTUREKEY',
    APPLE_PRIVATE_KEY: await readFile(
      join(m.snapshot, 'docker/testing/apple-client-key.pem'),
      'utf8'
    ),
    APPLE_CALLBACK_URL: `${m.origins.product}/api/auth/oauth/apple/callback`,
    NODE_OPTIONS: '--import=/app/fixtures/apple-oidc.mjs',
  }
}

export function assertAppleOAuthFixture(m) {
  const enabled = oauthProfiles.includes(m.fixtureProfile)
  if (enabled) assertOAuthPurpose(m)
  for (const [name, service] of Object.entries(m.model.services)) {
    const mount = (service.volumes ?? []).filter(
      (entry) => entry.target === '/app/fixtures/apple-oidc.mjs'
    )
    const preload = service.environment?.NODE_OPTIONS
    if (enabled && name === 'api') {
      if (
        preload !== '--import=/app/fixtures/apple-oidc.mjs' ||
        mount.length !== 1 ||
        mount[0].type !== 'bind' ||
        !mount[0].read_only ||
        mount[0].source !== join(m.snapshot, 'docker/testing/apple-oidc.mjs')
      )
        throw new Error('Unsafe Apple OAuth fixture transport')
    } else if (mount.length || preload?.includes('apple-oidc')) {
      throw new Error('Unexpected Apple OAuth fixture transport')
    }
  }
}
