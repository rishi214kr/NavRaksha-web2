/**
 * NavRaksha Service Worker
 * Handles offline functionality, caching, and background sync
 */

const CACHE_NAME = 'navraksha-v1.0.0';
const STATIC_CACHE = 'navraksha-static-v1';
const DYNAMIC_CACHE = 'navraksha-dynamic-v1';
const MAP_CACHE = 'navraksha-maps-v1';

// Files to cache for offline functionality
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/styles.css',
    '/app.js',
    '/manifest.json',
    // External libraries (will be cached when first loaded)
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
    'https://cdn.jsdelivr.net/npm/chart.js',
    'https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js'
];

// Map tile URLs to cache (for offline maps)
const MAP_TILE_PATTERNS = [
    /^https:\/\/[abc]\.tile\.openstreetmap\.org\/\d+\/\d+\/\d+\.png$/
];

// API endpoints that should be cached
const API_CACHE_PATTERNS = [
    /^https:\/\/api\.openweathermap\.org/,
    /^https:\/\/api\.mapbox\.com/
];

// Install event - cache static assets
self.addEventListener('install', event => {
    console.log('Service Worker: Installing...');
    
    event.waitUntil(
        Promise.all([
            // Cache static assets
            caches.open(STATIC_CACHE).then(cache => {
                console.log('Service Worker: Caching static assets');
                return cache.addAll(STATIC_ASSETS.map(url => new Request(url, {
                    cache: 'reload'
                })));
            }),
            
            // Initialize other caches
            caches.open(DYNAMIC_CACHE),
            caches.open(MAP_CACHE)
        ]).then(() => {
            console.log('Service Worker: Installation complete');
            // Force activation of new service worker
            return self.skipWaiting();
        }).catch(error => {
            console.error('Service Worker: Installation failed', error);
        })
    );
});

// Activate event - clean up old caches
self.addEventListener('activate', event => {
    console.log('Service Worker: Activating...');
    
    event.waitUntil(
        Promise.all([
            // Clean up old caches
            caches.keys().then(cacheNames => {
                return Promise.all(
                    cacheNames.map(cacheName => {
                        if (cacheName !== STATIC_CACHE && 
                            cacheName !== DYNAMIC_CACHE && 
                            cacheName !== MAP_CACHE) {
                            console.log('Service Worker: Deleting old cache', cacheName);
                            return caches.delete(cacheName);
                        }
                    })
                );
            }),
            
            // Take control of all clients
            self.clients.claim()
        ]).then(() => {
            console.log('Service Worker: Activation complete');
        })
    );
});

// Fetch event - handle requests with caching strategies
self.addEventListener('fetch', event => {
    const { request } = event;
    const url = new URL(request.url);
    
    // Skip non-GET requests
    if (request.method !== 'GET') {
        return;
    }
    
    // Handle different types of requests with appropriate strategies
    if (isStaticAsset(request)) {
        // Static assets: Cache First
        event.respondWith(cacheFirst(request, STATIC_CACHE));
    } else if (isMapTile(request)) {
        // Map tiles: Cache First with long expiration
        event.respondWith(cacheFirstWithExpiration(request, MAP_CACHE, 7 * 24 * 60 * 60 * 1000)); // 7 days
    } else if (isAPIRequest(request)) {
        // API requests: Network First with cache fallback
        event.respondWith(networkFirstWithCache(request, DYNAMIC_CACHE));
    } else if (isNavigationRequest(request)) {
        // Navigation requests: Network First, fallback to cached index.html
        event.respondWith(navigationHandler(request));
    } else {
        // Other requests: Network First
        event.respondWith(networkFirst(request, DYNAMIC_CACHE));
    }
});

// Background Sync for offline actions
self.addEventListener('sync', event => {
    console.log('Service Worker: Background sync triggered', event.tag);
    
    if (event.tag === 'emergency-sync') {
        event.waitUntil(syncEmergencyEvents());
    } else if (event.tag === 'location-sync') {
        event.waitUntil(syncLocationUpdates());
    } else if (event.tag === 'hazard-sync') {
        event.waitUntil(syncHazardReports());
    }
});

// Push notifications for emergency alerts
self.addEventListener('push', event => {
    console.log('Service Worker: Push notification received');
    
    let data = {};
    if (event.data) {
        try {
            data = event.data.json();
        } catch (e) {
            data = { title: 'NavRaksha', body: event.data.text() };
        }
    }
    
    const options = {
        title: data.title || 'NavRaksha Alert',
        body: data.body || 'You have a new safety alert',
        icon: '/icon-192.png',
        badge: '/badge-72.png',
        tag: data.tag || 'navraksha-alert',
        requireInteraction: data.urgent || false,
        actions: [
            {
                action: 'view',
                title: 'View Details',
                icon: '/action-view.png'
            },
            {
                action: 'dismiss',
                title: 'Dismiss',
                icon: '/action-dismiss.png'
            }
        ],
        data: data
    };
    
    event.waitUntil(
        self.registration.showNotification(options.title, options)
    );
});

