/** Labels identify this supervised attempt, never a shared Testcontainers/Ryuk session. */
export function e2eContainerLabels(): Record<string, string> {
  const attempt = process.env.AMCORE_E2E_ATTEMPT
  const run = process.env.AMCORE_E2E_RUN
  return attempt && run ? { 'amcore.e2e.run': run, 'amcore.e2e.attempt': attempt } : {}
}
