/* ============================================================
   致知科学社 · 公式数据存储层（formular-store）
   ------------------------------------------------------------
   【职责】
   为公式数据提供「容量更大、写入不阻塞主线程」的持久化：
   优先使用 IndexedDB；不可用时自动退回 localStorage，
   保证任何环境下的行为与升级前一致（渐进增强）。

   【对外接口】window.ZZKXS.formular.store
   - get(key)         → Promise<any|null>   读取；失败/不存在均为 null
   - set(key, value)  → Promise<boolean>    写入；成功 true，失败 false
   - remove(key)      → Promise<boolean>    删除
   - backend()        → 'indexeddb' | 'localstorage'（当前实际使用）
   - ready            → Promise<boolean>    true = 使用 IndexedDB

   【数据组织】
   - IndexedDB：数据库 zzkxs-formular，对象仓库 kv（键 → 结构化对象）
   - 由于 IDB 采用结构化克隆，公式对象可直接存取，无需 JSON 序列化，
     大数组读写更快、更省内存；localStorage 兜底时仍走 JSON 编解码。

   【旧数据迁移（一次性、按需）】
   读取某个键时，若 IDB 中不存在而 localStorage 中存在同名旧值，
   则把旧值搬到 IDB 并删除 localStorage 中的旧键——用户无需任何操作，
   历史编辑不会丢失。

   【降级与容错】
   - 无 IndexedDB / 打开失败 / 被隐私模式阻止 / 打开超时 → 退回 localStorage；
   - 所有对外方法都不抛异常：读失败给 null、写失败给 false，
     调用方据此提示用户，而不是让页面崩掉。
   ============================================================ */
(function () {
    'use strict';

    var DB_NAME = 'zzkxs-formular';
    var STORE_NAME = 'kv';
    var DB_VERSION = 1;
    var OPEN_TIMEOUT = 1500;   // IndexedDB 打开超时（毫秒）→ 超时按不可用处理

    var dbPromise = null;
    var backend = 'localstorage';   // 保守初值，open 成功后改为 indexeddb

    /* ---------- localStorage 兜底实现（JSON 编解码） ---------- */
    function lsGet(key) {
        try {
            var s = localStorage.getItem(key);
            return s ? JSON.parse(s) : null;
        } catch (e) { return null; }
    }
    function lsSet(key, value) {
        try { localStorage.setItem(key, JSON.stringify(value)); return true; }
        catch (e) { return false; }   // 配额不足 / 隐私模式
    }
    function lsRemove(key) {
        try { localStorage.removeItem(key); return true; }
        catch (e) { return false; }
    }

    /* ---------- IndexedDB 打开 ---------- */
    function openDB() {
        if (dbPromise) { return dbPromise; }
        dbPromise = new Promise(function (resolve, reject) {
            var req;
            try {
                if (typeof indexedDB === 'undefined' || !indexedDB.open) { reject(new Error('no indexeddb')); return; }
                req = indexedDB.open(DB_NAME, DB_VERSION);
            } catch (e) { reject(e); return; }

            req.onupgradeneeded = function () {
                var db = req.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) { db.createObjectStore(STORE_NAME); }
            };
            req.onsuccess = function () { resolve(req.result); };
            req.onerror = function () { reject(req.error || new Error('open failed')); };
            req.onblocked = function () { reject(new Error('blocked')); };   // 旧版本页面占着连接
        });
        return dbPromise;
    }

    /* ---------- IndexedDB 就绪状态 ----------
       idbReadyP：真实可用性（打开成功 true / 失败 false），一旦就绪长期有效。
       readyWithin()：单次操作的就绪等待，带超时保护——
         个别隐私模式下 IDB 会长时间挂起，不能让首屏渲染一直等；
         超时则"本次操作"先用 localStorage 顶上，但**不永久降级**：
         IDB 稍后就绪后，后续读写自动切回 IndexedDB，
         期间写入 localStorage 的数据会由迁移逻辑搬到 IDB。 */
    var idbReadyP = openDB().then(function () {
        backend = 'indexeddb';
        return true;
    }, function () {
        backend = 'localstorage';
        return false;
    });

    function readyWithin() {
        return Promise.race([idbReadyP, new Promise(function (resolve) {
            setTimeout(function () { resolve('timeout'); }, OPEN_TIMEOUT);
        })]);
    }

    var ready = idbReadyP;

    function idbGet(key) {
        return openDB().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(STORE_NAME, 'readonly');
                var r = tx.objectStore(STORE_NAME).get(key);
                r.onsuccess = function () { resolve(r.result === undefined ? null : r.result); };
                r.onerror = function () { reject(r.error); };
            });
        });
    }

    function idbSet(key, value) {
        return openDB().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(STORE_NAME, 'readwrite');
                tx.objectStore(STORE_NAME).put(value, key);
                tx.oncomplete = function () { resolve(true); };
                tx.onerror = function () { reject(tx.error); };
                tx.onabort = function () { reject(tx.error || new Error('aborted')); };
            });
        });
    }

    function idbRemove(key) {
        return openDB().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(STORE_NAME, 'readwrite');
                tx.objectStore(STORE_NAME).delete(key);
                tx.oncomplete = function () { resolve(true); };
                tx.onerror = function () { reject(tx.error); };
            });
        });
    }

    /* ---------- 对外：读（含旧数据迁移） ---------- */
    function get(key) {
        return readyWithin().then(function (state) {
            if (state !== true) { return lsGet(key); }   // IDB 不可用或本次超时 → localStorage
            return idbGet(key).then(function (val) {
                if (val !== null && val !== undefined) { return val; }
                /* IDB 无值 → 尝试把 localStorage 里的旧数据搬过来 */
                var legacy = lsGet(key);
                if (legacy === null) { return null; }
                return idbSet(key, legacy).then(function () {
                    lsRemove(key);          // 迁移成功后清掉旧键，避免两份数据
                    return legacy;
                }, function () { return legacy; });
            }).catch(function () { return lsGet(key); });
        });
    }

    /* ---------- 对外：写 ---------- */
    function set(key, value) {
        return readyWithin().then(function (state) {
            if (state !== true) { return lsSet(key, value); }
            return idbSet(key, value).catch(function () { return lsSet(key, value); });
        });
    }

    /* ---------- 对外：删 ---------- */
    function remove(key) {
        return readyWithin().then(function (state) {
            var legacy = lsRemove(key);     // 两处都清，避免残留导致读到旧值
            if (state !== true) { return legacy; }
            return idbRemove(key).then(function () { return true; },
                                      function () { return legacy; });
        });
    }

    /* ---------- 注册到统一命名空间 ---------- */
    window.ZZKXS = window.ZZKXS || {};
    window.ZZKXS.formular = window.ZZKXS.formular || {};
    window.ZZKXS.formular.store = {
        get: get,
        set: set,
        remove: remove,
        backend: function () { return backend; },
        ready: ready
    };
})();
