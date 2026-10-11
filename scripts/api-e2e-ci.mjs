import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

try {
  const { root } = await import('./api-e2e/paths.mjs')
  const { prepare, preflight } = await import('./api-e2e/prepare.mjs')
  const args = process.argv.slice(2).filter((arg) => arg !== '--')
  if (!args.length) args.push('--all')
  if (args[0] === '--prepare' && args.length === 1) prepare()
  else {
    preflight()
    const { plan } = await import('./api-e2e/inventory.mjs')
    const { runShard } = await import('./api-e2e/run.mjs')
    const shardArg = args.find((arg) => arg.startsWith('--shard='))?.slice(8)
    const planning = args[0]?.match(/^--plan=([1-3])$/)
    const output = resolve(process.env.API_E2E_OUTPUT || resolve(root, '.amcore/api-e2e-results'))
    let current = plan(
      planning ? Number(planning[1]) : shardArg ? Number(shardArg.split('/')[1]) : 1
    )
    const focused = args[0] === '--runTestsByPath' ? args.slice(1) : null
    if (focused) {
      const paths = focused.map((path) =>
        current.all.find(
          (known) => resolve(root, 'apps/api', known) === resolve(process.cwd(), path)
        )
      )
      if (paths.some((path) => !path) || new Set(paths).size !== paths.length || !paths.length)
        throw new Error('Unknown/duplicate focused paths')
      current = { ...current, shards: [{ id: 'focused', paths }] }
    } else if (
      args.length !== 1 ||
      (!planning && args[0] !== '--all' && !/^--shard=[1-3]\/[1-3]$/.test(args[0]))
    )
      throw new Error('Use --all, --plan=n or --shard=i/n')
    if (shardArg && !current.shards.some((item) => item.id === shardArg))
      throw new Error('Invalid shard identity')
    mkdirSync(output, { recursive: true })
    writeFileSync(resolve(output, 'plan.json'), JSON.stringify(current))
    if (planning) console.log(JSON.stringify({ shard: current.shards.map((item) => item.id) }))
    else
      for (const shard of current.shards.filter((item) => !shardArg || item.id === shardArg)) {
        const report = await runShard(current, shard, resolve(output, shard.id.replace('/', '-')))
        if (!report.success) throw new Error('API E2E failed')
      }
  }
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
