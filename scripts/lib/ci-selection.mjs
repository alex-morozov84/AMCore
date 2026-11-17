const areaNames = [
  'docs',
  'ui',
  'web',
  'api',
  'common',
  'infra',
  'monitoring',
  'tools',
  'email',
  'deployment',
  'unknown',
]

/** Decode file lists without repeating the action's glob implementation. */
export function normalizeCiAreas(outputs) {
  const names = ['all', ...areaNames.filter((name) => name !== 'unknown')]
  const files = Object.fromEntries(
    names.map((name) => {
      const list = JSON.parse(outputs[`${name}_files`])
      if (!Array.isArray(list) || list.some((file) => typeof file !== 'string' || !file))
        throw new Error(`Invalid changed-file list: ${name}`)
      return [name, new Set(list)]
    })
  )
  const known = new Set(names.filter((name) => name !== 'all').flatMap((name) => [...files[name]]))
  if ([...known].some((file) => !files.all.has(file)))
    throw new Error('Changed-file lists disagree with the complete action list')
  return Object.fromEntries(
    areaNames.map((name) => {
      if (name === 'unknown') return [name, [...files.all].some((file) => !known.has(file))]
      const excluded = name === 'web' ? files.ui : name === 'infra' ? files.monitoring : new Set()
      return [name, [...files[name]].some((file) => !excluded.has(file))]
    })
  )
}

/** Inputs are normalized action outputs, not paths: the action owns the only glob matcher. */
export function selectCiGroups({ role, mode, areas, diffComplete, integration = false }) {
  if (
    !['upstream-starter', 'downstream-product'].includes(role) ||
    !['normal', 'full', 'heavy-off'].includes(mode) ||
    typeof diffComplete !== 'boolean' ||
    typeof integration !== 'boolean' ||
    !areas ||
    typeof areas !== 'object' ||
    Array.isArray(areas) ||
    Object.keys(areas).some((key) => !areaNames.includes(key) || typeof areas[key] !== 'boolean')
  )
    throw new Error('Invalid CI selection inputs')
  if (role === 'upstream-starter' && mode === 'heavy-off')
    throw new Error('AMCore starter checks cannot use heavy-off')
  const a = (key) => areas[key] === true
  const known = Object.values(areas).some(Boolean)
  const full =
    mode === 'full' ||
    !diffComplete ||
    integration ||
    !known ||
    a('unknown') ||
    a('common') ||
    a('tools')
  const code = full || ['ui', 'web', 'api', 'infra', 'tools', 'email', 'deployment'].some(a)
  const heavy = mode !== 'heavy-off'
  const api = full || a('api')
  const web = full || a('ui') || a('web') || a('api') || a('infra') || a('deployment')
  const runtime = full || a('web') || a('api') || a('infra') || a('deployment')
  const upstream = role === 'upstream-starter'
  return {
    quality: code ? 'code' : 'docs',
    static: true,
    scripts: heavy && code,
    build: heavy && (full || a('ui') || a('web') || a('api') || a('deployment')),
    api: heavy && api,
    redis: heavy && (full || a('web') || a('api')),
    web: heavy && web ? (runtime ? 'runtime' : 'ui') : 'none',
    storybook: heavy && (full || a('ui') || a('web')),
    capability: heavy && upstream && api,
    notification: heavy && api,
    images: heavy && (full || a('api') || a('infra')),
    monitoring: heavy && (full || a('api') || a('monitoring')) ? 'live' : 'static',
    portability:
      heavy && upstream
        ? [
            ...(api ? ['api'] : []),
            ...(full || a('ui') || a('web') ? ['web'] : []),
            ...(full ? ['shared'] : []),
          ]
        : [],
    fleet: heavy && upstream && runtime,
    email: full || a('email'),
    deployment: heavy && (full || a('deployment')),
    safety: heavy && (full || a('tools')),
  }
}
