const containerId = /^[0-9a-f]{64}$/
const imageId = /^sha256:[0-9a-f]{64}$/
const nonempty = (value) => typeof value === 'string' && value.length > 0

async function inventory(execute) {
  const output = await execute(['container', 'ls', '-a', '-q', '--no-trunc'], { capture: true })
  const ids = output.trim() ? output.trim().split(/\s+/) : []
  if (ids.some((id) => !containerId.test(id)) || new Set(ids).size !== ids.length)
    throw new Error('Invalid container inventory identities')
  return ids
}

function validate(found, id) {
  if (!Array.isArray(found) || found.length !== 1)
    throw new Error('Incomplete container inspection')
  const item = found[0]
  if (item?.Id !== id || !imageId.test(item.Image) || !Array.isArray(item.Mounts))
    throw new Error('Invalid container inspection identity/references')
  for (const mount of item.Mounts) {
    if (
      !mount ||
      !nonempty(mount.Type) ||
      !nonempty(mount.Destination) ||
      typeof mount.Source !== 'string' ||
      (!mount.Source && mount.Type !== 'tmpfs') ||
      (mount.Type === 'volume' && !nonempty(mount.Name))
    )
      throw new Error('Incomplete container mount references')
  }
  return item
}

async function inspect(execute, id) {
  let output
  try {
    output = await execute(['container', 'inspect', id], { capture: true })
  } catch (error) {
    // Only this CLI missing-object failure can open an independent absence check.
    if (
      !error.message.startsWith('docker failed (1): ') ||
      error.code !== undefined ||
      error.signal != null ||
      error.stderr?.trim() !== `Error response from daemon: No such container: ${id}`
    )
      throw error
    if ((await inventory(execute)).includes(id))
      throw new Error('Missing container absence could not be confirmed')
    return null
  }
  return validate(JSON.parse(output), id)
}

// One finite inventory pass; command wall time remains the stand wrapper's responsibility.
// Surviving foreign consumers must refuse removal even if another listed ID disappeared.
export async function assertUnreferenced(execute, candidates) {
  for (const id of await inventory(execute)) {
    const item = await inspect(execute, id)
    if (!item) continue
    if (
      candidates.some(
        (candidate) => item.Image === candidate || JSON.stringify(item.Mounts).includes(candidate)
      )
    )
      throw new Error('Image referenced by a container; removal refused')
  }
}
