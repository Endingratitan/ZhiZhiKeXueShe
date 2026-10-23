/* ============================================================
   致知科学社 · 缓存 Service Worker（/deps-sw.js，站点根）
   两类缓存：
   1) vendor（`/assets/vendor/` 或 deps.json 配置的跨域 base）：
      cache-first 9 个月，响应带 `x-zzkxs-stored-at`，过期则回源并打新戳；
   2) 站点资源（同源 GET：HTML/JS/CSS/JSON/MD 等）：**SWR**
      先返回缓存（x-zzkxs-sw: swr-hit），同时后台回源更新；
      图片/字体等二进制：cache-first，不后台刷新；
   例外（不缓存，保证能及时更新）：/deps-sw.js、/assets/deps/loader.js、/assets/deps/deps.json。
   由 assets/deps/loader.js 注册：/deps-sw.js?v=<versions>@<source>
   ============================================================ */
'use strict';

var PREFIX = 'zzkxs-vendor-';
var SITE_CACHE = 'zzkxs-site-v1';          // 站点资源缓存：跨 SW 版本保留
var MANIFEST_PATH = '/assets/deps/deps.json';
var DEFAULT_TTL_MS = 9 * 30 * 24 * 60 * 60 * 1000;   // ≈23328000 s
var SITE_REVALIDATE_MS = 60 * 1000;                    // SWR 最短重验间隔（减少重复导航的后台请求）
var configPromise = null;

var BINARY_RE = /\.(?:png|jpe?g|gif|webp|svg|ico|bmp|woff2?|ttf|otf|eot|mp4|webm|mp3|pdf|zip)$/i;

function isExcluded(pathname) {
    return pathname === '/deps-sw.js' ||
        pathname === '/assets/deps/loader.js' ||
        pathname === '/assets/deps/deps.json';
}

function fetchJson(url) {
    return fetch(new Request(url, { cache: 'no-cache', credentials: 'same-origin' }))
        .then(function (r) { return (r && r.ok) ? r.json() : null; })
        .catch(function () { return null; });
}

function buildConfig(m) {
    m = (m && typeof m === 'object') ? m : {};
    var deps = (m.deps && typeof m.deps === 'object') ? m.deps : {};
    var srcName = m.source || 'local';
    var sources = m.sources || {};
    var src = sources[srcName] || sources.local || { base: '/assets/vendor/' };
    var manifestUrl = self.location.origin + MANIFEST_PATH;
    var base;
    try { base = new URL(src.base || '/assets/vendor/', manifestUrl).href; }
    catch (e) { base = self.location.origin + '/assets/vendor/'; }
    if (base.charAt(base.length - 1) !== '/') { base += '/'; }

    var swCfg = m.serviceWorker || {};
    var ttlSec = parseInt(swCfg.cacheSeconds || m.browserCacheSeconds || 23328000, 10);
    if (!(ttlSec > 0)) { ttlSec = 23328000; }

    var tokens = (swCfg.precache && swCfg.precache.length) ? swCfg.precache : [];
    var urls = [];
    tokens.forEach(function (tok) {
        var parts = String(tok).split('.');
        var d = deps[parts[0]];
        var rel = (parts[1] === 'css') ? (d && d.css && d.css[0]) : (d && d[parts[1]]);
        if (d && rel) { urls.push(base + rel + '?v=' + encodeURIComponent(d.version || '0')); }
    });

    var params = null;
    try { params = new URL(self.location.href).searchParams; } catch (e) { params = null; }
    var cacheName = PREFIX + (params ? (params.get('v') || '0') : '0') + '-' + (params ? (params.get('s') || srcName) : srcName);

    return { source: srcName, base: base, ttlMs: ttlSec * 1000, urls: urls, cacheName: cacheName, swCache: src.swCache !== false };
}

function getConfig() {
    if (configPromise) { return configPromise; }
    configPromise = fetchJson(MANIFEST_PATH + '?ts=' + Date.now()).then(buildConfig);
    return configPromise;
}

/** 复制响应并写入时间戳/调试头 */
function stamp(res, storedAt, state) {
    return res.blob().then(function (body) {
        var headers = new Headers(res.headers);
        if (storedAt) { headers.set('x-zzkxs-stored-at', String(storedAt)); }
        if (state) { headers.set('x-zzkxs-sw', state); }
        return new Response(body, { status: res.status, statusText: res.statusText, headers: headers });
    });
}
function fresh(res, ttlMs) {
    var t = parseInt(res.headers.get('x-zzkxs-stored-at') || '0', 10);
    return !!t && (Date.now() - t) < ttlMs;
}

/** 跨域资源用 CORS 模式取（才能写进 Cache Storage；需要源站 CORS） */
function netFetch(req, cfg) {
    try {
        var u = new URL(req.url);
        if (u.origin !== self.location.origin && req.url.indexOf(cfg.base) === 0) {
            return fetch(new Request(req.url, { mode: 'cors', credentials: 'omit', cache: 'no-cache' }));
        }
    } catch (e) { /* 交给普通 fetch */ }
    return fetch(req);
}

