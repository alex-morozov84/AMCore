import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execute = promisify(execFile)
async function docker(args, timeout = 5000) {
  const { stdout } = await execute('docker', args, {
    timeout,
    killSignal: 'SIGKILL',
    maxBuffer: 1024 * 1024,
  })
  return stdout.trim()
}
export async function ownedContainers(run, attempt, deadline = performance.now() + 5000) {
  const remaining = () => {
    const value = deadline - performance.now()
    if (value <= 0) throw new Error('Container inspection deadline exceeded')
    return Math.max(1, Math.floor(value))
  }
  const text = await docker(
    [
      'ps',
      '-aq',
      '--filter',
      `label=amcore.e2e.run=${run}`,
      '--filter',
      `label=amcore.e2e.attempt=${attempt}`,
    ],
    remaining()
  )
  const ids = text.split(/\s+/).filter(Boolean)
  for (const id of ids) {
    const value = JSON.parse(
      await docker(['inspect', '--format', '{{json .Config.Labels}}', id], remaining())
    )
    if (
      value['amcore.e2e.run'] !== run ||
      value['amcore.e2e.attempt'] !== attempt ||
      value['org.testcontainers.ryuk']
    )
      throw new Error('Container ownership mismatch')
  }
  return ids
}
export async function cleanOwned(run, attempt, emergency = false) {
  const began = performance.now()
  const ids = await ownedContainers(run, attempt, began + (emergency ? 20_000 : 5000))
  if (!ids.length) return true
  if (!emergency) return false
  for (const id of ids) {
    const remaining = 20_000 - (performance.now() - began)
    if (remaining <= 0) throw new Error('Emergency cleanup deadline exceeded')
    await docker(['rm', '-f', id], Math.min(10_000, remaining))
  }
  return (await ownedContainers(run, attempt, began + 20_000)).length === 0
}
