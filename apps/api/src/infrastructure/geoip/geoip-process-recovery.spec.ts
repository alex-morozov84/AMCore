import { fork } from 'node:child_process'
import { once } from 'node:events'
import { copyFile, mkdtemp, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

it('a separate API-reader process recovers after an updater process publishes a shared file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'amcore-geoip-process-'))
  const path = join(dir, 'live.mmdb')
  const child = fork(join(__dirname, '../../../test/fixtures/geoip/reader-process.ts'), [path], {
    execArgv: ['--import', require.resolve('tsx')],
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  })
  try {
    const [ready] = await Promise.race([
      once(child, 'message'),
      once(child, 'exit').then(() => {
        throw new Error('Reader child exited before ready')
      }),
    ])
    expect(ready).toEqual({ ready: true, location: null })
    await copyFile(
      join(__dirname, '../../../test/fixtures/geoip/GeoIP2-City-Test.mmdb'),
      join(dir, 'next')
    )
    await rename(join(dir, 'next'), path)
    const response = once(child, 'message')
    child.send('poll')
    expect((await response)[0]).toEqual({ location: { city: 'Лондон', countryCode: 'GB' } })
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const closed = once(child, 'exit')
      child.kill()
      await closed
    }
    await rm(dir, { recursive: true, force: true })
  }
}, 15000)
