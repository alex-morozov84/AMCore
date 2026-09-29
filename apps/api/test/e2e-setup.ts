import { randomBytes } from 'node:crypto'

// One secret per Jest suite also keeps secondary apps and repeated bootstraps
// consistent with the cached AppModule configuration.
const jwtSecret = randomBytes(32).toString('hex')

export function prepareE2EAuthEnvironment(): void {
  process.env.JWT_SECRET = jwtSecret
}

export async function cleanupFailedE2ESetup(actions: Array<() => Promise<unknown>>): Promise<void> {
  for (const action of actions) {
    try {
      await action()
    } catch (error) {
      // Attempt every owned resource while preserving the original setup error.
      console.warn('E2E setup cleanup failed:', error)
    }
  }
}
