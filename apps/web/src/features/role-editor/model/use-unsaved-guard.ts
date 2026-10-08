import { useEffect, useState } from 'react'

import 'client-only'

/**
 * While `dirty`, hard navigations get the browser's prompt and in-app link clicks are held until
 * the person confirms. The held destination is exposed so the caller can show its own dialog.
 */
export function useUnsavedGuard(dirty: boolean) {
  const [held, setHeld] = useState<string>()
  useEffect(() => {
    if (!dirty) return
    const beforeUnload = (event: BeforeUnloadEvent) => event.preventDefault()
    const click = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const anchor = (event.target as Element | null)?.closest?.(
        'a[href]'
      ) as HTMLAnchorElement | null
      if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return
      const url = new URL(anchor.href, window.location.href)
      if (url.origin !== window.location.origin) return
      if (url.pathname + url.search === window.location.pathname + window.location.search) return
      event.preventDefault()
      event.stopPropagation()
      setHeld(url.pathname + url.search + url.hash)
    }
    window.addEventListener('beforeunload', beforeUnload)
    document.addEventListener('click', click, true)
    return () => {
      window.removeEventListener('beforeunload', beforeUnload)
      document.removeEventListener('click', click, true)
    }
  }, [dirty])
  return { held, release: () => setHeld(undefined) }
}
