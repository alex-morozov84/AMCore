export function dockerPins(path, text) {
  const found = new Map()
  for (const match of text.matchAll(
    /^FROM\s+(\S+?:\S+?)@sha256:([a-f0-9]{64})(?:\s+AS\s+(\S+))?/gim
  )) {
    const [, ref, pinned, stage] = match
    const key = `${ref}@${pinned}`
    if (!found.has(key)) found.set(key, { path, ref, pinned, stages: [] })
    if (stage) found.get(key).stages.push(stage)
  }
  return [...found.values()]
}
