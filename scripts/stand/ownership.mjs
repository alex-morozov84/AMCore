import { psqlArguments } from './local-sql.mjs'
export { invocationSql as sql } from './invocation.mjs'
import { resourceCensus } from './resource-census.mjs'
import { createHash } from 'node:crypto'
import { docker, inspect, composeArguments, withDockerEngine } from './docker.mjs'
import { label, validateModel } from './config.mjs'
import { save } from './state.mjs'
import { assertNoSurvivors } from './survivors.mjs'

export function owned(m, resource, kind) {
  const tags = resource.Config?.Labels ?? resource.Labels
  if (
    tags?.[label] !== m.uuid ||
    tags['org.amcore.attempt'] !== m.attempt ||
    tags['org.amcore.worktree'] !== m.worktree ||
    tags['com.docker.compose.project'] !== m.project
  ) {
    throw new Error(`Unproved ${kind} ownership`)
  }
  if (kind !== 'container' && !resource.Name?.startsWith(`${m.project}_`))
    throw new Error('Unscoped resource name')
  if (kind === 'container') {
    const service = tags['com.docker.compose.service']
    if (!m.services.includes(service) || resource.HostConfig.NetworkMode === 'host')
      throw new Error('Foreign container service/network')
    for (const mount of resource.Mounts ?? []) {
      if (
        mount.Type === 'bind' &&
        ![m.snapshot, ...(m.approvedSnapshots ?? [])].some((path) =>
          mount.Source.startsWith(`${path}/docker/`)
        )
      )
        throw new Error('Unapproved mount')
      if (mount.Type === 'volume' && !mount.Name.startsWith(`${m.project}_`))
        throw new Error('Unapproved volume')
    }
  }
}
export async function discover(m, persist = true) {
  return withDockerEngine(m, async (execute) => {
    const { resources } = await resourceCensus(m, execute, owned)
    if (persist) {
      m.resources = resources
      await save(m)
    }
    return resources
  })
}
export async function dataAdmission(m, bootstrap = false) {
  return withDockerEngine(m, async (execute) => {
    const rendered = await execute([...composeArguments(m), 'config', '--format', 'json'], {
      capture: true,
    })
    if (createHash('sha256').update(rendered).digest('hex') !== m.configHash)
      throw new Error('Rendered configuration changed after admission')
    validateModel(m)
    const admitted = m.runToken ? JSON.stringify(m.resources) : undefined
    const { resources: discovered, items } = await resourceCensus(m, execute, owned)
    if (admitted && JSON.stringify(discovered) !== admitted)
      throw new Error('Admitted run resource generation changed')
    m.resources = discovered
    delete m.postgres
    delete m.redis
    for (const network of items.network) {
      if (
        Object.keys(network.Containers ?? {}).some(
          (container) => !m.resources.container.includes(container)
        )
      )
        throw new Error('Foreign attachment to stand network')
    }
    for (const c of items.container) {
      const id = c.Id
      const service = c.Config.Labels['com.docker.compose.service']
      if (m.images?.[service] && c.Image !== m.images[service])
        throw new Error('Source image generation mismatch')
      const expected = m.model.services[service].environment
      const env = Object.fromEntries(
        c.Config.Env.map((v) => {
          const i = v.indexOf('=')
          return [v.slice(0, i), v.slice(i + 1)]
        })
      )
      for (const [key, value] of Object.entries(expected ?? {}))
        if (env[key] !== String(value)) throw new Error(`Live ${service} environment mismatch`)
      if (
        !Object.values(c.NetworkSettings.Networks).length ||
        Object.values(c.NetworkSettings.Networks).some(
          (n) => !m.resources.network.includes(n.NetworkID)
        )
      )
        throw new Error('Foreign network membership')
      for (const mount of c.Mounts ?? [])
        if (mount.Type === 'volume' && !m.resources.volume.includes(mount.Name))
          throw new Error('Mounted volume is not owned')
      const wanted = m.model.services[service].ports ?? []
      const livePorts = c.HostConfig.PortBindings ?? {}
      for (const [port, bindings] of Object.entries(livePorts))
        for (const binding of bindings ?? []) {
          if (
            !wanted.some(
              (p) =>
                `${p.target}/${p.protocol}` === port &&
                p.host_ip === binding.HostIp &&
                String(p.published) === binding.HostPort
            )
          )
            throw new Error('Unexpected live published port')
        }
      if (
        ['postgres', 'redis', 'api'].includes(service) &&
        !Object.values(c.NetworkSettings.Networks).some((n) => n.Aliases?.includes(service))
      )
        throw new Error('Owned service alias absent')
      if (service === 'postgres') m.postgres = id
      if (service === 'redis') m.redis = id
    }
    if (!m.postgres || !m.redis) throw new Error('Owned infra incomplete')
    if (
      !bootstrap &&
      (
        await execute(psqlArguments(m), {
          capture: true,
          input: 'SELECT uuid FROM stand_meta.identity;',
        })
      ).trim() !== m.uuid
    )
      throw new Error('DB marker mismatch')
    await save(m)
  })
}
export async function cleanup(m, purge) {
  await assertNoSurvivors(m)
  await discover(m)
  for (const id of m.resources.network) {
    const network = await inspect(m, 'network', id)
    if (
      Object.keys(network.Containers ?? {}).some(
        (container) => !m.resources.container.includes(container)
      )
    )
      throw new Error('Foreign attachment refuses resource removal')
  }
  for (const kind of ['container', 'network', ...(purge ? ['volume'] : [])]) {
    for (const id of m.resources[kind]) {
      const item = await inspect(m, kind, id)
      owned(m, item, kind)
      if (kind === 'network' && Object.keys(item.Containers ?? {}).length)
        throw new Error('Attached network refuses deletion')
      await docker(m, [kind, 'rm', ...(kind === 'container' ? ['-f'] : []), id])
    }
  }
  const remaining = await discover(m, false)
  if (remaining.container.length || remaining.network.length || (purge && remaining.volume.length))
    throw new Error('Owned resource removal could not be verified')
  await assertNoSurvivors(m)
  m.resources = remaining
  m.state = purge ? 'purged' : 'stopped'
  await save(m)
}
