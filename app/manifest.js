export default function manifest() {
  return {
    name: 'Cluzo by Vitas',
    short_name: 'Cluzo',
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
        src: '/brand/cluzo/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any maskable',
      },
      {
        src: '/brand/cluzo/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any maskable',
      },
    ],
  }
}
