/* ============================================================
   致知科学社 · 缓存 Service Worker（v4，单缓存）
   ------------------------------------------------------------
   适用范围：**只处理非 HTML 请求**。HTML 文档（导航 / *.html）一概不拦截，
             由站点的发布体系保证新鲜。
   缓存：一个 Cache Storage：zzkxs-cache-v4
         · URL 带 ?v=<版本>  → 视为不可变：命中即返回，永不后台刷新
         · 其他非 HTML       → 缓存优先 + 30 分钟静默刷新 + 12 个月清理
   预缓存：install 时读 /assets/deps/deps.json 的 serviceWorker.precache
           列表（目前只有 katex.js / katex.css）；hljs 不预缓存，
           由 loader 在进入站点后静默下载入缓存。
   旧缓存：activate 时**不删**。等新缓存里预缓存清单全部到位（verify 通过）
           才删旧缓存（zzkxs-vendor-* / zzkxs-assets-* / zzkxs-site-*），
           期间未命中的请求会到旧缓存里找并"提升"进新缓存。
   节流：完整性检查 + 清理最多每 5 分钟跑一次；清理分批（≤20 条/次），
         全部在 waitUntil 里异步执行，不阻塞响应。
   失败开放：任何异常都不影响请求（交给浏览器/网络）。
   ============================================================ */
'use strict';

var CACHE = 'zzkxs-cache-v4';
var LEGACY_PREFIXES = ['zzkxs-vendor-', 'zzkxs-assets-', 'zzkxs-site-'];
var MANIFEST_URL = '/assets/deps/deps.json';
var META_PREFIX = '/__zzkxs__/';
var META_PRECACHE = META_PREFIX + 'precache';
var FRESH_MS = 30 * 60 * 1000;              // 静默刷新间隔
var RETAIN_MS = 365 * 24 * 60 * 60 * 1000;  // 保留期（12 个月）
var CHECK_MS = 5 * 60 * 1000;              // 检验/清理节流
var PURGE_BATCH = 20;                       // 每次最多清理条目数

var vendorBase = '';
var precacheList = null;   // 绝对 URL 数组（带 ?v=）
var lastCheck = 0;
var refreshing = {};

/* ---------- 跨域 vendor（OSS/CDN）预留接口 ----------
   现状：vendor 走同源 assets/vendor/；跨域（deps.json 的 sources.oss）未启用。
   启用时需要：
     1) 让 fetch 采用 CORS 模式（否则 <script>/<link> 的 no-cors 请求得到 opaque 响应，
        Cache Storage 无法可靠打戳/复用）；
     2) 源站（bucket/CDN）返回 Access-Control-Allow-Origin；
     3) 允许把 'cors' 类型响应写入缓存。
   下面的开关就是接口：把 corsFetch 置 true 即可走 CORS 拉取并缓存，
   acceptOpaque 保留给无法配置 CORS 的极端场景（opaque 无状态、无法校验）。
   注意：改这里之前先确认 sources.oss.cors=true 且 CDN 已配好 CORS。 */
var CROSS = {
    corsFetch: false,      // 跨域 vendor 用 CORS 模式拉取（推荐开启方式）
    acceptOpaque: false    // 是否允许缓存 opaque 响应（不推荐：无法打戳/判断状态）
};

/** 跨域请求的取数请求：同源原样返回；跨域且开启 corsFetch 时换成 CORS 请求 */
function netRequest(req) {
    var cors = true;
    try { cors = new URL(req.url).origin !== self.location.origin; } catch (e) { cors = false; }
    if (cors && CROSS.corsFetch) {
        return new Request(req.url, { mode: 'cors', credentials: 'omit', cache: 'no-cache' });
    }
    return req;
}

/** 响应是否允许写入缓存（跨域 opaque 由 CROSS.acceptOpaque 决定） */
function allowStore(res) {
    if (!res) { return false; }
    if (res.type === 'opaque') { return CROSS.acceptOpaque; }
    return !!res.ok;
}

/* ---------- 基础工具 ---------- */

function cacheOpen() { return caches.open(CACHE); }

function metaRequest(path) {
    return new Request(self.location.origin + path);
}

function storedAt(res) {
    var t = res && res.headers ? parseInt(res.headers.get('x-zzkxs-stored-at') || '0', 10) : 0;
    return t > 0 ? t : 0;
}

/** 复制响应并打上写入时间戳（Cache Storage 里靠它判断年龄） */
function stamped(res, at) {
    return res.blob().then(function (body) {
        var headers = new Headers(res.headers);
        headers.set('x-zzkxs-stored-at', String(at));
        return new Response(body, { status: res.status, statusText: res.statusText, headers: headers });
    });
}

function hasVersion(req) {
    try { return new URL(req.url).searchParams.has('v'); } catch (e) { return false; }
}

