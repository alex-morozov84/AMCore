import { start } from './start.mjs'
import { create } from './create.mjs'
import { cleanup } from './ownership.mjs'

const defaults = { start, create, cleanup }

export async function boot(m, fresh, steps = defaults) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await steps.start(m)
      return
    } catch (error) {
      if (
        !fresh ||
        !/port is already allocated|address already in use|Bind for .* failed/i.test(
          error.stderr ?? ''
        ) ||
        attempt === 2
      )
        throw error
      const hash = m.sourceHash
      // The old allocation is purged first, including the images it built. The new
      // identity rebuilds (from the build cache) instead of inheriting images that
      // carry the old stand's ownership labels.
      await steps.cleanup(m, true)
      const next = await steps.create(m.id, m.purpose, m.topology)
      if (hash !== next.sourceHash)
        throw new Error('Source changed during bind recovery; start a fresh review iteration')
      for (const key of Object.keys(m)) delete m[key]
      Object.assign(m, next)
      console.log(`Bind race: new owned allocation ${attempt + 2}/3; images rebuild from cache`)
    }
  }
}
