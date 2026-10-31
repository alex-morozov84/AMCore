// Preloaded only by CI transfer/admission actions, which own no stand resources.
// GitHub's integer-minute step limit is the fallback, not this phase's clock.
const remaining = Number(process.env.AMCORE_ACTION_DEADLINE) - Date.now()
if (!Number.isSafeInteger(remaining) || remaining <= 0) process.exit(1)
const timer = setTimeout(() => {
  console.error('CI action phase deadline exhausted')
  process.exit(1)
}, remaining)
timer.unref()
