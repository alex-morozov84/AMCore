import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { URLSearchParams } from 'node:url'

import '../../docker/testing/apple-oidc.mjs'

for (const provider of ['google', 'github']) {
  test(`${provider} fixture verifies PKCE and supplies its actual profile protocol`, async () => {
    const verifier = '<fake-fixture-verifier>'
    const email = `${provider}-profile@e2e.amcore.test`
    const callback = `https://staff.example.test/api/product-admin/auth/oauth/${provider}/callback`
    const code = Buffer.from(
      JSON.stringify({
        email,
        redirectUri: callback,
        challenge: createHash('sha256').update(verifier).digest('base64url'),
      })
    ).toString('base64url')
    const input = {
      client_id: `fixture-${provider}-client`,
      redirect_uri: callback,
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
    }
    const endpoint =
      provider === 'google'
        ? 'https://oauth2.googleapis.com/token'
        : 'https://github.com/login/oauth/access_token'
    const body = (value) =>
      provider === 'google' ? new URLSearchParams(value).toString() : JSON.stringify(value)
    await assert.rejects(
      fetch(endpoint, { body: body({ ...input, code_verifier: 'wrong' }) }),
      /PKCE/
    )
    const tokens = await (await fetch(endpoint, { body: body(input) })).json()
    const profileUrl =
      provider === 'google'
        ? 'https://openidconnect.googleapis.com/v1/userinfo'
        : 'https://api.github.com/user'
    const profile = await (
      await fetch(profileUrl, { headers: { Authorization: `Bearer ${tokens.access_token}` } })
    ).json()
    assert.equal(profile.email, email)
    if (provider === 'google') assert.equal(profile.email_verified, true)
    else {
      const emails = await (
        await fetch(`${profileUrl}/emails`, {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        })
      ).json()
      assert.equal(emails[0].verified, true)
    }
  })
}
