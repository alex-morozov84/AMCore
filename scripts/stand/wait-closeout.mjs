import { setTimeout } from 'node:timers/promises'
import { closeoutStand } from './closeout.mjs'

// A dev server can leave a short-lived child after its command exits. Observe
// natural termination; never signal an unproved process or waive absence proof.
export async function waitForRunnerCloseout(manifest, timeout = 10_000) {
  const deadline = Date.now() + timeout
  for (;;) {
    try {
      await closeoutStand(manifest)
      return
    } catch (error) {
      if (!error.message.startsWith('Possible surviving owned child') || Date.now() >= deadline) {
        throw error
      }
      await setTimeout(Math.min(50, deadline - Date.now()))
    }
  }
}
