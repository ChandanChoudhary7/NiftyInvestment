// Enhanced Service Worker for Nifty EMA Tracker PWA
const CACHE_NAME = 'nifty-ema-tracker-v2.0';
const STATIC_CACHE_NAME = 'nifty-static-v2.0';
const API_CACHE_NAME = 'nifty-api-v2.0';

// Static assets to cache
const STATIC_ASSETS = [
    './',
    './index.html',
    './style.css',
    './app.js',
    './manifest.json'
];

// API endpoints to cache
const API_ENDPOINTS = [
    'https://query1.finance.yahoo.com/v8/finance/chart/^NSEI'
];

// Cache duration in milliseconds
const CACHE_DURATION = {
    STATIC: 24 * 60 * 60 * 1000, // 24 hours
    API: 5 * 60 * 1000, // 5 minutes
    HISTORICAL: 60 * 60 * 1000 // 1 hour
};

// Install event - cache static assets
self.addEventListener('install', event => {
    console.log('Service Worker installing...');
    
    event.waitUntil(
        Promise.all([
            caches.open(STATIC_CACHE_NAME)
                .then(cache => {
                    console.log('Caching static assets');
                    return cache.addAll(STATIC_ASSETS);
                }),
            caches.open(API_CACHE_NAME)
                .then(cache => {
                    console.log('API cache initialized');
                })
        ]).then(() => {
            console.log('Service Worker installation complete');
            return self.skipWaiting();
        })
    );
});

// Activate event - clean up old caches
self.addEventListener('activate', event => {
    console.log('Service Worker activating...');
    
    event.waitUntil(
        caches.keys()
            .then(cacheNames => {
                return Promise.all(
                    cacheNames.map(cacheName => {
                        if (![
                            CACHE_NAME,
                            STATIC_CACHE_NAME,
                            API_CACHE_NAME
                        ].includes(cacheName)) {
                            console.log('Deleting old cache:', cacheName);
                            return caches.delete(cacheName);
                        }
                    })
                );
            })
            .then(() => {
                console.log('Service Worker activation complete');
                return self.clients.claim();
            })
    );
});

// Fetch event - handle network requests with caching strategy
self.addEventListener('fetch', event => {
    const request = event.request;
    const url = new URL(request.url);
    
    // Skip non-GET requests
    if (request.method !== 'GET') {
        return;
    }
    
    // Handle different types of requests
    if (isStaticAsset(url)) {
        event.respondWith(handleStaticAsset(request));
    } else if (isAPIRequest(url)) {
        event.respondWith(handleAPIRequest(request));
    } else {
        event.respondWith(handleOtherRequests(request));
    }
});

// Check if request is for static assets
function isStaticAsset(url) {
    const path = url.pathname;
    return path === '/' || 
           path.endsWith('.html') ||
           path.endsWith('.css') ||
           path.endsWith('.js') ||
           path.endsWith('.json') ||
           path.endsWith('.png') ||
           path.endsWith('.jpg') ||
           path.endsWith('.svg') ||
           path.endsWith('.ico');
}

// Check if request is for API data
function isAPIRequest(url) {
    return url.hostname === 'query1.finance.yahoo.com' ||
           url.hostname === 'finance.yahoo.com' ||
           API_ENDPOINTS.some(endpoint => url.href.startsWith(endpoint));
}

// Handle static asset requests with cache-first strategy
async function handleStaticAsset(request) {
    try {
        const cache = await caches.open(STATIC_CACHE_NAME);
        const cachedResponse = await cache.match(request);
        
        if (cachedResponse) {
            // Check if cache is still fresh
            const cacheDate = new Date(cachedResponse.headers.get('sw-cache-date') || 0);
            const isExpired = Date.now() - cacheDate.getTime() > CACHE_DURATION.STATIC;
            
            if (!isExpired) {
                return cachedResponse;
            }
        }
        
        // Try to fetch from network
        const networkResponse = await fetch(request);
        
        if (networkResponse.ok) {
            // Clone response and add cache date
            const responseToCache = networkResponse.clone();
            const headers = new Headers(responseToCache.headers);
            headers.set('sw-cache-date', new Date().toISOString());
            
            const modifiedResponse = new Response(responseToCache.body, {
                status: responseToCache.status,
                statusText: responseToCache.statusText,
                headers: headers
            });
            
            // Cache the response
            cache.put(request, modifiedResponse.clone());
            return networkResponse;
        }
        
        // Return cached version if network fails
        if (cachedResponse) {
            return cachedResponse;
        }
        
        throw new Error('No cached version available');
        
    } catch (error) {
        console.error('Error handling static asset:', error);
        
        // Return offline page for HTML requests
        if (request.destination === 'document') {
            return getOfflinePage();
        }
        
        return new Response('Asset not available offline', {
            status: 503,
            statusText: 'Service Unavailable'
        });
    }
}