function handle(req, cfg) {
    return caches.open(cfg.cacheName).then(function (cache) {
        return cache.match(req).then(function (hit) {
            if (hit && fresh(hit, cfg.ttlMs)) { return stamp(hit, null, 'hit'); }
            return netFetch(req, cfg).then(function (res) {
                if (!res || !res.ok) { return hit ? stamp(hit, null, 'stale') : res; }
                return stamp(res, Date.now(), 'miss').then(function (stored) {
                    return cache.put(req, stored.clone()).catch(function () { return null; })
                        .then(function () { return stored; });
                });
            }).catch(function () {
                return hit ? stamp(hit, null, 'offline') : new Response('', { status: 504, statusText: 'offline' });
            });
        });
    });
}

function wantsDebug(req) {
    try { return new URL(req.url).searchParams.get('swrdebug') === '1'; } catch (e) { return false; }
}

/** 写入缓存前打上"最近检查时间"（用于最短重验间隔） */
function withCheckedAt(res, ts) {
    return res.blob().then(function (body) {
        var headers = new Headers(res.headers);
        headers.set('x-zzkxs-checked-at', String(ts));
        return new Response(body, { status: res.status, statusText: res.statusText, headers: headers });
    });
}

/** SWR：命中直接返回缓存（不复制 body），后台按最短间隔回源更新；网络失败保留旧缓存 */
function swr(e, req) {
    var debug = wantsDebug(req);
    return caches.open(SITE_CACHE).then(function (cache) {
        return cache.match(req).then(function (hit) {
            var checkedAt = hit ? parseInt(hit.headers.get('x-zzkxs-checked-at') || '0', 10) : 0;
            var needNet = !hit || (Date.now() - checkedAt) >= SITE_REVALIDATE_MS;
            var netPromise = null;
            if (needNet) {
                netPromise = fetch(req).then(function (res) {
                    if (!res || !res.ok) { return res; }
                    return withCheckedAt(res, Date.now()).then(function (stored) {
                        cache.put(req, stored.clone()).catch(function () { /* 配额/不透明响应等，忽略 */ });
                        return stored;
                    });
                }).catch(function () { return null; });
                e.waitUntil(netPromise.catch(function () { /* 后台失败忽略 */ }));
            }
            if (hit) {
                return debug ? stamp(hit, null, 'swr-hit') : hit;
            }
            return (netPromise || Promise.resolve(null)).then(function (res) {
                if (!res) { return new Response('', { status: 504, statusText: 'offline' }); }
                return debug ? stamp(res, null, 'swr-miss') : res;
            });
        });
    });
}

/** 图片/字体等二进制：cache-first（文件名视为内容版本，不后台刷新） */
function cacheFirstBinary(req) {
    return caches.open(SITE_CACHE).then(function (cache) {
        return cache.match(req).then(function (hit) {
            if (hit) { return hit; }
            return fetch(req).then(function (res) {
                if (res && res.ok) { cache.put(req, res.clone()).catch(function () { }); }
                return res;
            });
        });
    });
}

self.addEventListener('install', function (e) {
    e.waitUntil(getConfig().then(function (cfg) {
        if (!cfg.swCache || !cfg.urls.length) { return null; }
        return caches.open(cfg.cacheName).then(function (cache) {
            return Promise.all(cfg.urls.map(function (url) {
                return cache.match(url).then(function (hit) {
                    if (hit && fresh(hit, cfg.ttlMs)) { return null; }
                    return netFetch(new Request(url), cfg).then(function (res) {
                        if (!res || !res.ok) { return null; }
                        return stamp(res, Date.now()).then(function (stored) {
                            return cache.put(url, stored).catch(function () { return null; });
                        });
                    }).catch(function () { return null; });
                });
            }));
        });
    }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
    e.waitUntil(getConfig().then(function (cfg) {
        return caches.keys().then(function (keys) {
            return Promise.all(keys.filter(function (k) {
                /* 只清理旧 vendor 缓存；zzkxs-site-v1 跨版本保留 */
                return k.indexOf(PREFIX) === 0 && k !== cfg.cacheName;
            }).map(function (k) { return caches.delete(k); }));
        });
    }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
    var req = e.request;
    if (!req || req.method !== 'GET') { return; }
    var url;
    try { url = new URL(req.url); } catch (err) { return; }
    if (req.headers.has('range')) { return; }

    if (url.origin === self.location.origin) {
        /* 1) vendor：cache-first 9 个月 */
        if (url.pathname.indexOf('/assets/vendor/') === 0) {
            e.respondWith(getConfig().then(function (cfg) { return handle(req, cfg); }));
            return;
        }
        /* 2) 配置/SW/loader：不缓存，交给网络 */
        if (isExcluded(url.pathname)) { return; }
        /* 3) 图片/字体：cache-first */
        if (BINARY_RE.test(url.pathname)) {
            e.respondWith(cacheFirstBinary(req));
            return;
        }
        /* 4) 其余站点资源：SWR */
        e.respondWith(swr(e, req));
        return;
    }

    /* 跨域：只接管当前 vendor 来源（bucket 场景） */
    e.respondWith(getConfig().then(function (cfg) {
        return (cfg && req.url.indexOf(cfg.base) === 0) ? handle(req, cfg) : fetch(req);
    }).catch(function () { return fetch(req); }));
});
