// AMCore observability contract — bounded readiness polling shared by the
// live check entrypoint. `run-live.sh` owns process lifecycle (compose
// up/down, the teardown trap); this module only waits for a URL to answer.
const DEFAULT_ATTEMPTS = Number(process.env.OBS_CONTRACT_POLL_ATTEMPTS ?? 60)
const POLL_INTERVAL_MS = 2000

/**
 * Polls `checkFn` (returns true when ready) up to `attempts` times, 2s apart.
 * `OBS_CONTRACT_POLL_ATTEMPTS=1` (set by the acceptance-proof runs) makes a
 * genuinely-broken condition fail fast instead of waiting the full timeout.
 */
export async function waitUntilReady(label, checkFn, attempts = DEFAULT_ATTEMPTS) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let ready = false
    try {
      ready = await checkFn()
    } catch {
      ready = false
    }
    if (ready) return
    if (attempt === attempts) {
      throw new Error(`${label}: not ready after ${attempts} attempt(s)`)
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }
}
