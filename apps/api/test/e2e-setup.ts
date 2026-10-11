import { randomBytes } from 'node:crypto'

import { cleanupE2E } from './e2e-cleanup'

// One secret per Jest suite also keeps secondary apps and repeated bootstraps
// consistent with the cached AppModule configuration.
const jwtSecret = randomBytes(32).toString('hex')

export function prepareE2EAuthEnvironment(): void {
  process.env.JWT_SECRET = jwtSecret
}

export async function cleanupFailedE2ESetup(actions: Array<() => Promise<unknown>>): Promise<void> {
  await cleanupE2E(
    actions.map((run, index) => ({ name: `setup-${index}`, run, milliseconds: 10_000 }))
  )
}
