import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

const script = resolve('scripts/recovery-files.sh')

test('volume absence/foreign ownership/consumer and inspection failures refuse before mounting', () => {
  for (const failure of ['missing', 'foreign', 'running', 'transport']) {
    const directory = mkdtempSync(join(tmpdir(), 'recovery-volume-'))
    try {
      mkdirSync(join(directory, 'bin'))
      const log = join(directory, 'calls')
      const body = `#!/bin/sh
printf '%s\\n' "$*" >> '${log}'
case "$*" in
  'volume inspect'*)
    [ '${failure}' != missing ] || exit 1
    case "$*" in *com.docker.compose.project*) echo '${failure === 'foreign' ? 'other' : 'test'}' ;; *) echo local_storage ;; esac ;;
  'ps '*)
    [ '${failure}' != transport ] || exit 125
    [ '${failure}' != running ] || echo active ;;
  *) exit 97 ;;
esac
`
      writeFileSync(join(directory, 'bin/docker'), body)
      chmodSync(join(directory, 'bin/docker'), 0o755)
      const result = spawnSync('sh', [script, 'backup', 'test', 'volume', directory], {
        env: { ...process.env, PATH: `${directory}/bin:${process.env.PATH}` },
        encoding: 'utf8',
      })
      assert.notEqual(result.status, 0, failure)
      assert.doesNotMatch(readFileSync(log, 'utf8'), /^run /m, failure)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  }
})