// Handle notification clicks
self.addEventListener('notificationclick', event => {
    console.log('Service Worker: Notification clicked', event.action);
    
    event.notification.close();
    
    if (event.action === 'view') {
        // Open the app to view details
        event.waitUntil(
            clients.openWindow('/?notification=' + event.notification.tag)
        );
    } else if (event.action === 'dismiss') {
        // Just close the notification
        return;
    } else {
        // Default action - open the app
        event.waitUntil(
            clients.openWindow('/')
        );
    }
});

// Message handling for communication with main app
self.addEventListener('message', event => {
    console.log('Service Worker: Message received', event.data);
    
    const { type, data } = event.data;
    
    switch (type) {
        case 'SKIP_WAITING':
            self.skipWaiting();
            break;
            
        case 'CACHE_LOCATION':
            event.waitUntil(cacheLocation(data));
            break;
            
        case 'QUEUE_EMERGENCY':
            event.waitUntil(queueEmergencyEvent(data));
            break;
            
        case 'GET_CACHE_STATUS':
            event.waitUntil(getCacheStatus().then(status => {
                event.ports[0].postMessage(status);
            }));
            break;
    }
});

// Utility Functions

function isStaticAsset(request) {
    return STATIC_ASSETS.some(asset => request.url.includes(asset)) ||
           request.url.includes('.css') ||
           request.url.includes('.js') ||
           request.url.includes('.png') ||
           request.url.includes('.jpg') ||
           request.url.includes('.svg') ||
           request.url.includes('.woff') ||
           request.url.includes('.woff2');
}

function isMapTile(request) {
    return MAP_TILE_PATTERNS.some(pattern => pattern.test(request.url));
}

function isAPIRequest(request) {
    return API_CACHE_PATTERNS.some(pattern => pattern.test(request.url)) ||
           request.url.includes('/api/');
}

function isNavigationRequest(request) {
    return request.mode === 'navigate' ||
           (request.method === 'GET' && request.headers.get('accept').includes('text/html'));
}

// Caching Strategies

async function cacheFirst(request, cacheName) {
    try {
        const cache = await caches.open(cacheName);
        const cachedResponse = await cache.match(request);
        
        if (cachedResponse) {
            return cachedResponse;
        }
        
        const networkResponse = await fetch(request);
        
        if (networkResponse.ok) {
            cache.put(request, networkResponse.clone());
        }
        
        return networkResponse;
    } catch (error) {
        console.error('Cache First strategy failed:', error);
        return new Response('Offline - Content not available', {
            status: 503,
            statusText: 'Service Unavailable'
        });
    }
}

async function cacheFirstWithExpiration(request, cacheName, maxAge) {
    try {
        const cache = await caches.open(cacheName);
        const cachedResponse = await cache.match(request);
        
        if (cachedResponse) {
            const cachedDate = new Date(cachedResponse.headers.get('date'));
            const now = new Date();
            
            if (now.getTime() - cachedDate.getTime() < maxAge) {
                return cachedResponse;
            }
        }
        
        const networkResponse = await fetch(request);
        
        if (networkResponse.ok) {
            cache.put(request, networkResponse.clone());
        }
        
        return networkResponse;
    } catch (error) {
        console.error('Cache First with expiration failed:', error);
        
        if (cachedResponse) {
            return cachedResponse; // Return stale cache as fallback
        }
        
        return new Response('Offline - Content not available', {
            status: 503,
            statusText: 'Service Unavailable'
        });
    }
}

async function networkFirst(request, cacheName) {
    try {
        const networkResponse = await fetch(request);
        
        if (networkResponse.ok) {
            const cache = await caches.open(cacheName);
            cache.put(request, networkResponse.clone());
        }
        
        return networkResponse;
    } catch (error) {
        console.log('Network failed, trying cache:', error);
        
        const cache = await caches.open(cacheName);
        const cachedResponse = await cache.match(request);
        
        if (cachedResponse) {
            return cachedResponse;
        }
        
        return new Response('Offline - Content not available', {
            status: 503,
            statusText: 'Service Unavailable'
        });
    }
}

