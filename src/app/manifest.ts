import type { MetadataRoute } from 'next'

/**
 * PWA manifest — this is what makes "Add to Home Screen" produce something that
 * behaves like an app rather than a bookmark.
 *
 * Icons must be PNG. iOS ignores SVG entirely for the home screen, and Android
 * needs a dedicated `maskable` variant or it letterboxes the icon inside its
 * circle/squircle mask. The maskable files keep the glyph inside the 80% safe
 * zone so no crop clips it. The iOS home-screen icon is separate again — it
 * comes from src/app/apple-icon.png via Next's file convention.
 *
 * start_url stays /field: the crew are the ones who install this. Office staff
 * open it in a browser.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Entice',
    short_name: 'Entice',
    description: 'Civil & remediation operations platform',
    start_url: '/field',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#162040',
    theme_color: '#162040',
    categories: ['business', 'productivity'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/icons/maskable-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icons/maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
      // Kept last as a scalable fallback for anything that prefers vector.
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    ],
  }
}
