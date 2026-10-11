export function validatePlan(plan) {
  if (
    plan?.schemaVersion !== 1 ||
    !/^[a-f0-9]{40}$/.test(plan.sha) ||
    !/^[a-f0-9]{64}$/.test(plan.inputs) ||
    typeof plan.run !== 'string' ||
    !plan.run ||
    typeof plan.runAttempt !== 'string' ||
    !plan.runAttempt ||
    (plan.pullRequestHead !== null && !/^[a-f0-9]{40}$/.test(plan.pullRequestHead)) ||
    !Array.isArray(plan.all) ||
    !plan.all.length ||
    !Array.isArray(plan.shards) ||
    !plan.shards.length ||
    plan.shards.length > 3
  )
    throw new Error('Invalid API E2E plan provenance')
  const validPath = (path) =>
    typeof path === 'string' &&
    path.startsWith('test/') &&
    path.endsWith('.e2e-spec.ts') &&
    !path.includes('..') &&
    !path.includes('\\')
  if (
    !plan.all.every(validPath) ||
    new Set(plan.all).size !== plan.all.length ||
    plan.shards.some(
      (shard, index) =>
        shard.id !== `${index + 1}/${plan.shards.length}` ||
        !Array.isArray(shard.paths) ||
        !shard.paths.length ||
        !shard.paths.every(validPath)
    )
  ) {
    throw new Error('Invalid API E2E plan inventory')
  }
  const union = plan.shards.flatMap((shard) => shard.paths)
  if (
    new Set(union).size !== union.length ||
    JSON.stringify([...union].sort()) !== JSON.stringify([...plan.all].sort())
  ) {
    throw new Error('Incomplete/duplicate API E2E plan partition')
  }
}
