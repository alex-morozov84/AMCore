import { label, labels, builtServices } from './config.mjs'
import { orderedInspection } from './resource-census.mjs'

const fullId = /^sha256:[0-9a-f]{64}$/
const gone = (error) => /no such (image|object)|not found/i.test(error.stderr ?? error.message)
const lines = (output) =>
  output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

// Physical ownership proof for one built image: the full ownership tuple, the Compose
// project/service labels, and references limited to this stand's own generated name.
// A name pattern or the current `m.images` map alone never proves anything.
export function ownedImage(m, image) {
  const tags = image.Config?.Labels ?? {}
  const service = tags['com.docker.compose.service']
  if (
    !fullId.test(image.Id) ||
    Object.entries(labels(m)).some(([key, value]) => tags[key] !== value) ||
    tags['com.docker.compose.project'] !== m.project ||
    !builtServices.includes(service)
  )
    throw new Error('Unproved image ownership')
  const repository = `${m.project}-${service}`
  const digest = new RegExp(`^${repository}@sha256:[0-9a-f]{64}$`)
  if (
    (image.RepoTags ?? []).some((tag) => tag !== `${repository}:latest`) ||
    (image.RepoDigests ?? []).some((ref) => !digest.test(ref))
  )
    throw new Error('Foreign image reference')
  return service
}

// Positive label census of everything this stand built, including dangling and
// partial generations that `m.images` (the current runtime generation) cannot know.
export async function imageCensus(m, execute) {
  const listed = await execute(
    ['image', 'ls', '-a', '--no-trunc', '-q', '--filter', `label=${label}=${m.uuid}`],
    { capture: true }
  )
  const ids = [...new Set(lines(listed))]
  if (ids.some((id) => !fullId.test(id))) throw new Error('Incomplete image identity')
  if (!ids.length) return []
  const found = JSON.parse(await execute(['image', 'inspect', ...ids], { capture: true }))
  return orderedInspection('image', ids, found).map((item) => ({
    id: item.Id,
    service: ownedImage(m, item),
  }))
}

// Any container in any state that still uses a candidate refuses removal.
async function assertUnreferenced(execute, candidates) {
  const ids = lines(await execute(['container', 'ls', '-a', '-q', '--no-trunc'], { capture: true }))
  if (!ids.length) return
  const found = JSON.parse(await execute(['container', 'inspect', ...ids], { capture: true }))
  for (const container of orderedInspection('container', ids, found)) {
    const used = candidates.some(
      (id) => container.Image === id || JSON.stringify(container.Mounts ?? []).includes(id)
    )
    if (used) throw new Error('Image referenced by a container; removal refused')
  }
}

// Removes proved-owned images by full ID (never by tag, never forced, never pruning
// parents) and succeeds only on positively verified absence.
export async function disposeImages(m, execute, save) {
  const owned = await imageCensus(m, execute)
  if (!owned.length) return []
  await assertUnreferenced(
    execute,
    owned.map(({ id }) => id)
  )
  m.imageDisposal = { candidates: owned, startedAt: new Date().toISOString() }
  await save(m)
  for (const { id } of owned) {
    try {
      const [fresh] = JSON.parse(await execute(['image', 'inspect', id], { capture: true }))
      ownedImage(m, fresh)
    } catch (error) {
      if (gone(error)) continue
      throw error
    }
    await execute(['image', 'rm', '--no-prune', id], { capture: true }).catch((error) => {
      if (!gone(error)) throw new Error(`Owned image removal refused: ${error.message}`)
    })
  }
  if ((await imageCensus(m, execute)).length)
    throw new Error('Owned image removal could not be verified')
  m.imageDisposal.verifiedAt = new Date().toISOString()
  await save(m)
  return owned
}

// Closeout's final inventory: any image labelled for this worktree is unrecorded work.
export async function worktreeImages(worktree, execute) {
  return lines(
    await execute(
      [
        'image',
        'ls',
        '-a',
        '--no-trunc',
        '-q',
        '--filter',
        `label=org.amcore.worktree=${worktree}`,
      ],
      { capture: true }
    )
  )
}
