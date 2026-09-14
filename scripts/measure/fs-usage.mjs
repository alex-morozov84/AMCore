// Disk-usage measurement for scaffolding baseline scenarios (BACKLOG item
// 14, PR1 §B). Uses the real `du` tool rather than a hand-rolled recursive
// `fs` walk: `du` is present on every runner this repo targets (Linux CI,
// macOS dev) and gives OS-reported usage without re-implementing a slow
// walker just for this measurement tool.
import { spawnSync } from 'node:child_process'

/** Real, OS-reported recursive disk usage of `dirPath` in bytes, or `null` if `du` failed/is unavailable. */
export function directoryUsageBytes(dirPath) {
  const result = spawnSync('du', ['-sk', dirPath], { encoding: 'utf8' })
  if (result.status !== 0 || !result.stdout) return null
  const kb = Number.parseInt(result.stdout.trim().split(/\s+/)[0], 10)
  return Number.isFinite(kb) ? kb * 1024 : null
}

/**
 * Samples {@link directoryUsageBytes} every `intervalMs` while `task()` runs,
 * tracking the maximum observed value as an approximation of peak disk
 * usage. This is a periodic-sample approximation, not a true peak: a spike
 * that both grows and shrinks faster than `intervalMs` is under-reported.
 * Every report field this feeds is labeled "sampled peak", never "exact
 * peak" — see report-schema.mjs.
 */
export async function withPeakDiskSampling(dirPath, intervalMs, task) {
  let peak = directoryUsageBytes(dirPath) ?? 0
  const timer = setInterval(() => {
    const sample = directoryUsageBytes(dirPath)
    if (sample !== null && sample > peak) peak = sample
  }, intervalMs)
  try {
    const result = await task()
    const finalUsage = directoryUsageBytes(dirPath) ?? peak
    if (finalUsage > peak) peak = finalUsage
    return { result, peakDiskUsageBytes: peak, finalDiskUsageBytes: finalUsage }
  } finally {
    clearInterval(timer)
  }
}
