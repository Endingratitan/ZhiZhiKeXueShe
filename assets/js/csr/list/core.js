/* ============================================================
   CSR · 列表数据核心（纯数据，不碰 DOM）
   assets/js/csr/list/core.js

   职责：
   - 读公开配置 articles/art-idx.config
   - 读栏目 index（只含路径名）与 important index
   - 查 slug / 批量取 articles/<slug>/info.json
   - 作者 uid 表与缓存
   - 不做加载状态、不做 HTML、不做分页状态

   用法：
     const data = createArticleData({ rootUrl: '../../' });
     await data.loadAuthors();
     const slugs = await data.getSlugs('社团动态');
     const { items, failures } = await data.getInfos(slugs.slice(0, 9));
   ============================================================ */

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

export class ListDataError extends Error {
    constructor(message, url) {
        super(message);
        this.name = 'ListDataError';
        this.url = url || '';
    }
}

export function createArticleData(options) {
    const opts = options || {};
    const baseUrl = opts.baseUrl || (typeof location !== 'undefined'
        ? new URL(opts.rootUrl || '../../', location.href).href
        : 'http://localhost/');
    const base = baseUrl.replace(/\/?$/, '/');
    const fetchImpl = opts.fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);

    const configPromise = { value: null };
    const columns = new Map();        // column -> { promise, index }
    const importantColumns = new Map(); // column -> { promise, data }
    const infoCache = new Map();      // slug -> { promise, info }
    const authorsState = { promise: null, data: {} };

    function resolve(path) {
        return new URL(String(path || '').replace(/^\/+/, ''), base).href;
    }

    async function fetchJson(url) {
        if (!fetchImpl) { throw new ListDataError('当前环境没有 fetch', url); }
        let res;
        try {
            res = await fetchImpl(url, { cache: 'no-cache' });
        } catch (err) {
            throw new ListDataError('网络请求失败：' + err.message, url);
        }
        if (!res.ok) { throw new ListDataError(url + ' HTTP ' + res.status, url); }
        try {
            return await res.json();
        } catch (err) {
            throw new ListDataError(url + ' 不是合法 JSON', url);
        }
    }

    function loadConfig() {
        if (configPromise.value) { return configPromise.value; }
        configPromise.value = fetchJson(resolve('articles/art-idx.config')).then((cfg) => {
            if (!cfg || !cfg.columns || typeof cfg.columns !== 'object') {
                throw new ListDataError('articles/art-idx.config 缺少 columns', resolve('articles/art-idx.config'));
            }
            return cfg;
        });
        return configPromise.value;
    }

    async function getColumns() {
        const cfg = await loadConfig();
        return Object.keys(cfg.columns);
    }

    function columnIndexUrl(column) {
        return loadConfig().then((cfg) => {
            const rel = cfg.columns[column];
            if (!rel) { throw new ListDataError('未配置栏目：' + column); }
            return resolve(rel);
        });
    }

    function loadColumn(column) {
        if (columns.has(column)) { return columns.get(column).promise; }
        const state = { index: null, promise: null };
        state.promise = columnIndexUrl(column)
            .then((url) => fetchJson(url))
            .then((index) => { state.index = index; return index; });
        columns.set(column, state);
        return state.promise;
    }

    async function getSlugs(column) {
        const index = await loadColumn(column);
        return Array.isArray(index.articles) ? index.articles.slice() : [];
    }

    async function getImportantSlugs(column) {
        if (importantColumns.has(column)) { return importantColumns.get(column).promise; }
        const state = { promise: null, data: null };
        state.promise = (async () => {
            const index = await loadColumn(column);
            if (!index.important_index) { return []; }
            const data = await fetchJson(resolve(index.important_index));
            state.data = data;
            return Array.isArray(data.articles) ? data.articles.slice() : [];
        })();
        importantColumns.set(column, state);
        return state.promise;
    }

    async function getTotal(column) {
        return (await getSlugs(column)).length;
    }

    function normalizeInfo(slug, info) {
        const dir = new URL('articles/' + slug + '/', base).href;
        info._slug = slug;
        info._coverUrl = info.cover ? new URL(info.cover, dir).href : '';
        return info;
    }

    async function getInfo(slug) {
        if (!SLUG_RE.test(slug)) {
            throw new ListDataError('非法 slug：' + slug);
        }
        if (infoCache.has(slug)) { return infoCache.get(slug).promise; }
        const state = { promise: null, info: null };
        state.promise = fetchJson(resolve('articles/' + slug + '/info.json'))
            .then((info) => {
                state.info = normalizeInfo(slug, info);
                return state.info;
            });
        infoCache.set(slug, state);
        return state.promise;
    }

    /** 批量取 info：保序、单篇失败不阻塞；返回成功项与失败项 */
    async function getInfos(slugs) {
        const results = await Promise.allSettled((slugs || []).map((slug) => getInfo(slug)));
        const items = [];
        const failures = [];
        results.forEach((r, i) => {
            if (r.status === 'fulfilled') { items.push(r.value); }
            else { failures.push({ slug: slugs[i], error: r.reason }); }
        });
        return { items, failures };
    }

    async function loadAuthors() {
        if (authorsState.promise) { return authorsState.promise; }
        authorsState.promise = fetchJson(resolve('assets/data/author-uids.json'))
            .then((data) => { authorsState.data = data || {}; return authorsState.data; })
            .catch(() => { authorsState.data = {}; return authorsState.data; });
        return authorsState.promise;
    }

    /** 作者字段 → 显示文本（loadAuthors 后同步可用） */
    function authorsText(list) {
        if (!Array.isArray(list)) { return ''; }
        return list.map((item) => {
            if (typeof item === 'number') {
                const row = authorsState.data[String(item)];
                return (row && row.name) || ('uid:' + item);
            }
            return String(item || '');
        }).filter(Boolean).join('、');
    }

    /**
     * 跨栏目查 slug：返回 { slug, column, position, important } 或 null。
     * 只查 config 中声明的栏目。
     */
    async function findSlug(slug) {
        if (!SLUG_RE.test(slug)) { return null; }
        const cols = await getColumns();
        for (const column of cols) {
            const slugs = await getSlugs(column);
            const pos = slugs.indexOf(slug);
            if (pos >= 0) {
                return { slug, column, position: pos, important: false };
            }
            const important = await getImportantSlugs(column);
            if (important.indexOf(slug) >= 0) {
                return { slug, column, position: -1, important: true };
            }
        }
        return null;
    }

    return {
        base,
        resolve,
        loadConfig,
        getColumns,
        loadColumn,
        getSlugs,
        getImportantSlugs,
        getTotal,
        getInfo,
        getInfos,
        loadAuthors,
        authorsText,
        findSlug
    };
}

export default createArticleData;
