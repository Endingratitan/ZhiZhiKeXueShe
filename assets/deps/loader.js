/* ============================================================
   致知科学社 · 第三方依赖加载/预热器（assets/deps/loader.js）
   读取同目录 deps.json（vendor 清单/来源/缓存时长），提供：
     ZZKXS.deps.katex() / hljs() / warm() / state() / ready
   缓存：Service Worker（/deps-sw.js）为主；策略见该文件：
         HTML 不拦截、其余缓存 + 30 分钟静默刷新（URL 带 ?v= 视为不可变）。
   SW 不可用时只做按需加载（不预热），页面功能不受影响。
   hljs：不进 SW 预缓存，进入站点后空闲时静默下载一次（7 天内不重复）。
   控制权：已受控 → 请求走 SW 缓存；未受控 → 立即直连（HTTP 缓存/网络兜底），
           SW 在后台安装，不阻塞等待（旧实现 waitController 最多白等 3s）。
   预加载：宽屏 && 本页引了公式流脚本时，尽早用 <link rel=preload>
           把 KaTeX CSS/JS 的下载提前（见 preloadVendor，条件严格，非同源不预载）；
   加载：CSS 与 JS **并行**请求，均完成后再 resolve（避免慢网多付一个 RTT）。
   清单读不到时用下方 DEFAULT_MANIFEST 兜底。
   ============================================================ */
