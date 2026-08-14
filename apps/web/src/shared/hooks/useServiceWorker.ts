'use client'

import { useEffect, useState } from 'react'

export function useServiceWorker() {
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null)
  const [isSupported, setIsSupported] = useState(false)

  useEffect(() => {
    // Check if service workers are supported
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      return
    }

    setIsSupported(true)

    // Register service worker
    const registerSW = async () => {
      try {
        // Cast, not trust: `lib.dom`'s type promises a real
        // `ServiceWorkerRegistration`, but Playwright's `serviceWorkers:
        // 'block'` (this repo's own mocked E2E lane, `playwright.config.ts`)
        // resolves `register()` with `undefined` instead of rejecting —
        // real observed behavior outside the documented contract, not a
        // hypothetical to skip guarding.
        const reg = (await navigator.serviceWorker.register('/sw.js', {
          scope: '/',
          updateViaCache: 'none',
        })) as ServiceWorkerRegistration | undefined

        if (!reg) {
          return
        }

        setRegistration(reg)

        // Check for updates
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                // New content available
                console.log('New content available, refresh to update.')
              }
            })
          }
        })
      } catch (error) {
        console.error('Service worker registration failed:', error)
      }
    }

    registerSW()
  }, [])

  return { registration, isSupported }
}
