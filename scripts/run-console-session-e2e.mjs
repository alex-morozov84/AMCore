import { run } from './stand/process.mjs'
import { root } from './stand/state.mjs'
import { cancellation } from './stand/cancellation.mjs'

const operation = await cancellation()
try {
  await run(
    process.execPath,
    ['scripts/stand.mjs', 'e2e', '--lane', 'console-real-stack', '--id', operation.standId],
    {
      cwd: root,
      signal: operation.signal,
    }
  )
} catch (error) {
  if (!operation.interrupted) throw error
  console.error(`Wrapper cancelled: ${error.message}`)
} finally {
  await operation.finish()
}