(function (global, document) {
    'use strict';

    var DEFAULT_MANIFEST = {
        schema: 1, browserCacheSeconds: 23328000,
        serviceWorker: { enabled: true, cacheSeconds: 23328000, precache: ['katex.js', 'katex.css'] },
        source: 'local',
        sources: {
            local: { base: '../vendor/', swCache: true },
            oss: { base: '', swCache: true, cors: true }
        },
        deps: {
            katex: { version: '0.19.0', js: 'katex/katex.min.js', css: ['katex/katex.min.css'] },
            hljs: { version: '11.12.0', js: 'hljs/highlight.min.js', css: ['hljs/styles/github.min.css', 'hljs/styles/github-dark.min.css'] }
        }
    };

    var GLOBALS = {
        katex: function () { return !!(global.katex && typeof global.katex.render === 'function'); },
        hljs: function () {
            return !!(global.hljs &&
                (typeof global.hljs.highlight === 'function' || typeof global.hljs.highlightElement === 'function'));
        }
    };

    var STORE_KEY = 'zzkxs.deps.vendor.v2';
    var TIMEOUT_MS = 20000;
    var MANIFEST_TIMEOUT_MS = 5000;

    var self = document.currentScript || (function () {
        var all = document.getElementsByTagName('script');
        for (var i = 0; i < all.length; i++) { if (/assets\/deps\/loader\.js/.test(all[i].src || '')) { return all[i]; } }
        return null;
    })();
    var warmMode = String((self && self.getAttribute('data-warm')) || 'idle').toLowerCase();
    var debug = !!(self && self.getAttribute('data-debug') === '1');

    var ROOT = (function () { try { return new URL('../../', self.src).href; } catch (e) { return '/'; } })();
    var MANIFEST_URL = (function () {
        try { return new URL('deps.json', self.src).href; }
        catch (e) { return ROOT + 'assets/deps/deps.json'; }
    })();

    var state = { manifest: null, base: '', loadError: null, lastWarm: null };
    var loadPromises = {};
    var warmPromise = null;
    var sw = {
        supported: !!(global.navigator && 'serviceWorker' in global.navigator &&
            (global.location.protocol === 'https:' ||
                global.location.hostname === 'localhost' || global.location.hostname === '127.0.0.1')),
        ready: null
    };

    function log() {
        if (!debug || !global.console || !console.info) { return; }
        var args = ['[deps]'].concat(Array.prototype.slice.call(arguments));
        console.info.apply(console, args);
    }
    function clone(o) { try { return JSON.parse(JSON.stringify(o)); } catch (e) { return o; } }
    function absUrl(rel, base) { try { return new URL(rel, base).href; } catch (e) { return ''; } }
    function slash(u) { return u && u.charAt(u.length - 1) === '/' ? u : (u || '') + '/'; }
    function num(v, d) { var n = parseInt(v, 10); return (isFinite(n) && n > 0) ? n : d; }
    function merge(a, b) {
        var out = {}, k;
        for (k in a) { if (Object.prototype.hasOwnProperty.call(a, k)) { out[k] = a[k]; } }
        for (k in b) { if (Object.prototype.hasOwnProperty.call(b, k)) { out[k] = b[k]; } }
        return out;
    }

    /* ---------- deps.json ---------- */

    function fetchManifest() {
        if (!global.fetch) { return Promise.resolve(null); }
        var timer;
        var timeout = new Promise(function (resolve) {
            timer = global.setTimeout(function () { resolve(null); }, MANIFEST_TIMEOUT_MS);
        });
        var job = global.fetch(MANIFEST_URL, { cache: 'no-cache', credentials: 'same-origin' }).then(function (r) {
            return (r && r.ok) ? r.json() : null;
        }).catch(function (e) { log('manifest failed', e && e.message); return null; });
        return Promise.race([job, timeout]).then(function (m) { global.clearTimeout(timer); return m; });
    }

    function normalize(raw) {
        var def = clone(DEFAULT_MANIFEST);
        var m = (raw && typeof raw === 'object') ? raw : {};
        if (!m.deps || typeof m.deps !== 'object') { state.loadError = 'manifest-missing'; }
        var deps = {};
        for (var k in def.deps) {
            if (!Object.prototype.hasOwnProperty.call(def.deps, k)) { continue; }
            var d = (m.deps && m.deps[k]) || def.deps[k];
            if (!d.version || !d.js) { state.loadError = 'deps-invalid:' + k; d = def.deps[k]; }
            deps[k] = d;
        }
        var sources = {};
        for (var s in def.sources) {
            if (Object.prototype.hasOwnProperty.call(def.sources, s)) {
                sources[s] = merge(def.sources[s], (m.sources || {})[s]);
            }
        }
        for (var ns in (m.sources || {})) {
            if (Object.prototype.hasOwnProperty.call(m.sources, ns) && !sources[ns]) {
                sources[ns] = merge({ base: '', swCache: false }, m.sources[ns]);
            }
        }
        var out = {
            sourceName: m.source && sources[m.source] && sources[m.source].base ? m.source : 'local',
            sources: sources,
            deps: deps,
            serviceWorker: merge(def.serviceWorker, m.serviceWorker),
            browserCacheSeconds: num(m.browserCacheSeconds, def.browserCacheSeconds)
        };
        var src = out.sources[out.sourceName];
        out.base = slash(absUrl(src.base, MANIFEST_URL) || ROOT + 'assets/vendor/');
        out.sourceCfg = src;
        out.cacheSeconds = num(out.serviceWorker.cacheSeconds, out.browserCacheSeconds);
        return out;
    }

    var ready = fetchManifest().then(function (m) {
        state.manifest = normalize(m);
        state.base = state.manifest.base;
        return state.manifest;
    });

    function versionsOf(cfg) {
        var v = {};
        for (var k in cfg.deps) { if (Object.prototype.hasOwnProperty.call(cfg.deps, k)) { v[k] = cfg.deps[k].version; } }
        return v;
    }
    function depUrl(dep, rel) { return state.base + rel + '?v=' + encodeURIComponent(dep.version || '0'); }

    /** 标记过期/版本变化后：显式请求 vendor 文件，让 SW 更新缓存（无需 IDB/SW 消息） */
    function refreshVendor(cfg) {
        var urls = [];
        for (var k in cfg.deps) {
            if (!Object.prototype.hasOwnProperty.call(cfg.deps, k)) { continue; }
            var d = cfg.deps[k];
            urls.push(depUrl(d, d.js));
            (d.css || []).forEach(function (rel) { urls.push(depUrl(d, rel)); });
        }
        return Promise.all(urls.map(function (url) {
            var same = true;
            try { same = new URL(url).origin === global.location.origin; } catch (e) { same = true; }
            return global.fetch(url, {
                cache: 'no-cache',
                mode: same ? 'same-origin' : 'cors',
                credentials: same ? 'same-origin' : 'omit'
            }).catch(function () { return null; });
        }));
    }

    /* ---------- 预热标记（SW 快路径用） ---------- */

    function readMarker() {
        try {
            var m = JSON.parse(global.localStorage.getItem(STORE_KEY) || 'null');
            return (m && m.versions && m.exp) ? m : null;
        } catch (e) { return null; }
    }
    function markerFresh(cfg) {
        var m = readMarker();
        if (!m || m.source !== cfg.sourceName) { return false; }
        var v = versionsOf(cfg);
        for (var k in v) { if (v[k] !== m.versions[k]) { return false; } }
        return Date.now() < m.exp;
    }
    function writeMarker(cfg, extra) {
        var now = Date.now();
        try {
            global.localStorage.setItem(STORE_KEY, JSON.stringify({
                schema: 2, source: cfg.sourceName, versions: versionsOf(cfg),
                at: now, exp: now + cfg.cacheSeconds * 1000, last: extra || null
            }));
        } catch (e) { /* 隐私模式/配额不致命 */ }
    }

    /* ---------- hljs 静默下载（与 KaTeX 同一套 vendor 配置，只是不预缓存） ----------
       hljs 不进入 SW install 预缓存（省首装 126 KB）；进入站点后空闲时补缓存。
       是否需要补：用 caches.match 判断"缓存里是否已有"，缺了才补；
       失败则退避 1 小时，避免网络故障时每次进站都重试。 */
    var HLJS_RETRY_KEY = 'zzkxs.deps.hljs.retry';
    var HLJS_RETRY_MS = 60 * 60 * 1000;

    function readHljsRetry() {
        try { return JSON.parse(global.localStorage.getItem(HLJS_RETRY_KEY) || 'null'); } catch (e) { return null; }
    }
    function writeHljsRetry(at) {
        try { global.localStorage.setItem(HLJS_RETRY_KEY, JSON.stringify({ at: at })); } catch (e) { /* 忽略 */ }
    }
    function clearHljsRetry() {
        try { global.localStorage.removeItem(HLJS_RETRY_KEY); } catch (e) { /* 忽略 */ }
    }

    function hljsUrls(cfg) {
        var d = cfg && cfg.deps && cfg.deps.hljs;
        if (!d || !d.js) { return []; }
        var urls = [depUrl(d, d.js)];
        (d.css || []).forEach(function (rel) { urls.push(depUrl(d, rel)); });
        return urls;
    }

    function prefetchHljs(cfg) {
        var urls = hljsUrls(cfg);
        if (!urls.length) { return Promise.resolve(false); }
        var conn = global.navigator && global.navigator.connection;
        if (conn && conn.saveData) { return Promise.resolve(false); }

        var retry = readHljsRetry();
        if (retry && (Date.now() - retry.at) < HLJS_RETRY_MS) { return Promise.resolve(false); }

        /* 缓存里已有全部文件 → 不再打扰（不依赖 TTL） */
        var hasCaches = !!(global.caches && typeof global.caches.match === 'function');
        var probe = hasCaches
            ? Promise.all(urls.map(function (u) { return global.caches.match(u).catch(function () { return null; }); }))
            : Promise.resolve(null);

        return probe.then(function (hits) {
            if (hits && hits.every(Boolean)) { return false; }
            return new Promise(function (resolve) {
                var later = function () {
                    global.setTimeout(function () {
                        Promise.all(urls.map(function (url) {
                            var same = true;
                            try { same = new URL(url).origin === global.location.origin; } catch (e) { same = true; }
                            return global.fetch(url, {
                                cache: 'default',
                                mode: same ? 'same-origin' : 'cors',
                                credentials: same ? 'same-origin' : 'omit'
                            }).then(function (res) { return !!(res && res.ok); }).catch(function () { return false; });
                        })).then(function (oks) {
                            if (oks.every(Boolean)) { clearHljsRetry(); } else { writeHljsRetry(Date.now()); }
                            resolve(oks.every(Boolean));
                        });
                    }, 1200);
                };
                if (global.requestIdleCallback) { global.requestIdleCallback(later, { timeout: 4000 }); }
                else { global.setTimeout(later, 2500); }
            });
        });
    }

    /* ---------- Service Worker ---------- */

    function swVersionKey(cfg) {
        var v = versionsOf(cfg), parts = [];
        for (var k in v) { if (Object.prototype.hasOwnProperty.call(v, k)) { parts.push(k + v[k]); } }
        return encodeURIComponent(parts.join('-') + '@' + cfg.sourceName);
    }

    function ensureSw(cfg) {
        if (!sw.supported || !cfg.serviceWorker.enabled) { return Promise.resolve(false); }
        if (sw.ready) { return sw.ready; }
        sw.ready = global.navigator.serviceWorker.register(ROOT + 'deps-sw.min.js?v=' + swVersionKey(cfg), { scope: '/' })
            .then(function () { return global.navigator.serviceWorker.ready.then(function () { return true; }); })
            .catch(function (e) { log('SW register failed', e && e.message); sw.ready = null; return false; });
        return sw.ready;
    }

    function waitController(timeoutMs) {
        if (!sw.supported) { return Promise.resolve(false); }
        if (global.navigator.serviceWorker.controller) { return Promise.resolve(true); }
        return new Promise(function (resolve) {
            var done = false;
            var timer = global.setTimeout(function () {
                if (done) { return; }
                done = true;
                resolve(!!global.navigator.serviceWorker.controller);
            }, timeoutMs || 3000);
            global.navigator.serviceWorker.addEventListener('controllerchange', function () {
                if (done) { return; }
                done = true; global.clearTimeout(timer);
                resolve(true);
            }, { once: true });
        });
    }

    /* ---------- 预热（仅 SW 路径；无 SW 时只按需加载） ---------- */

    function warm() {
        if (warmPromise) { return warmPromise; }
        if (global.location && global.location.protocol === 'file:') { return Promise.resolve({ skipped: 'file-protocol' }); }
        var conn = global.navigator && global.navigator.connection;
        if (conn && conn.saveData) { return Promise.resolve({ skipped: 'save-data' }); }

        warmPromise = ready.then(function () {
            var cfg = state.manifest;
            prefetchHljs(cfg);   // 静默下载 hljs（不阻塞、失败忽略）
            var useSw = cfg.serviceWorker.enabled && sw.supported && cfg.sourceCfg.swCache !== false;
            if (!useSw) { state.lastWarm = { skipped: 'no-sw' }; return state.lastWarm; }
            var marker = readMarker();
            var stale = !!marker && !markerFresh(cfg);   // 过期 / 版本或来源变化
            if (!stale && markerFresh(cfg) && global.navigator.serviceWorker.controller) {
                state.lastWarm = { mode: 'service-worker', skipped: 'marker-fresh' };
                return state.lastWarm;
            }
            return ensureSw(cfg).then(function (ok) {
                if (!ok) { state.lastWarm = { skipped: 'sw-failed' }; return state.lastWarm; }
                return waitController(3000).then(function (controlled) {
                    var next = stale
                        ? refreshVendor(cfg).then(function () { return controlled; })
                        : Promise.resolve(controlled);
                    return next.then(function (controlledNow) {
                        var r = { mode: 'service-worker', source: cfg.sourceName, controlled: !!controlledNow, refresh: stale };
                        writeMarker(cfg, r);
                        state.lastWarm = r;
                        return r;
                    });
                });
            });
        });
        return warmPromise;
    }

    /* ---------- 按需加载 ---------- */

    function injectScript(url, retried) {
        return new Promise(function (resolve) {
            var s = document.createElement('script');
            s.src = url;
            s.async = true;
            var done = false;
            var timer = global.setTimeout(function () {
                if (done) { return; }
                done = true;
                s.onload = s.onerror = null;
                if (s.parentNode) { s.parentNode.removeChild(s); }
                resolve(retried ? false : injectScript(url, true));
            }, TIMEOUT_MS);
            s.onload = function () { if (done) { return; } done = true; global.clearTimeout(timer); resolve(true); };
            s.onerror = function () {
                if (done) { return; }
                done = true; global.clearTimeout(timer);
                if (s.parentNode) { s.parentNode.removeChild(s); }
                resolve(retried ? false : injectScript(url, true));
            };
            document.head.appendChild(s);
        });
    }

    function injectCss(url) {
        return new Promise(function (resolve) {
            var link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = url;
            var done = false;
            var timer = global.setTimeout(function () { if (!done) { done = true; resolve(false); } }, TIMEOUT_MS);
            link.onload = function () { if (!done) { done = true; global.clearTimeout(timer); resolve(true); } };
            link.onerror = function () { if (!done) { done = true; global.clearTimeout(timer); resolve(false); } };
            document.head.appendChild(link);
        });
    }

    /** 按需加载某库（'katex' | 'hljs'）：已存在 → true；失败可重试。 */
    function load(kind) {
        if (!GLOBALS[kind]) { return Promise.resolve(false); }
        if (GLOBALS[kind]()) { return Promise.resolve(true); }
        if (loadPromises[kind]) { return loadPromises[kind]; }

        loadPromises[kind] = ready.then(function () {
            var cfg = state.manifest, dep = cfg.deps[kind];
            if (!dep) { return false; }
            if (GLOBALS[kind]()) { return true; }
            var useSw = cfg.serviceWorker.enabled && sw.supported && cfg.sourceCfg.swCache !== false;
            /* 2A：不阻塞等待 SW 控制权。
               - 已受控 → 直接注入，请求走 SW 缓存（cache-first）；
               - 未受控（首访 / DevTools 绕过 SW / 隐私模式）→ 立即注入，
                 由浏览器 HTTP 缓存或网络兜底，同时后台注册 SW，
                 装好后本次之后的页面即可命中缓存。
               旧实现是 waitController(3000)：无 SW 场景白等最多 3s（实测 3.2s）。 */
            var before;
            if (!useSw) {
                before = Promise.resolve(false);
            } else if (global.navigator.serviceWorker.controller) {
                before = Promise.resolve(true);
            } else {
                ensureSw(cfg);                      // 后台安装，不 await
                before = Promise.resolve(false);
            }
            return before.then(function () {
                /* CSS 与 JS **并行**请求：两者互不依赖（JS 执行时不渲染公式，
                   真正渲染发生在 load() resolve 之后，那时 CSS 也已就位）。
                   旧实现是"等 CSS 全部加载完再发 JS"，在慢网下白白多付一个 RTT。 */
                var cssJob = Promise.all((dep.css || []).map(function (rel) { return injectCss(depUrl(dep, rel)); }));
                var jsJob = injectScript(depUrl(dep, dep.js), false);
                return Promise.all([cssJob, jsJob]);
            }).then(function (results) {
                var jsOk = results[1];
                var ok = jsOk && GLOBALS[kind]();
                if (!ok) { loadPromises[kind] = null; }
                return ok;
            });
        });
        return loadPromises[kind];
    }

    /* ---------- 自动预热 ---------- */

    /* ---------- 提前预加载（preload 提示，不进阻塞链）----------
       目的：KaTeX 真正被请求要等 formulas.js 的启动链（IndexedDB 读取 →
       deps.json → SW 就绪），而本脚本在 body 末尾执行、清单又已并行取回，
       可以更早把 CSS/JS 的下载提前发起，与页面后续脚本/CSS/字体加载重叠。
       触发条件：
         - 页面明确声明需要 → 在 loader.js 的 <script> 上写 data-preload="katex"
           （不能用"检测 formulas.js 标签"：本脚本执行时该标签尚未被解析）；
         - 非 file://、非 saveData、warmMode 未关；
         - 视口 ≥1080px（公式流只在这个宽度显示）；
         - vendor 与当前站点同源（跨域时 preload 与普通 <script> 的
           CORS 模式不一致，会产生"预加载未被使用"的重复请求，故跳过）；
         - KaTeX 尚未在内存中。 */
    var preloadMode = String((self && self.getAttribute('data-preload')) || '').toLowerCase();
    function wideEnough() {
        try { return !!(global.matchMedia && global.matchMedia('(min-width: 1080px)').matches); }
        catch (e) { return false; }
    }
    function saveDataOn() {
        var conn = global.navigator && global.navigator.connection;
        return !!(conn && conn.saveData);
    }

    var preloadStarted = false;
    function preloadVendor() {
        if (preloadStarted) { return; }
        preloadStarted = true;
        if (warmMode === 'off' || warmMode === 'none') { return; }
        try {
            if (!global.location || global.location.protocol === 'file:') { return; }
        } catch (e) { return; }
        if (!global.fetch || !document.head) { return; }
        if (preloadMode !== 'katex') { return; }   // 仅页面显式声明时才预载
        if (saveDataOn() || !wideEnough()) { return; }

        ready.then(function () {
            var cfg = state.manifest;
            var dep = cfg && cfg.deps && cfg.deps.katex;
            if (!dep) { return; }
            var jsUrl = depUrl(dep, dep.js);
            var cssUrl = (dep.css && dep.css[0]) ? depUrl(dep, dep.css[0]) : '';
            var sameOrigin = true;
            try { sameOrigin = new URL(jsUrl).origin === global.location.origin; }
            catch (e) { sameOrigin = true; }
            if (!sameOrigin) { log('preload skipped (cross-origin vendor)'); return; }
            if (GLOBALS.katex()) { return; }

            function add(as, url) {
                var l = document.createElement('link');
                l.rel = 'preload';
                l.as = as;
                l.href = url;
                document.head.appendChild(l);
            }
            if (cssUrl) { add('style', cssUrl); }
            add('script', jsUrl);
            log('preload katex', jsUrl);
        });
    }

    function scheduleWarm() {
        if (warmMode === 'off' || warmMode === 'none') { return; }
        function run() {
            var idle = global.requestIdleCallback;
            if (idle) { idle(function () { warm(); }, { timeout: 3000 }); }
            else { global.setTimeout(warm, 2000); }
        }
        if (document.readyState === 'complete') { run(); }
        else { global.addEventListener('load', function () { run(); }, { once: true }); }
    }

    /* ---------- 对外 API ---------- */

    var api = {
        manifestUrl: MANIFEST_URL,
        ready: ready,
        versions: { katex: null, hljs: null },
        base: '',
        source: null,
        load: load,
        katex: function () { return load('katex'); },
        hljs: function () { return load('hljs'); },
        warm: warm,
        state: function () {
            var nav = global.navigator || {};
            var m = state.manifest;
            return {
                manifestLoaded: !!m, loadError: state.loadError,
                source: m ? m.sourceName : null, base: state.base,
                versions: m ? versionsOf(m) : null,
                marker: readMarker(), markerFresh: m ? markerFresh(m) : false,
                lastWarm: state.lastWarm,
                sw: {
                    supported: sw.supported,
                    registered: sw.supported && !!(nav.serviceWorker && nav.serviceWorker.controller),
                    controlling: !!(nav.serviceWorker && nav.serviceWorker.controller)
                }
            };
        },
        swSupported: function () { return sw.supported; }
    };

    global.ZZKXS = global.ZZKXS || {};
    global.ZZKXS.deps = api;

    ready.then(function () {
        var v = versionsOf(state.manifest);
        api.versions = v;
        api.base = state.base;
        api.source = state.manifest.sourceName;
    });

    scheduleWarm();
    preloadVendor();   // 早于 formulas.js 的启动链发起 KaTeX 预加载（条件见函数注释）
})(window, document);
