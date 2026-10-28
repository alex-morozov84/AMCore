import assert from 'node:assert/strict'
import { test } from 'node:test'

import { caddyRecoveryModel } from '../load-test/recover-caddy.mjs'

const project = 'amcore-loadtest-t080c1'
function fixture() {
  const volumes = Object.fromEntries(
    ['postgres_data', 'caddy_data', 'caddy_config'].map((key) => [
      key,
      { name: `${project}_${key}` },
    ])
  )
  const resource = (key, kind) => ({
    Name: `${project}_${key}`,
    Labels: {
      'com.docker.compose.project': project,
      [`com.docker.compose.${kind}`]: key,
      'amcore.load-test.run': 't080c1',
    },
  })
  return {
    config: {
      name: project,
      services: {
        postgres: {
          image: 'postgres:18-alpine',
          volumes: [{ type: 'volume', source: 'postgres_data' }],
        },
        caddy: {
          image: 'caddy:2-alpine',
          depends_on: { api: {} },
          networks: { default: {} },
          ports: [{ target: 443, published: '443' }],
          volumes: [
            { type: 'bind', source: '/srv/Caddyfile', target: '/etc/caddy/Caddyfile' },
            { type: 'volume', source: 'caddy_data', target: '/data' },
            { type: 'volume', source: 'caddy_config', target: '/config' },
          ],
        },
      },
      volumes,
      networks: { default: { name: `${project}_default` } },
    },
    resources: {
      volumes: Object.keys(volumes).map((key) => resource(key, 'volume')),
      networks: [resource('default', 'network')],
    },
  }
}

test('recovery cannot reconcile DB volumes or dependencies and reuses exact existing edge resources', () => {
  const { config, resources } = fixture()
  const before = globalThis.structuredClone(config)
  const model = caddyRecoveryModel(config, resources, project)
  assert.deepEqual(Object.keys(model.services), ['caddy'])
  assert.equal(model.services.caddy.depends_on, undefined)
  assert.deepEqual(Object.keys(model.volumes), ['caddy_data', 'caddy_config'])
  for (const key of Object.keys(model.volumes))
    assert.deepEqual(model.volumes[key], { name: `${project}_${key}`, external: true })
  assert.deepEqual(model.networks.default, { name: `${project}_default`, external: true })
  assert.deepEqual(model.services.caddy.ports, config.services.caddy.ports)
  assert.deepEqual(config, before)
})

test('missing or foreign volumes/networks and unexpected mounts refuse recovery', () => {
  for (const change of [
    ({ resources }) => {
      resources.volumes = []
    },
    ({ resources }) => {
      resources.networks = []
    },
    ({ resources }) => {
      resources.volumes[1].Labels['com.docker.compose.project'] = 'foreign'
    },
    ({ resources }) => {
      resources.networks[0].Labels['com.docker.compose.network'] = 'foreign'
    },
    ({ config }) => {
      config.services.caddy.volumes[1].source = 'postgres_data'
    },
    ({ config }) => {
      config.services.caddy.volumes[0].type = 'cluster'
    },
    ({ config }) => {
      config.name = 'foreign'
    },
  ]) {
    const input = fixture()
    change(input)
    assert.throws(() => caddyRecoveryModel(input.config, input.resources, project), /recover:/)
  }
})
