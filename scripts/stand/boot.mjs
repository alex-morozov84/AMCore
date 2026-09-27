import { start } from './start.mjs'
import { create } from './create.mjs'
import { cleanup } from './ownership.mjs'

export async function boot(m, fresh) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await start(m)
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
      const images = m.images
      const hash = m.sourceHash
      await cleanup(m, true)
      const next = await create(m.id, m.purpose, m.topology)
      if (hash !== next.sourceHash)
        throw new Error('Source changed during bind recovery; start a fresh review iteration')
      for (const key of Object.keys(m)) delete m[key]
      Object.assign(m, next, { images })
      console.log(`Bind race: new owned allocation ${attempt + 2}/3; built images retained`)
    }
  }
}
