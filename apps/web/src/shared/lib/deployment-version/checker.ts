import { deploymentVersionResponseSchema } from './identity'
import { allowReplacement, reconcileRecovery } from './reload-guard'

import 'client-only'

export function startVersionChecker(version: string): () => void {
  reconcileRecovery(version)
  let stopped = false
  let replacing = false
  let request: AbortController | undefined
  const check = async () => {
    if (stopped || replacing || request) return
    const controller = new AbortController()
    request = controller
    const timeout = setTimeout(() => controller.abort(), 5000)
    try {
      const response = await fetch('/api/deployment-version', {
        cache: 'no-store',
        signal: controller.signal,
        credentials: 'omit',
      })
      if (!response.ok) return
      const parsed = deploymentVersionResponseSchema.safeParse(await response.json())
      if (stopped || !parsed.success || parsed.data.version === version) return
      const current = parsed.data.version
      if (allowReplacement(current)) {
        replacing = true
        window.location.replace(window.location.href)
      }
    } catch {
      /* Offline/invalid signals wait for the next ordinary check. */
    } finally {
      clearTimeout(timeout)
      request = undefined
    }
  }
  const onVisible = () => {
    if (document.visibilityState === 'visible') void check()
  }
  const onFocus = () => {
    void check()
  }
  const timer = setInterval(() => {
    void check()
  }, 30_000)
  window.addEventListener('focus', onFocus)
  document.addEventListener('visibilitychange', onVisible)
  void check()
  return () => {
    stopped = true
    clearInterval(timer)
    request?.abort()
    window.removeEventListener('focus', onFocus)
    document.removeEventListener('visibilitychange', onVisible)
  }
}
