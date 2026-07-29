import type { MetadataRoute } from 'next'

// background_color/theme_color must be literal values — the Web App Manifest
// spec (splash screen, OS chrome tinting) is read before any CSS loads, so it
// can't reference the app's CSS custom properties. Keep these in sync with
// globals.css's light-mode `--background`/`--primary` by hand if that
// palette changes — there's no way to derive one from the other.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'AMCore',
    short_name: 'AMCore',
    description: 'Production-oriented application starter for secure, modular products.',
    start_url: '/',
    display: 'standalone',
    background_color: '#fafafa',
    theme_color: '#171717',
    orientation: 'portrait-primary',
    icons: [
      {
        src: '/icons/icon-192x192.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: '/icons/icon-512x512.png',
        sizes: '512x512',
        type: 'image/png',
      },
      {
        src: '/icons/icon-512x512-maskable.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  }
}
