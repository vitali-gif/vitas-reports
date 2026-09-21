export default function manifest() {
  return {
    name: 'Tovno by Vitas',
    short_name: 'Tovno',
    description: 'דוח ביצועים שיווקי',
    start_url: '/client',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#14243C',
    orientation: 'portrait',
    lang: 'he',
    dir: 'rtl',
    icons: [
      {
        src: '/brand/tovno/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any maskable',
      },
      {
        src: '/brand/tovno/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any maskable',
      },
    ],
  }
}
