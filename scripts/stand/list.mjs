import { readdir, access } from 'node:fs/promises'
import { run } from './process.mjs'
import { engine } from './docker.mjs'
import { stateRoot, load } from './state.mjs'

export async function list() {
  for (const entry of await readdir(stateRoot).catch(() => [])) {
    try {
      const m = await load(entry)
      console.log(`${entry}: ${m.state} (${m.uuid})`)
    } catch {
      console.log(`${entry}: invalid record; no ownership granted`)
    }
  }
  const current = await engine()
  for (const kind of ['container', 'network', 'volume']) await listResources(current, kind)
}

async function listResources(current, kind) {
  const ids = (
    await run(
      'docker',
      [
        '--context',
        current.context,
        kind,
        'ls',
        kind === 'container' ? '-aq' : '-q',
        '--filter',
        'label=org.amcore.stand',
      ],
      { capture: true }
    )
  )
    .trim()
    .split('\n')
    .filter(Boolean)
  for (const id of ids) {
    const [c] = JSON.parse(
      await run('docker', ['--context', current.context, kind, 'inspect', id], {
        capture: true,
      })
    )
    const tags = c.Config?.Labels ?? c.Labels ?? {}
    const path = tags['org.amcore.worktree']
    const exists =
      typeof path === 'string' &&
      (await access(path).then(
        () => true,
        () => false
      ))
    console.log(
      `${tags['org.amcore.stand']}: ${kind} ${c.State?.Status ?? ''}, ${exists ? 'source present' : 'orphan source missing'}, ${id}`
    )
  }
}