function isDocument(req, url) {
    if (req.mode === 'navigate' || req.destination === 'document') { return true; }
    return /\.html?$/i.test(url.pathname);
}

/* ---------- 清单（deps.json）与预缓存 ---------- */

function loadManifest() {
    return fetch(MANIFEST_URL, { cache: 'no-store' }).then(function (res) {
        return res && res.ok ? res.json() : null;
    }).then(function (m) {
        if (!m || !m.deps) { return null; }
        var srcName = m.source || 'local';
        var src = (m.sources || {})[srcName] || { base: '/assets/vendor/' };
        var base;
        try { base = new URL(src.base, self.location.origin + MANIFEST_URL).href; }
        catch (e) { base = self.location.origin + '/assets/vendor/'; }
        if (base.charAt(base.length - 1) !== '/') { base += '/'; }
        vendorBase = base;

        /* 预缓存清单：deps.json 的 serviceWorker.precache（"库.字段"记号） */
        var tokens = (m.serviceWorker && m.serviceWorker.precache) || [];
        var urls = [];
        tokens.forEach(function (tok) {
            var parts = String(tok).split('.');
            var d = m.deps[parts[0]];
            if (!d) { return; }
            var rel = parts[1] === 'css' ? (d.css && d.css[0]) : d[parts[1]];
            if (!rel) { return; }
            urls.push(base + rel + '?v=' + encodeURIComponent(d.version || '0'));
        });
        return urls;
    }).catch(function () { return null; });
}

function savePrecache(urls) {
    return cacheOpen().then(function (cache) {
        var body = JSON.stringify(urls || []);
        return cache.put(metaRequest(META_PRECACHE), new Response(body, {
            headers: { 'content-type': 'application/json', 'x-zzkxs-stored-at': String(Date.now()) }
        }));
    }).catch(function () {});
}

function readPrecache() {
    if (precacheList) { return Promise.resolve(precacheList); }
    return cacheOpen().then(function (cache) {
        return cache.match(metaRequest(META_PRECACHE)).then(function (res) {
            return res ? res.json() : null;
        });
    }).then(function (urls) {
        precacheList = Array.isArray(urls) ? urls : null;
        return precacheList;
    }).catch(function () { return null; });
}

function precache() {
    return loadManifest().then(function (urls) {
        if (!urls || !urls.length) { return null; }
        precacheList = urls;
        return savePrecache(urls).then(function () {
            return cacheOpen().then(function (cache) {
                var i = 0;
                function step() {
                    if (i >= urls.length) { return null; }
                    var url = urls[i++];
                    return cache.match(url).then(function (hit) {
                        if (hit) { return null; }
                        return fetch(url).then(function (res) {
                            if (!res || !res.ok) { return null; }
                            return stamped(res, Date.now()).then(function (s) {
                                return cache.put(url, s).catch(function () {});
                            });
                        }).catch(function () { return null; });
                    }).then(step);
                }
                return step();
            });
        });
    });
}

/* ---------- 命中查找：新缓存 → 旧缓存（命中即提升） ---------- */

function lookup(cache, req) {
    return cache.match(req).then(function (hit) {
        if (hit) { return hit; }
        return caches.keys().then(function (names) {
            var legacy = names.filter(function (n) {
                if (n === CACHE) { return false; }
                for (var i = 0; i < LEGACY_PREFIXES.length; i++) {
                    if (n.indexOf(LEGACY_PREFIXES[i]) === 0) { return true; }
                }
                return false;
            });
            var i = 0;
            function next() {
                if (i >= legacy.length) { return null; }
                var name = legacy[i++];
                return caches.open(name).then(function (c) { return c.match(req); }).then(function (res) {
                    if (!res) { return next(); }
                    /* 提升进新缓存：保留旧时间戳，没有就按当前时间 */
                    var at = storedAt(res) || Date.now();
                    return stamped(res, at).then(function (s) {
                        return cache.put(req, s.clone()).catch(function () { return null; }).then(function () { return s; });
                    });
                });
            }
            return next();
        });
    });
}

/* ---------- 网络获取并写入缓存 ---------- */

function fetchStore(cache, req, stale) {
    return fetch(netRequest(req)).then(function (res) {
        /* 跨域响应策略见 CROSS 预留接口：默认不缓存 opaque / 非 2xx */
        if (!allowStore(res)) {
            if (res && res.type === 'opaque' && CROSS.acceptOpaque) { return res; }
            return stale || res;
        }
        return stamped(res, Date.now()).then(function (s) {
            /* 等写入完成再返回：调用方（如脚本加载）之后立刻查缓存也能看到 */
            return cache.put(req, s.clone()).catch(function () {}).then(function () { return s; });
        });
    }).catch(function () {
        return stale || new Response('', { status: 504, statusText: 'offline' });
    });
}

