const LOCALE_TOPOLOGIES = ['multi', 'single']
const CONSOLE_TOPOLOGIES = ['path', 'host', 'disabled']
const TOGGLES = ['enabled', 'disabled']
const HISTORICAL_RECIPES = [
  'single-locale-en',
  'route-progress-disabled',
  'storybook-disabled-install-before',
  'storybook-disabled-manual-verify-after',
  'admin-console-path-panel',
  'admin-console-host-panel',
  'admin-console-single-locale-ru-host-panel',
  'admin-console-single-locale-en-disabled',
]
const HISTORICAL_OBLIGATIONS = {
  'single-locale-en': ['typecheck', 'lint', 'build', 'api-test', 'web-test'],
  'route-progress-disabled': ['typecheck', 'lint', 'build', 'api-test', 'web-test'],
  'storybook-disabled-install-before': ['install'],
  'storybook-disabled-manual-verify-after': ['typecheck', 'lint', 'build', 'api-test', 'web-test'],
  'admin-console-path-panel': ['typecheck', 'lint', 'build', 'web-test'],
  'admin-console-host-panel': ['typecheck', 'lint', 'build', 'web-test'],
  'admin-console-single-locale-ru-host-panel': ['build'],
  'admin-console-single-locale-en-disabled': ['build'],
}

const cross = (left, right, label) => left.flatMap((a) => right.map((b) => `${label}:${a}/${b}`))

export function requiredCoverage() {
  return new Set([
    ...cross(LOCALE_TOPOLOGIES, CONSOLE_TOPOLOGIES, 'topology'),
    ...cross(LOCALE_TOPOLOGIES, TOGGLES, 'locale/storybook'),
    ...cross(LOCALE_TOPOLOGIES, TOGGLES, 'locale/route-progress'),
    ...cross(CONSOLE_TOPOLOGIES, TOGGLES, 'console/storybook'),
    ...cross(CONSOLE_TOPOLOGIES, TOGGLES, 'console/route-progress'),
    ...cross(TOGGLES, TOGGLES, 'storybook/route-progress'),
    'locale-value:en',
    'locale-value:ru',
    'proxy:multi-host',
    'proxy:single-host',
    ...HISTORICAL_RECIPES.map((name) => `historical:${name}`),
  ])
}

export function rowCoverage(row) {
  const f = row.factors
  return new Set([
    `topology:${f.localeTopology}/${f.console}`,
    `locale/storybook:${f.localeTopology}/${f.storybook}`,
    `locale/route-progress:${f.localeTopology}/${f.routeProgress}`,
    `console/storybook:${f.console}/${f.storybook}`,
    `console/route-progress:${f.console}/${f.routeProgress}`,
    `storybook/route-progress:${f.storybook}/${f.routeProgress}`,
    ...f.locales.map((locale) => `locale-value:${locale}`),
    ...(f.proxy === 'none' ? [] : [`proxy:${f.proxy}`]),
    ...row.replaces.map((name) => `historical:${name}`),
  ])
}

function commandCounts(row) {
  const labels = row.postApplySteps.map((args) => args.join(' '))
  return {
    builds: labels.filter((label) => /(^| )build( |$)/.test(label)).length,
    installs: Number(Boolean(row.installBefore)) + Number(Boolean(row.installAfter)),
  }
}

function capabilities(row) {
  const result = new Set(['install'])
  for (const args of row.postApplySteps) {
    const label = args.join(' ')
    if (args[0] === 'typecheck') result.add('typecheck')
    if (args[0] === 'lint') result.add('lint')
    if (/(^| )build( |$)/.test(label)) result.add('build')
    if (label === '--filter api test') result.add('api-test')
    if (label === '--filter web test') result.add('web-test')
  }
  return result
}

function validateHistoricalAssignments(rows, errors) {
  for (const name of HISTORICAL_RECIPES) {
    const assigned = rows.filter((row) => row.replaces.includes(name))
    if (assigned.length !== 1) errors.push(`${name}: expected exactly one retained row`)
    if (assigned.length !== 1) continue
    const available = capabilities(assigned[0])
    const missing = HISTORICAL_OBLIGATIONS[name].filter((item) => !available.has(item))
    if (missing.length > 0) errors.push(`${name}: missing obligations ${missing.join(', ')}`)
  }
}

export function validateCoveringScenarios(rows) {
  const covered = new Set(rows.flatMap((row) => [...rowCoverage(row)]))
  const missing = [...requiredCoverage()].filter((token) => !covered.has(token))
  const names = rows.map((row) => row.name)
  const errors = []
  if (rows.length > 6) errors.push(`expected at most 6 rows, received ${rows.length}`)
  if (new Set(names).size !== names.length) errors.push('scenario names must be unique')
  for (const row of rows) {
    const counts = commandCounts(row)
    if (counts.installs !== 1) errors.push(`${row.name}: expected exactly one install`)
    if (counts.builds !== 1) errors.push(`${row.name}: expected exactly one build command`)
  }
  validateHistoricalAssignments(rows, errors)
  if (missing.length > 0) errors.push(`missing coverage: ${missing.join(', ')}`)
  return errors
}
