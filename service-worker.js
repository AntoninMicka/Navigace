const APP_CACHE_NAME = 'tacnav-app-shell-v1';
const TILE_CACHE_NAME = 'tacnav-map-tiles-v1';

// Soubory nutné k základnímu spuštění aplikace i bez internetu
const ASSETS_TO_CACHE = [
    '/',
    '/index.html',
    '/app.js',
    '/style.css',
    '/manifest.json',
    'https://unpkg.com/maplibre-gl@3.6.2/dist/maplibre-gl.js',
    'https://unpkg.com/maplibre-gl@3.6.2/dist/maplibre-gl.css'
];

// 1. Instalace Service Workeru a nacachování App Shellu
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(APP_CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS_TO_CACHE);
        })
    );
    self.skipWaiting();
});

// 2. Aktivace a vyčištění starých verzí cache
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((name) => {
                    if (name !== APP_CACHE_NAME && name !== TILE_CACHE_NAME) {
                        return caches.delete(name);
                    }
                })
            );
        })
    );
    self.clients.claim();
});

// 3. Zachytávání požadavků (Síťové proxy)
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // STRATEGIE A: Mapové dlaždice (CartoDB, OSM) -> Cache First
    if (url.hostname.includes('cartocdn.com') || url.hostname.includes('openstreetmap.org')) {
        event.respondWith(
            caches.match(event.request).then((cachedResponse) => {
                if (cachedResponse) return cachedResponse;
                
                return fetch(event.request).then((networkResponse) => {
                    return caches.open(TILE_CACHE_NAME).then((cache) => {
                        cache.put(event.request, networkResponse.clone());
                        return networkResponse;
                    });
                }).catch(() => new Response('', { status: 404, statusText: 'Offline' }));
            })
        );
    }
    // STRATEGIE B: Vlastní API (Routování, Radary) -> Network First
    else if (url.pathname.startsWith('/api/')) {
        event.respondWith(
            fetch(event.request).catch(() => caches.match(event.request))
        );
    }
    // STRATEGIE C: App Shell (CSS, JS, HTML) -> Stale-While-Revalidate
    else {
        event.respondWith(
            caches.match(event.request).then((cachedResponse) => {
                const fetchPromise = fetch(event.request).then((networkResponse) => {
                    caches.open(APP_CACHE_NAME).then((cache) => cache.put(event.request, networkResponse.clone()));
                    return networkResponse;
                }).catch(() => {}); // Ignorovat chyby sítě
                return cachedResponse || fetchPromise;
            })
        );
    }
});