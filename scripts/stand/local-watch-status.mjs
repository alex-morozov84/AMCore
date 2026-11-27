import { basename } from 'node:path'
import { composeArguments } from './docker.mjs'
import { processTable } from './process-groups.mjs'

export function localWatchStatus(stand, processes = processTable) {
  if (!stand.watchExpected) return
  try {
    const [, ...args] = composeArguments(stand)
    const invocation = ` ${args.join(' ')} watch`
    return processes().some(
      ({ uid, command }) =>
        uid === process.getuid() &&
        ['docker', 'docker-compose'].includes(basename(command.split(' ', 1)[0])) &&
        (command.endsWith(invocation) || command.includes(`${invocation} `))
    )
      ? 'running'
      : 'stopped'
  } catch {
    return 'unknown'
  }
}
