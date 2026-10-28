// Limit recovery to Caddy and already-owned resources; never reconcile database volumes.
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

function existing(definitions, inventory, keys, project, kind) {
  return Object.fromEntries(
    keys.map((key) => {
      const name = definitions?.[key]?.name
      const resource = inventory.find((item) => item.Name === name)
      if (
        !name ||
        !resource ||
        resource.Labels?.['com.docker.compose.project'] !== project ||
        resource.Labels?.[`com.docker.compose.${kind}`] !== key
      ) {
        throw new Error(`recover: missing or foreign ${kind} ${key}; nothing recreated`)
      }
      return [key, { name, external: true }]
    })
  )
}

export function caddyRecoveryModel(config, resources, project) {
  if (config.name !== project || !/^amcore-loadtest-[a-z0-9]{4,32}$/.test(project))
    throw new Error('recover: configuration is not this load project')
  const caddy = globalThis.structuredClone(config.services?.caddy)
  if (
    !caddy ||
    caddy.container_name ||
    caddy.network_mode ||
    caddy.links ||
    caddy.volumes_from ||
    caddy.secrets?.length ||
    caddy.configs?.length
  )
    throw new Error('recover: unsupported Caddy resources; nothing recreated')
  delete caddy.depends_on
  const mounts = caddy.volumes ?? []
  if (mounts.some((mount) => !['bind', 'volume'].includes(mount.type)))
    throw new Error('recover: unsupported Caddy mount; nothing recreated')
  const volumeKeys = [...new Set(mounts.filter((v) => v.type === 'volume').map((v) => v.source))]
  if (volumeKeys.some((key) => !['caddy_data', 'caddy_config'].includes(key)))
    throw new Error('recover: Caddy may only reuse its own data/config volumes')
  return {
    name: project,
    services: { caddy },
    volumes: existing(config.volumes, resources.volumes, volumeKeys, project, 'volume'),
    networks: existing(
      config.networks,
      resources.networks,
      Object.keys(caddy.networks ?? { default: {} }),
      project,
      'network'
    ),
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [directory, project] = process.argv.slice(2)
  const read = (name) => JSON.parse(readFileSync(`${directory}/${name}.json`, 'utf8'))
  const resources = { volumes: read('volumes'), networks: read('networks') }
  const model = caddyRecoveryModel(read('config'), resources, project)
  process.stdout.write(JSON.stringify(model))
}
