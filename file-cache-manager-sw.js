"use strict";
let CACHE_CONFIG = {
    cacheName: 'file-cache-v1',
    cacheMaxAge: 2592000000, // 30 days
    cleanupInterval: 3600000 // Default cleanup interval: 1 hour
};
// Metadata store (IndexedDB) for last-accessed timestamps
const DB_NAME = 'aiMusicStorage-file-cache-meta';
const META_DB_VERSION = 1;
const META_STORE = 'entries';
function isCacheableUrl(url) {
    return (url.startsWith('https://cdn.aimusic.com.tr/') ||
        url.startsWith('https://api.aimusic.com.tr/storage/v1/object/public/'));
}
async function openMetaDb() {
    try {
        const req = indexedDB.open(DB_NAME, META_DB_VERSION);
        return await new Promise((resolve, reject) => {
            req.onerror = () => reject(req.error);
            req.onsuccess = () => resolve(req.result);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(META_STORE)) {
                    const store = db.createObjectStore(META_STORE, { keyPath: 'url' });
                    store.createIndex('lastAccessedAt', 'lastAccessedAt', {
                        unique: false
                    });
                    store.createIndex('cachedAt', 'cachedAt', { unique: false });
                }
            };
        });
    }
    catch (_err) {
        return undefined;
    }
}
async function readMeta(url) {
    const db = await openMetaDb();
    if (!db)
        return undefined;
    return await new Promise((resolve) => {
        const tx = db.transaction(META_STORE, 'readonly');
        const store = tx.objectStore(META_STORE);
        const req = store.get(url);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(undefined);
    });
}
async function writeMeta(entry) {
    const db = await openMetaDb();
    if (!db)
        return;
    await new Promise((resolve) => {
        const tx = db.transaction(META_STORE, 'readwrite');
        const store = tx.objectStore(META_STORE);
        store.put(entry);
        tx.oncomplete = () => resolve();
        tx.onabort = () => resolve();
    });
}
async function touchLastAccessed(url) {
    var _a;
    try {
        const existing = (_a = (await readMeta(url))) !== null && _a !== void 0 ? _a : {
            url,
            cachedAt: Date.now(),
            lastAccessedAt: Date.now()
        };
        existing.lastAccessedAt = Date.now();
        await writeMeta(existing);
    }
    catch (_err) {
        // ignore metadata failures
    }
}
async function recordCached(url) {
    var _a;
    try {
        const now = Date.now();
        const existing = (_a = (await readMeta(url))) !== null && _a !== void 0 ? _a : {
            url,
            cachedAt: now,
            lastAccessedAt: now
        };
        existing.cachedAt = existing.cachedAt || now;
        existing.lastAccessedAt = now;
        await writeMeta(existing);
    }
    catch (_err) {
        // ignore metadata failures
    }
}
async function deleteMeta(url) {
    const db = await openMetaDb();
    if (!db)
        return;
    await new Promise((resolve) => {
        const tx = db.transaction(META_STORE, 'readwrite');
        const store = tx.objectStore(META_STORE);
        store.delete(url);
        tx.oncomplete = () => resolve();
        tx.onabort = () => resolve();
    });
}
const prefetchQueue = [];
const inProgressFetches = new Map();
let isPrefetchProcessing = false;
let lastCleanupTime = 0;
let isCleanupScheduled = false;
// @ts-ignore
self.addEventListener('fetch', (event) => {
    if (isCacheableUrl(event.request.url)) {
        event.respondWith((async () => {
            const queueIndex = prefetchQueue.indexOf(event.request.url);
            if (queueIndex !== -1)
                prefetchQueue.splice(queueIndex, 1);
            event.waitUntil(touchLastAccessed(event.request.url));
            const response = await handleRequest(event.request);
            return response !== null && response !== void 0 ? response : fetch(event.request);
        })());
    }
});
self.addEventListener('install', (event) => {
    console.log('Service worker installing...');
    // @ts-ignore
    self.skipWaiting();
});
self.addEventListener('activate', (event) => {
    console.log('Service worker activating...');
    // @ts-ignore
    event.waitUntil(self.clients.claim());
});
// @ts-ignore
self.addEventListener('message', (event) => {
    switch (event.data.type) {
        case 'CACHE_CONFIG':
            CACHE_CONFIG = { ...CACHE_CONFIG, ...event.data.config };
            break;
        case 'CLEANUP_CACHE':
            event.waitUntil(cleanupCache());
            lastCleanupTime = Date.now();
            break;
        case 'PREFETCH_FILES':
            event.waitUntil(prefetchUrls(event.data.urls));
            break;
    }
});
async function handleRequest(request, retryCount = 0) {
    var _a;
    const url = request.url;
    const isRange = Boolean(request.headers.get('range'));
    if (!isRange && inProgressFetches.has(url)) {
        const pending = inProgressFetches.get(url);
        return pending
            ? pending.then((res) => (res ? res.clone() : undefined))
            : undefined;
    }
    const cache = await caches.open(CACHE_CONFIG.cacheName);
    const cachedResponse = await cache.match(url);
    if (cachedResponse) {
        if (isRange) {
            const rangeHeader = request.headers.get('range');
            const rangeMatch = rangeHeader.match(/bytes=(\d+)-(\d+)?/);
            if (!rangeMatch) {
                return cachedResponse;
            }
            const start = parseInt(rangeMatch[1], 10);
            const end = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : undefined;
            const cachedBlob = await cachedResponse.blob();
            const cachedSize = cachedBlob.size;
            const effectiveEnd = end || cachedSize - 1;
            const slicedBlob = cachedBlob.slice(start, effectiveEnd + 1);
            const contentType = cachedResponse.headers.get('Content-Type') || undefined;
            return new Response(slicedBlob, {
                status: 206,
                statusText: 'Partial Content',
                headers: new Headers({
                    'Content-Range': `bytes ${start}-${effectiveEnd}/${cachedSize}`,
                    'Content-Length': String(slicedBlob.size),
                    'Accept-Ranges': 'bytes',
                    ...(contentType ? { 'Content-Type': contentType } : {})
                })
            });
        }
        // Do not rewrite the cache entry; just return cached response
        return cachedResponse;
    }
    // Not in cache
    if (isRange) {
        const rangeHeader = request.headers.get('range');
        const fullRequest = new Request(url);
        const rangeRequest = new Request(url, {
            headers: new Headers({
                Range: rangeHeader
            })
        });
        try {
            const rangeResponse = await fetch(rangeRequest);
            if (rangeResponse.status === 206) {
                // Opportunistically cache the full file in background
                cacheFullFileInBackground(fullRequest);
                return rangeResponse;
            }
        }
        catch (error) {
            console.error(`Failed to handle range request for: ${url}`, error);
            // fall through to full request
        }
        // Fallback: fetch full file, cache it, then serve the requested range
        try {
            const response = await fetch(fullRequest);
            if (response.ok) {
                const responseClone = response.clone();
                // Cache the full response
                await cache.put(fullRequest, responseClone);
                await recordCached(url);
                const blob = await response.blob();
                const size = blob.size;
                const rangeMatch = rangeHeader.match(/bytes=(\d+)-(\d+)?/);
                if (!rangeMatch)
                    return response;
                const start = parseInt(rangeMatch[1], 10);
                const end = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : undefined;
                const effectiveEnd = end || size - 1;
                const slicedBlob = blob.slice(start, effectiveEnd + 1);
                const contentType = (_a = response.headers.get('Content-Type')) !== null && _a !== void 0 ? _a : 'audio/mpeg';
                return new Response(slicedBlob, {
                    status: 206,
                    statusText: 'Partial Content',
                    headers: new Headers({
                        'Content-Range': `bytes ${start}-${effectiveEnd}/${size}`,
                        'Content-Length': String(slicedBlob.size),
                        'Accept-Ranges': 'bytes',
                        'Content-Type': contentType
                    })
                });
            }
            inProgressFetches.delete(url);
            return response;
        }
        catch (error) {
            if (retryCount < 3) {
                console.error(`Failed to fetch: ${url}. Retrying...`, error);
                return handleRequest(fullRequest, retryCount + 1);
            }
            console.error(`Failed to fetch: ${url}. Giving up.`, error);
            return undefined;
        }
    }
    // Normal (non-range) fetch path
    const fullRequest = new Request(url);
    const fetchPromise = (async () => {
        try {
            const response = await fetch(fullRequest);
            if (response.ok) {
                const cache = await caches.open(CACHE_CONFIG.cacheName);
                // Cache the response without modifying headers
                await cache.put(fullRequest, response.clone());
                await recordCached(url);
                return response;
            }
            return response;
        }
        catch (error) {
            if (retryCount < 3) {
                console.error(`Failed to fetch: ${url}. Retrying...`, error);
                return handleRequest(fullRequest, retryCount + 1);
            }
            console.error(`Failed to fetch: ${url}. Giving up.`, error);
            return undefined;
        }
        finally {
            inProgressFetches.delete(url);
        }
    })();
    inProgressFetches.set(url, fetchPromise);
    return fetchPromise !== null && fetchPromise !== void 0 ? fetchPromise : false;
}
async function prefetchUrls(urls) {
    for (const url of urls) {
        if (!isCacheableUrl(url))
            continue;
        if (!prefetchQueue.includes(url))
            prefetchQueue.push(url);
    }
    if (isPrefetchProcessing || prefetchQueue.length === 0)
        return;
    isPrefetchProcessing = true;
    for (;;) {
        const nextUrl = prefetchQueue.shift();
        if (!nextUrl)
            break;
        const cache = await caches.open(CACHE_CONFIG.cacheName);
        const exists = await cache.match(nextUrl);
        if (!exists) {
            await handleRequest(new Request(nextUrl));
        }
        await touchLastAccessed(nextUrl);
    }
    isPrefetchProcessing = false;
    checkAndScheduleCleanup();
}
function checkAndScheduleCleanup() {
    const now = Date.now();
    if (now - lastCleanupTime > CACHE_CONFIG.cleanupInterval &&
        !isCleanupScheduled) {
        isCleanupScheduled = true;
        setTimeout(() => {
            cleanupCache()
                .then(() => {
                lastCleanupTime = Date.now();
                isCleanupScheduled = false;
            })
                .catch((error) => {
                console.error('Error during scheduled cache cleanup:', error);
                isCleanupScheduled = false;
            });
        }, 10000); // Delay to ensure prefetch is completely done
    }
}
async function cleanupCache() {
    const cache = await caches.open(CACHE_CONFIG.cacheName);
    const keys = await cache.keys();
    const now = Date.now();
    for (const request of keys) {
        const meta = await readMeta(request.url);
        const last = meta === null || meta === void 0 ? void 0 : meta.lastAccessedAt;
        if (!last || now - last > CACHE_CONFIG.cacheMaxAge) {
            await cache.delete(request);
            await deleteMeta(request.url);
        }
    }
}
// Function to cache the full file in the background without blocking the response
async function cacheFullFileInBackground(request) {
    try {
        const cache = await caches.open(CACHE_CONFIG.cacheName);
        const response = await fetch(request);
        if (response.ok) {
            await cache.put(request, response.clone());
            await recordCached(request.url);
        }
    }
    catch (error) {
        console.error(`Failed to cache file: ${request.url}`, error);
    }
}