async function networkFirstWithCache(request, cacheName) {
    try {
        const networkResponse = await fetch(request);
        
        if (networkResponse.ok) {
            const cache = await caches.open(cacheName);
            cache.put(request, networkResponse.clone());
            return networkResponse;
        }
        
        throw new Error('Network response not ok');
    } catch (error) {
        console.log('Network failed, trying cache:', error);
        
        const cache = await caches.open(cacheName);
        const cachedResponse = await cache.match(request);
        
        if (cachedResponse) {
            return cachedResponse;
        }
        
        return new Response(JSON.stringify({
            error: 'Offline - Data not available',
            offline: true
        }), {
            status: 503,
            statusText: 'Service Unavailable',
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

async function navigationHandler(request) {
    try {
        const networkResponse = await fetch(request);
        return networkResponse;
    } catch (error) {
        console.log('Navigation failed, serving cached index:', error);
        
        const cache = await caches.open(STATIC_CACHE);
        const cachedResponse = await cache.match('/index.html');
        
        if (cachedResponse) {
            return cachedResponse;
        }
        
        return new Response('Offline - App not available', {
            status: 503,
            statusText: 'Service Unavailable'
        });
    }
}

// Background Sync Functions

async function syncEmergencyEvents() {
    try {
        console.log('Service Worker: Syncing emergency events');
        
        // Get queued emergency events from IndexedDB
        const db = await openDB();
        const transaction = db.transaction(['queue'], 'readonly');
        const store = transaction.objectStore('queue');
        const events = await getAllFromStore(store);
        
        const emergencyEvents = events.filter(event => event.type === 'emergency');
        
        for (const event of emergencyEvents) {
            try {
                // Attempt to send to server
                const response = await fetch('/api/emergency/sync', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(event.data)
                });
                
                if (response.ok) {
                    // Remove from queue on success
                    await removeFromQueue(event.id);
                    console.log('Emergency event synced:', event.id);
                }
            } catch (error) {
                console.error('Failed to sync emergency event:', error);
            }
        }
    } catch (error) {
        console.error('Emergency sync failed:', error);
    }
}

async function syncLocationUpdates() {
    try {
        console.log('Service Worker: Syncing location updates');
        
        const db = await openDB();
        const transaction = db.transaction(['queue'], 'readonly');
        const store = transaction.objectStore('queue');
        const events = await getAllFromStore(store);
        
        const locationEvents = events.filter(event => event.type === 'location');
        
        for (const event of locationEvents) {
            try {
                const response = await fetch('/api/location/sync', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(event.data)
                });
                
                if (response.ok) {
                    await removeFromQueue(event.id);
                    console.log('Location update synced:', event.id);
                }
            } catch (error) {
                console.error('Failed to sync location update:', error);
            }
        }
    } catch (error) {
        console.error('Location sync failed:', error);
    }
}

async function syncHazardReports() {
    try {
        console.log('Service Worker: Syncing hazard reports');
        
        const db = await openDB();
        const transaction = db.transaction(['queue'], 'readonly');
        const store = transaction.objectStore('queue');
        const events = await getAllFromStore(store);
        
        const hazardEvents = events.filter(event => event.type === 'hazard');
        
        for (const event of hazardEvents) {
            try {
                const response = await fetch('/api/hazards/sync', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(event.data)
                });
                
                if (response.ok) {
                    await removeFromQueue(event.id);
                    console.log('Hazard report synced:', event.id);
                }
            } catch (error) {
                console.error('Failed to sync hazard report:', error);
            }
        }
    } catch (error) {
        console.error('Hazard sync failed:', error);
    }
}

// IndexedDB Helper Functions

function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('NavRakshaDB', 1);
        
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
        
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            
            if (!db.objectStoreNames.contains('queue')) {
                db.createObjectStore('queue', { keyPath: 'id', autoIncrement: true });
            }
        };
    });
}

function getAllFromStore(store) {
    return new Promise((resolve, reject) => {
        const request = store.getAll();
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
    });
}

async function removeFromQueue(id) {
    const db = await openDB();
    const transaction = db.transaction(['queue'], 'readwrite');
    const store = transaction.objectStore('queue');
    return store.delete(id);
}

async function queueEmergencyEvent(data) {
    try {
        const db = await openDB();
        const transaction = db.transaction(['queue'], 'readwrite');
        const store = transaction.objectStore('queue');
        
        await store.add({
            type: 'emergency',
            data: data,
            timestamp: Date.now()
        });
        
        // Register for background sync
        if ('serviceWorker' in navigator && 'sync' in window.ServiceWorkerRegistration.prototype) {
            const registration = await navigator.serviceWorker.ready;
            await registration.sync.register('emergency-sync');
        }
    } catch (error) {
        console.error('Failed to queue emergency event:', error);
    }
}

async function cacheLocation(locationData) {
    try {
        const cache = await caches.open(DYNAMIC_CACHE);
        const response = new Response(JSON.stringify(locationData), {
            headers: { 'Content-Type': 'application/json' }
        });
        
        await cache.put('/api/location/current', response);
    } catch (error) {
        console.error('Failed to cache location:', error);
    }
}

async function getCacheStatus() {
    try {
        const cacheNames = await caches.keys();
        const status = {};
        
        for (const cacheName of cacheNames) {
            const cache = await caches.open(cacheName);
            const keys = await cache.keys();
            status[cacheName] = keys.length;
        }
        
        return status;
    } catch (error) {
        console.error('Failed to get cache status:', error);
        return {};
    }
}

// Periodic cleanup of old cache entries
setInterval(async () => {
    try {
        const cache = await caches.open(DYNAMIC_CACHE);
        const keys = await cache.keys();
        const now = Date.now();
        const maxAge = 24 * 60 * 60 * 1000; // 24 hours
        
        for (const request of keys) {
            const response = await cache.match(request);
            const cachedDate = new Date(response.headers.get('date'));
            
            if (now - cachedDate.getTime() > maxAge) {
                await cache.delete(request);
                console.log('Cleaned up old cache entry:', request.url);
            }
        }
    } catch (error) {
        console.error('Cache cleanup failed:', error);
    }
}, 60 * 60 * 1000); // Run every hour

console.log('Service Worker: Script loaded');