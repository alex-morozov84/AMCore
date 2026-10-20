import assert from 'node:assert/strict'
import test from 'node:test'

import { assertAppleOAuthFixture } from './apple-oauth-fixture.mjs'

function model() {
  return {
    fixtureProfile: 'product-admin-oauth',
    purpose: 'e2e',
    productAdminHost: true,
    snapshot: '/owned/snapshot',
    model: {
      services: {
        api: {
          environment: { NODE_OPTIONS: '--import=/app/fixtures/apple-oidc.mjs' },
          volumes: [
            {
              type: 'bind',
              source: '/owned/snapshot/docker/testing/apple-oidc.mjs',
              target: '/app/fixtures/apple-oidc.mjs',
              read_only: true,
            },
          ],
        },
        worker: { environment: {} },
      },
    },
  }
}

test('signed provider fixture admits only an owned, read-only API preload in staff E2E', () => {
  assert.doesNotThrow(() => assertAppleOAuthFixture(model()))
  for (const mutate of [
    (m) => {
      m.purpose = 'preview'
    },
    (m) => {
      m.productAdminHost = false
    },
    (m) => {
      m.model.services.api.volumes[0].source = '/foreign/apple-oidc.mjs'
    },
    (m) => {
      m.model.services.api.volumes[0].read_only = false
    },
    (m) => {
      m.model.services.worker.environment.NODE_OPTIONS = '--import=apple-oidc.mjs'
    },
    (m) => {
      m.fixtureProfile = 'organization-roles'
    },
  ]) {
    const candidate = model()
    mutate(candidate)
    assert.throws(() => assertAppleOAuthFixture(candidate))
  }
})

test('path OAuth fixture requires path product placement and remains E2E-only', () => {
  const selected = model()
  selected.fixtureProfile = 'product-admin-oauth-path'
  selected.productAdminHost = false
  assert.doesNotThrow(() => assertAppleOAuthFixture(selected))
  selected.productAdminHost = true
  assert.throws(() => assertAppleOAuthFixture(selected))
  selected.productAdminHost = false
  selected.purpose = 'preview'
  assert.throws(() => assertAppleOAuthFixture(selected))
})
