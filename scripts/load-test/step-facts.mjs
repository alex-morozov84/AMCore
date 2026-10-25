// Reads the files run-step.sh collected for one step into plain facts for classify.mjs.
// A missing or unreadable file becomes undefined (or -1 for an exit code), never zero.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (dir, name) => {
  try {
    return readFileSync(join(dir, name), 'utf8')
  } catch {
    return undefined
  }
}
const json = (text) => {
  try {
    return text === undefined ? undefined : JSON.parse(text)
  } catch {
    return undefined
  }
}
const lines = (text = '') => text.split('\n').filter(Boolean)

// Host sampler: "<epoch> host avail=<MiB>"; container and vmstat lines stay for the report.
export const parseSamples = (text) =>
  lines(text)
    .map((l) => l.match(/^(\d+) host avail=(\d+)$/))
    .filter(Boolean)
    .map((m) => ({ ts: Number(m[1]), memAvailableMiB: Number(m[2]) }))

// Generator sampler: "<epoch> idle=<percent>".
export const parseGenerator = (text) =>
  lines(text)
    .map((l) => l.match(/^(\d+) idle=(\d+)$/))
    .filter(Boolean)
    .map((m) => ({ ts: Number(m[1]), idlePct: Number(m[2]) }))

// Containers: "<name> <id> <restart-count> <oom-killed>" per line, before and after.
export function containerChange(before = '', after = '') {
  const parse = (t) =>
    new Map(
      lines(t)
        .map((l) => l.split(' '))
        .filter((p) => p.length === 4)
        .map(([name, id, restarts, oom]) => [name, { id, restarts: Number(restarts), oom }])
    )
  const a = parse(before)
  const b = parse(after)
  const same = a.size > 0 && a.size === b.size && [...a.keys()].every((n) => b.has(n))
  if (!same) return { containersMissing: true, restarts: 0, recreated: [], oomKilled: false }
  const recreated = [...b].filter(([n, x]) => x.id !== a.get(n).id).map(([n]) => n)
  const restarts = [...b].reduce(
    (sum, [n, x]) => sum + Math.max(0, x.restarts - a.get(n).restarts),
    0
  )
  const oomKilled = [...b.values()].some((x) => x.oom === 'true')
  return { containersMissing: false, restarts, recreated, oomKilled }
}

export function factsFromDir(dir) {
  const exit = (name) => {
    const t = read(dir, name)?.trim()
    return t && /^\d+$/.test(t) ? Number(t) : -1
  }
  const clock = json(read(dir, 'clock.json'))
  return {
    k6Exit: exit('k6.exit'),
    k6Summary: json(read(dir, 'summary.json')),
    window: json(read(dir, 'window.json')),
    skewS: typeof clock?.skewS === 'number' ? clock.skewS : undefined,
    skewUncertaintyS:
      typeof clock?.skewUncertaintyS === 'number' ? clock.skewUncertaintyS : undefined,
    server: json(read(dir, 'server.json')),
    statsError: read(dir, 'server.err')?.trim() || undefined,
    samplerExit: exit('sampler.exit'),
    samples: parseSamples(read(dir, 'samples.txt')),
    generator: parseGenerator(read(dir, 'generator.txt')),
    ...containerChange(read(dir, 'containers.before'), read(dir, 'containers.after')),
  }
}