// Handle API requests with network-first strategy and intelligent caching
async function handleAPIRequest(request) {
    try {
        const cache = await caches.open(API_CACHE_NAME);
        
        // Try network first for fresh data
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
            
            const networkResponse = await fetch(request, {
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            if (networkResponse.ok) {
                // Cache successful response
                const responseToCache = networkResponse.clone();
                const headers = new Headers(responseToCache.headers);
                headers.set('sw-cache-date', new Date().toISOString());
                
                const modifiedResponse = new Response(responseToCache.body, {
                    status: responseToCache.status,
                    statusText: responseToCache.statusText,
                    headers: headers
                });
                
                cache.put(request, modifiedResponse);
                return networkResponse;
            }
        } catch (networkError) {
            console.log('Network request failed, trying cache:', networkError.message);
        }
        
        // Try cache if network fails
        const cachedResponse = await cache.match(request);
        
        if (cachedResponse) {
            const cacheDate = new Date(cachedResponse.headers.get('sw-cache-date') || 0);
            const cacheAge = Date.now() - cacheDate.getTime();
            
            // Return cached data even if expired (better than no data)
            // Add header to indicate stale data
            const headers = new Headers(cachedResponse.headers);
            if (cacheAge > CACHE_DURATION.API) {
                headers.set('sw-cache-stale', 'true');
            }
            
            return new Response(cachedResponse.body, {
                status: cachedResponse.status,
                statusText: cachedResponse.statusText,
                headers: headers
            });
        }
        
        // Return fallback data if no cache available
        return getFallbackAPIResponse(request);
        
    } catch (error) {
        console.error('Error handling API request:', error);
        return getFallbackAPIResponse(request);
    }
}

// Handle other requests with cache-first strategy
async function handleOtherRequests(request) {
    try {
        const cache = await caches.open(CACHE_NAME);
        const cachedResponse = await cache.match(request);
        
        if (cachedResponse) {
            // Update cache in background if needed
            fetch(request)
                .then(response => {
                    if (response.ok) {
                        cache.put(request, response.clone());
                    }
                })
                .catch(() => {});
            
            return cachedResponse;
        }
        
        // Try network
        const networkResponse = await fetch(request);
        
        if (networkResponse.ok) {
            cache.put(request, networkResponse.clone());
        }
        
        return networkResponse;
        
    } catch (error) {
        console.error('Error handling request:', error);
        return new Response('Request failed', {
            status: 503,
            statusText: 'Service Unavailable'
        });
    }
}

// Generate fallback API response with sample data
function getFallbackAPIResponse(request) {
    const fallbackData = {
        chart: {
            result: [{
                meta: {
                    regularMarketPrice: 24741.00,
                    previousClose: 24734.30,
                    regularMarketOpen: 24818.85,
                    fiftyTwoWeekHigh: 26277.35,
                    fiftyTwoWeekLow: 21743.65
                },
                timestamp: [Math.floor(Date.now() / 1000)],
                indicators: {
                    quote: [{
                        close: [24741.00],
                        high: [24850.00],
                        low: [24680.00],
                        open: [24818.85],
                        volume: [1500000]
                    }]
                }
            }]
        }
    };
    
    return new Response(JSON.stringify(fallbackData), {
        status: 200,
        statusText: 'OK',
        headers: {
            'Content-Type': 'application/json',
            'sw-fallback': 'true',
            'sw-cache-date': new Date().toISOString()
        }
    });
}

// Generate offline page
function getOfflinePage() {
    const offlineHTML = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Offline - Nifty Tracker</title>
            <style>
                body {
                    font-family: system-ui, sans-serif;
                    background: #1F2121;
                    color: white;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    min-height: 100vh;
                    margin: 0;
                    text-align: center;
                }
                .offline-container {
                    max-width: 400px;
                    padding: 2rem;
                }
                .icon {
                    font-size: 4rem;
                    margin-bottom: 1rem;
                }
                h1 {
                    margin-bottom: 1rem;
                    color: #F59E0B;
                }
                p {
                    margin-bottom: 2rem;
                    line-height: 1.6;
                    opacity: 0.8;
                }
                .retry-btn {
                    background: #22C55E;
                    color: white;
                    border: none;
                    padding: 0.75rem 1.5rem;
                    border-radius: 0.5rem;
                    cursor: pointer;
                    font-size: 1rem;
                }
                .retry-btn:hover {
                    background: #16A34A;
                }
            </style>
        </head>
        <body>
            <div class="offline-container">
                <div class="icon">📡</div>
                <h1>You're Offline</h1>
                <p>No internet connection detected. The app will automatically sync when you're back online.</p>
                <button class="retry-btn" onclick="window.location.reload()">Try Again</button>
            </div>
        </body>
        </html>
    `;
    
    return new Response(offlineHTML, {
        status: 200,
        statusText: 'OK',
        headers: {
            'Content-Type': 'text/html',
            'sw-offline': 'true'
        }
    });
}
