// Two fixed CI shards over SCAFFOLD_COVERING_SCENARIOS. Unset shard = all scenarios.
export const SCAFFOLD_CI_SHARDS = {
  a: ['coverage-multi-path', 'coverage-multi-disabled', 'coverage-single-en-path-route-off'],
  b: [
    'coverage-multi-host-route-off',
    'coverage-single-ru-host',
    'coverage-single-en-disabled-route-off',
  ],
}

export function selectShard(shard, scenarios, exhaustive, shards = SCAFFOLD_CI_SHARDS) {
  if (shard === undefined) return scenarios
  if (exhaustive) throw new Error('AMCORE_SCAFFOLD_SHARD is only valid for the covering array')
  if (!Object.hasOwn(shards, shard)) throw new Error(`Unknown scaffold shard: "${shard}"`)
  const names = shards[shard]
  if (!Array.isArray(names) || names.length === 0)
    throw new Error(`Scaffold shard ${shard} is empty`)
  const known = new Set(scenarios.map((scenario) => scenario.name))
  for (const name of names) {
    if (!known.has(name)) throw new Error(`Scaffold shard ${shard}: unknown scenario "${name}"`)
  }
  if (new Set(names).size !== names.length)
    throw new Error(`Scaffold shard ${shard}: duplicate scenario`)
  return scenarios.filter((scenario) => names.includes(scenario.name))
}
