import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

import { SCRIPT_PROVENANCE } from './scripts/script-provenance'

export interface ScriptSourceReader {
  readonly version: string
  source(path: string): string
  compiled(name: string): string
}

/** Refuse upgrades before registering workers or dispatching controls. */
export function verifyScriptProvenance(reader: ScriptSourceReader): void {
  if (reader.version !== SCRIPT_PROVENANCE.version) throw new Error('BULLMQ_VERSION_UNSUPPORTED')
  for (const [name, script] of Object.entries(SCRIPT_PROVENANCE.scripts)) {
    for (const [path, expected] of Object.entries(script.sources))
      if (digest(reader.source(path)) !== expected) throw new Error(`BULLMQ_SOURCE_CHANGED:${path}`)
    if (digest(reader.compiled(name)) !== script.compiledSha256)
      throw new Error(`BULLMQ_COMPILED_CHANGED:${name}`)
  }
}

export function verifyInstalledScriptProvenance(): void {
  const nativeRequire = createRequire(resolve(process.cwd(), 'package.json'))
  const version = (nativeRequire('bullmq/package.json') as { version: string }).version
  verifyScriptProvenance({
    version,
    source: (path) =>
      readFileSync(nativeRequire.resolve(`bullmq/dist/cjs/commands/${path}`), 'utf8'),
    compiled: (name) => {
      const exports = nativeRequire(`bullmq/dist/cjs/scripts/${name}.js`) as Record<
        string,
        { content: string }
      >
      const script = Object.values(exports).find((value) => typeof value.content === 'string')
      if (!script) throw new Error('BULLMQ_SCRIPT_MISSING')
      return script.content
    },
  })
}

function digest(source: string): string {
  return createHash('sha256').update(source).digest('hex')
}
