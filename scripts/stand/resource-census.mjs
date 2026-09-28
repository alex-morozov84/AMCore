import { label } from './config.mjs'
export async function resourceCensus(m, execute, owned) {
  const resources = { container: [], network: [], volume: [] }
  const items = { container: [], network: [], volume: [] }
  await Promise.all(
    Object.keys(resources).map(async (kind) => {
      const args = kind === 'container' ? ['container', 'ls', '-aq'] : [kind, 'ls', '-q']
      const ids = (
        await execute([...args, '--filter', `label=${label}=${m.uuid}`], { capture: true })
      )
        .trim()
        .split('\n')
        .filter(Boolean)
      if (!ids.length) return
      const found = JSON.parse(await execute([kind, 'inspect', ...ids], { capture: true }))
      for (const item of orderedInspection(kind, ids, found)) {
        owned(m, item, kind)
        resources[kind].push(kind === 'volume' ? item.Name : item.Id)
        items[kind].push(item)
      }
    })
  )
  return { resources, items }
}

export function orderedInspection(kind, ids, found) {
  if (!Array.isArray(found) || found.length !== ids.length || new Set(ids).size !== ids.length)
    throw new Error('Incomplete resource inspection')
  const keys = found.map((item) => (kind === 'volume' ? item.Name : item.Id))
  if (keys.some((key) => typeof key !== 'string') || new Set(keys).size !== keys.length)
    throw new Error('Invalid resource inspection identities')
  const used = new Set()
  return ids.map((id) => {
    const matches = keys.flatMap((key, index) =>
      (kind === 'volume' ? key === id : key.startsWith(id)) ? [index] : []
    )
    if (matches.length !== 1 || used.has(matches[0]))
      throw new Error('Resource inspection identity mismatch')
    used.add(matches[0])
    return found[matches[0]]
  })
}