/* ---------- 静默刷新（30 分钟节流，inflight 去重） ---------- */

function scheduleRefresh(cache, req, event) {
    var key = req.url;
    if (refreshing[key]) { return; }
    refreshing[key] = true;
    var job = fetch(netRequest(req)).then(function (res) {
        if (!allowStore(res)) { return null; }
        return stamped(res, Date.now()).then(function (s) {
            return cache.put(req, s.clone()).catch(function () {});
        });
    }).catch(function () { return null; }).then(function () { delete refreshing[key]; });
    if (event && event.waitUntil) {
        try { event.waitUntil(job); return; } catch (e) { /* 继续走下面的兜底 */ }
    }
    job.then(function () {}, function () {});
}

/* ---------- 完整性校验 + 清理（节流 5 分钟，分批） ---------- */

function checkAndClean() {
    return readPrecache().then(function (urls) {
        if (!urls || !urls.length) { return null; }        // 清单未知 → 不删任何旧缓存
        return cacheOpen().then(function (cache) {
            return Promise.all(urls.map(function (u) { return cache.match(u); })).then(function (hits) {
                var complete = true;
                for (var i = 0; i < hits.length; i++) { if (!hits[i]) { complete = false; break; } }
                if (!complete) { return null; }             // 新缓存没齐 → 保留旧缓存
                return deleteLegacy().then(function () { return purgeExpired(cache, PURGE_BATCH); });
            });
        });
    }).catch(function () { return null; });
}

function deleteLegacy() {
    return caches.keys().then(function (names) {
        var jobs = [];
        names.forEach(function (n) {
            if (n === CACHE) { return; }
            for (var i = 0; i < LEGACY_PREFIXES.length; i++) {
                if (n.indexOf(LEGACY_PREFIXES[i]) === 0) { jobs.push(caches.delete(n)); break; }
            }
        });
        return Promise.all(jobs);
    }).catch(function () {});
}

function purgeExpired(cache, limit) {
    return cache.keys().then(function (keys) {
        var todo = [];
        for (var i = 0; i < keys.length && todo.length < limit; i++) {
            if (keys[i].url.indexOf(META_PREFIX) === 0) { continue; }
            todo.push(keys[i]);
        }
        return Promise.all(todo.map(function (req) {
            return cache.match(req).then(function (res) {
                if (res && Date.now() - storedAt(res) > RETAIN_MS) { return cache.delete(req); }
                return null;
            });
        }));
    }).catch(function () {});
}

function maybeCheck(event) {
    if (Date.now() - lastCheck < CHECK_MS) { return; }
    lastCheck = Date.now();
    var job = checkAndClean();
    if (event && event.waitUntil) {
        try { event.waitUntil(job); return; } catch (e) { /* 兜底 */ }
    }
    job.then(function () {}, function () {});
}

/* ---------- 请求处理 ---------- */

function serve(event, req) {
    return cacheOpen().then(function (cache) {
        return lookup(cache, req).then(function (hit) {
            if (!hit) { return fetchStore(cache, req, null); }
            if (hasVersion(req)) { return hit; }                  // 不可变
            var age = Date.now() - storedAt(hit);
            if (age < FRESH_MS) { return hit; }                   // 30 分钟内不打扰
            if (age < RETAIN_MS) {                                // 30 分钟~12 个月：先给旧值，后台刷新
                scheduleRefresh(cache, req, event);
                return hit;
            }
            return fetchStore(cache, req, hit);                   // 超过保留期
        });
    }).catch(function () { return fetch(req); });
}

self.addEventListener('install', function (event) {
    event.waitUntil(
        precache().catch(function () { return null; }).then(function () { return self.skipWaiting(); })
    );
});

self.addEventListener('activate', function (event) {
    event.waitUntil(
        Promise.resolve()
            .then(function () { return self.clients.claim(); })
            .then(function () { return checkAndClean(); })
            .catch(function () { return null; })
    );
});

self.addEventListener('fetch', function (event) {
    try {
        var req = event.request;
        if (!req || req.method !== 'GET') { return; }
        if (req.headers && req.headers.get('range')) { return; }

        var url;
        try { url = new URL(req.url); } catch (e) { return; }
        if (url.pathname === '/deps-sw.min.js' || url.pathname === '/deps-sw.js') { return; }  // SW 自身交给浏览器
        if (isDocument(req, url)) { return; }                      // HTML 不拦截

        if (url.origin === self.location.origin) {
            maybeCheck(event);
            event.respondWith(serve(event, req));
            return;
        }
        if (vendorBase && req.url.indexOf(vendorBase) === 0) {      // 跨域 vendor（OSS 场景）
            maybeCheck(event);
            event.respondWith(serve(event, req));
        }
    } catch (err) { /* fail-open：不调用 respondWith，浏览器走网络 */ }
});
