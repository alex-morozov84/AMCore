const fields = [
  'version',
  'id',
  'uuid',
  'attempt',
  'purpose',
  'topology',
  'worktree',
  'snapshot',
  'project',
  'engine',
  'origins',
  'ports',
  'hostnames',
  'sourceHash',
  'configHash',
  'envFile',
  'overlay',
  'model',
  'resources',
  'services',
  'postgres',
  'redis',
  'images',
  'caFile',
  'relay',
  'lane',
  'runToken',
  'controlSocket',
]
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])])
    )
  return value
}
export function targetProof(manifest) {
  return JSON.stringify(canonical(Object.fromEntries(fields.map((key) => [key, manifest[key]]))))
}
