// The private overlay may change only the native CLI URL, never the topology.
import { isDeepStrictEqual } from 'node:util'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export function checkOverride(baseline, effective) {
  const strip = (value) => {
    const copy = globalThis.structuredClone(value)
    if (copy.services?.migrate?.environment) delete copy.services.migrate.environment.DATABASE_URL
    return copy
  }
  return isDeepStrictEqual(strip(baseline), strip(effective))
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const configs = process.argv.slice(2).map((p) => JSON.parse(readFileSync(p, 'utf8')))
  if (configs.length !== 2 || !checkOverride(...configs)) {
    console.error('load-test: private override changes more than migrate DATABASE_URL')
    process.exit(1)
  }
}
