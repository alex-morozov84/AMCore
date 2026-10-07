import { label, labels, builtServices } from './config.mjs'
import { orderedInspection } from './resource-census.mjs'

const fullId = /^sha256:[0-9a-f]{64}$/
const gone = (error) => /no such (image|object)|not found/i.test(error.stderr ?? error.message)
const lines = (output) =>
  output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

// Physical ownership proof for one built image: the full ownership tuple (which only this
// stand's generated override writes), a Compose project label that matches if present, and
// references limited to this stand's own generated names. A name pattern or the current
// `m.images` map alone never proves anything.
//
// One image may carry SEVERAL generated names: engines that merge identical builds (the
// classic image store on Linux) export `api` and `worker` as one image with two tags, and
// then keep a single `com.docker.compose.service` label, so the service label is not part
// of the proof. Every reference must still be one of this stand's own names.
export function ownedImage(m, image) {
  const tags = image.Config?.Labels ?? {}
  const wrong = Object.entries(labels(m)).filter(([key, value]) => tags[key] !== value)
  const project = tags['com.docker.compose.project']
  if (!fullId.test(image.Id) || wrong.length || (project !== undefined && project !== m.project))
    throw new Error(
      `Unproved image ownership (${[
        ...(fullId.test(image.Id) ? [] : ['id']),
        ...wrong.map(([key]) => key),
        ...(project === undefined || project === m.project ? [] : ['compose project']),
      ].join(', ')})`
    )
  const names = builtServices.map((service) => `${m.project}-${service}`)
  const allowed = new Set(names.map((name) => `${name}:latest`))
  const digest = new RegExp(`^(${names.join('|')})@sha256:[0-9a-f]{64}$`)
  if (
    (image.RepoTags ?? []).some((tag) => !allowed.has(tag)) ||
    (image.RepoDigests ?? []).some((ref) => !digest.test(ref))
  )
    throw new Error('Foreign image reference')
  return image.RepoTags ?? []
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
    tags: ownedImage(m, item),
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

// Removes proved-owned images, never forced and never pruning parents, and succeeds only
// on positively verified absence. Every reference of a candidate is proved to be this
// stand's own generated name, so those names are untagged first (an image that carries
// several cannot be removed by ID while a second reference remains; the last untag
// deletes it), then the full ID is removed. A foreign alias added after the proof leaves
// the ID removal refused, which is reported, never forced.
export async function disposeImages(m, execute, save) {
  const owned = await imageCensus(m, execute)
  if (!owned.length) return []
  await assertUnreferenced(
    execute,
    owned.map(({ id }) => id)
  )
  m.imageDisposal = { candidates: owned, startedAt: new Date().toISOString() }
  await save(m)
  const remove = (target) =>
    execute(['image', 'rm', '--no-prune', target], { capture: true }).catch((error) => {
      if (!gone(error)) throw new Error(`Owned image removal refused: ${error.message}`)
    })
  for (const { id } of owned) {
    let references
    try {
      const [fresh] = JSON.parse(await execute(['image', 'inspect', id], { capture: true }))
      references = ownedImage(m, fresh)
    } catch (error) {
      if (gone(error)) continue
      throw error
    }
    for (const reference of references) await remove(reference)
    await remove(id)
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
