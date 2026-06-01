export default function manifest() {
  return {
    name: 'VITAS Reports',
    short_name: 'VITAS',
    description: 'דוח ביצועים שיווקי',
    start_url: '/client',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#0B0F1E',
    orientation: 'portrait',
    lang: 'he',
    dir: 'rtl',
    icons: [
      {
        src: '/brand/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any maskable',
      },
      {
        src: '/brand/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any maskable',
      },
    ],
  }
}
