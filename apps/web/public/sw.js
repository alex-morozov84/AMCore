const CACHE_NAME = 'amcore-v2'

// Assets to cache on install
const STATIC_ASSETS = ['/icons/icon-192x192.png', '/icons/icon-512x512.png']

// Install event - cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS)
    })
  )
  self.skipWaiting()
})

// Activate event - clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))
      )
    })
  )
  self.clients.claim()
})

// Only public install icons have an offline fallback. Documents, RSC, API and
// Next build assets stay on the network so cached old code cannot revive a tab.
self.addEventListener('fetch', (event) => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') return

  const url = new URL(event.request.url)
  if (url.origin !== self.location.origin || !STATIC_ASSETS.includes(url.pathname)) return

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Clone response for caching
        if (response.ok) {
          const responseClone = response.clone()
          event.waitUntil(
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone))
          )
        }
        return response
      })
      .catch(() => {
        // Fallback to cache
        return caches.match(event.request)
      })
  )
})

// Push notification event
self.addEventListener('push', (event) => {
  if (event.data) {
    const data = event.data.json()
    const options = {
      body: data.body,
      icon: '/icons/icon-192x192.png',
      badge: '/icons/icon-192x192.png',
      vibrate: [100, 50, 100],
      data: {
        url: data.url || '/',
      },
    }
    event.waitUntil(self.registration.showNotification(data.title, options))
  }
})

// Notification click event
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(clients.openWindow(event.notification.data.url || '/'))
})
