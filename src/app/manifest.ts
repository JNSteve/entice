import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Entice',
    short_name: 'Entice',
    description: 'Civil & remediation operations platform',
    start_url: '/field',
    display: 'standalone',
    background_color: '#162040',
    theme_color: '#162040',
    icons: [
      {
        src: '/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
      {
        src: '/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'maskable',
      },
    ],
  }
}
