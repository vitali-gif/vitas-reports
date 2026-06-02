// VITAS Reports — minimal service worker (required for PWA installability)
const CACHE = 'vitas-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

// Passthrough fetch — no caching, just makes Chrome happy for PWA install
self.addEventListener('fetch', () => {});
