import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

import {
  type ScriptSourceReader,
  verifyInstalledScriptProvenance,
  verifyScriptProvenance,
} from './script-provenance'

describe('Pinned BullMQ source guard', () => {
  const nativeRequire = createRequire(resolve(process.cwd(), 'package.json'))
  const installed: ScriptSourceReader = {
    version: '6.3.11',
    source: (path) =>
      readFileSync(nativeRequire.resolve(`bullmq/dist/cjs/commands/${path}`), 'utf8'),
    compiled: (name) => {
      const values = Object.values(nativeRequire(`bullmq/dist/cjs/scripts/${name}.js`)) as {
        content: string
      }[]
      return values[0]!.content
    },
  }

  it('accepts the installed exact release and recursive source graph', () => {
    expect(() => verifyInstalledScriptProvenance()).not.toThrow()
  })

  it('refuses a modified transitive include', () => {
    expect(() =>
      verifyScriptProvenance({
        ...installed,
        source: (path) =>
          installed.source(path) +
          (path === 'includes/getNextDelayedTimestamp.lua' ? '\n-- changed' : ''),
      })
    ).toThrow('BULLMQ_SOURCE_CHANGED:includes/getNextDelayedTimestamp.lua')
  })

  it('refuses changed expanded compiled content even with unchanged includes', () => {
    expect(() =>
      verifyScriptProvenance({
        ...installed,
        compiled: (name) => installed.compiled(name) + '\n-- changed',
      })
    ).toThrow('BULLMQ_COMPILED_CHANGED:pause-7')
  })

  it('refuses a version change', () => {
    expect(() => verifyScriptProvenance({ ...installed, version: '6.3.12' })).toThrow(
      'BULLMQ_VERSION_UNSUPPORTED'
    )
  })
})
