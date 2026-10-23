/* ============================================================
   CSR · 文章列表（assets/js/csr/article/list.js）
   - 读公开配置 articles/art-idx.config → 栏目 index → 路径名数组
   - 按 index 顺序分批取 articles/<slug>/info.json，渲染卡片
   - important：读 index.important_index → 取 info → 按 info.important 值分组，
     每组生成一个列表（不去重，important 文章同时出现在时间线）
   - 加载中显示跳动小点；首屏骨架；失败降级
   ============================================================ */

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

function escapeHtml(str) {
    return String(str == null ? '' : str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatDate(iso) {
    return iso ? String(iso).replace(/-/g, '.') : '';
}

function repoPath(path) {
    return new URL('../../' + String(path || '').replace(/^\/+/, ''), location.href).href;
}

async function fetchJson(url) {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) { throw new Error(url + ' HTTP ' + res.status); }
    return res.json();
}

export function initArticleList(options) {
    const opts = Object.assign({
        mount: '#newsList',
        importantMount: '#importantList',
        moreButton: '#listMore',
        status: '#listStatus',
        count: '#listCount',
        configUrl: '../../articles/art-idx.config',
        column: '社团动态',
        articleHref: '../news-ar/article.html#',
        pageSize: 9
    }, options || {});

    const mount = document.querySelector(opts.mount);
    const importantMount = document.querySelector(opts.importantMount);
    const moreButton = document.querySelector(opts.moreButton);
    const statusEl = document.querySelector(opts.status);
    const countEl = document.querySelector(opts.count);
    if (!mount) { return null; }

    const state = {
        index: [],
        important: [],
        next: 0,
        loaded: 0,
        loading: false,
        noMore: false,
        infos: new Map(),
        authors: {},
        started: false
    };

    function setStatus(text) {
        if (!statusEl) { return; }
        if (text === 'loading') {
            statusEl.innerHTML = '加载中<span class="art-dots" aria-hidden="true"><i></i><i></i><i></i></span>';
            statusEl.hidden = false;
            return;
        }
        statusEl.textContent = text || '';
        statusEl.hidden = !text;
    }

    function showSkeletons(n) {
        const cells = [];
        for (let i = 0; i < n; i += 1) {
            cells.push(
                '<article class="post-card skeleton" aria-hidden="true">' +
                '<div class="post-thumb"></div>' +
                '<div class="post-body">' +
                '<span class="sk-line sk-meta"></span>' +
                '<span class="sk-line sk-title"></span>' +
                '<span class="sk-line sk-text"></span>' +
                '<span class="sk-line sk-short"></span>' +
                '</div></article>'
            );
        }
        mount.innerHTML = cells.join('');
    }

    function clearSkeletons() {
        if (mount.querySelector('.skeleton')) { mount.innerHTML = ''; }
    }

    function resolveAuthors(list) {
        if (!Array.isArray(list)) { return ''; }
        return list.map((item) => {
            if (typeof item === 'number') {
                const row = state.authors[String(item)];
                return (row && row.name) || ('uid:' + item);
            }
            return String(item);
        }).filter(Boolean).join('、');
    }

    function articleHref(slug) {
        return opts.articleHref + encodeURIComponent(slug);
    }

    async function getInfo(slug) {
        if (state.infos.has(slug)) { return state.infos.get(slug); }
        if (!SLUG_RE.test(slug)) { return null; }
        const base = new URL('../../articles/' + slug + '/', location.href);
        const info = await fetchJson(new URL('info.json', base).href);
        info._slug = slug;
        info._coverUrl = info.cover ? new URL(info.cover, base).href : '';
        state.infos.set(slug, info);
        return info;
    }

    async function getInfos(slugs) {
        const results = await Promise.allSettled(slugs.map(getInfo));
        const infos = [];
        results.forEach((r) => {
            if (r.status === 'fulfilled' && r.value) { infos.push(r.value); }
        });
        return infos;
    }

    function cardHtml(info) {
        const href = articleHref(info._slug);
        const thumb = info._coverUrl
            ? '<img src="' + escapeHtml(info._coverUrl) + '" alt="" loading="lazy" decoding="async">'
            : '<span class="thumb-fallback">' + escapeHtml((info.tags && info.tags[0]) || '动态') + '</span>';
        const tag = (info.tags && info.tags[0]) || info.column || '';
        const authors = resolveAuthors(info.authors);
        const draft = info.draft ? '<span class="post-draft">DRAFT</span>' : '';
        return '' +
            '<article class="post-card list-card">' +
            '<a class="post-thumb" href="' + escapeHtml(href) + '" aria-label="' + escapeHtml(info.title) + '">' + thumb + '</a>' +
            '<div class="post-body">' +
            '<div class="post-meta"><span class="tag">' + escapeHtml(tag) + '</span>' +
            '<time datetime="' + escapeHtml(info.date || '') + '">' + escapeHtml(formatDate(info.date)) + '</time>' + draft + '</div>' +
            '<h3><a href="' + escapeHtml(href) + '">' + escapeHtml(info.title || '未命名文章') + '</a></h3>' +
            '<p>' + escapeHtml(info.summary || '') + '</p>' +
            '<div class="post-foot">' +
            '<span class="post-authors">' + escapeHtml(authors) + '</span>' +
            '<a class="post-link" href="' + escapeHtml(href) + '">阅读更多 →</a>' +
            '</div></div></article>';
    }

    function updateCount() {
        if (countEl) {
            const total = state.index.length;
            countEl.textContent = total ? '共 ' + total + ' 篇' : '';
        }
    }

    async function renderImportant() {
        if (!importantMount || !state.important.length) { return; }
        const infos = await getInfos(state.important);
        const groups = new Map();
        infos.forEach((info) => {
            const key = String(info.important || '').trim();
            if (!key) { return; }
            if (!groups.has(key)) { groups.set(key, []); }
            groups.get(key).push(info);
        });
        if (!groups.size) { return; }
        const html = [];
        groups.forEach((items, key) => {
            html.push(
                '<section class="important-block">' +
                '<div class="important-head"><span class="important-kicker">重要</span>' +
                '<h2 class="important-title">' + escapeHtml(key) + '</h2></div>' +
                '<div class="card-grid important-grid">' + items.map(cardHtml).join('') + '</div>' +
                '</section>'
            );
        });
        importantMount.innerHTML = html.join('');
    }

    async function loadBatch() {
        if (state.loading || state.noMore) { return; }
        state.loading = true;
        if (moreButton) { moreButton.hidden = true; }
        setStatus('loading');
        try {
            const batch = state.index.slice(state.next, state.next + opts.pageSize);
            state.next += batch.length;
            const infos = await getInfos(batch);
            clearSkeletons();
            if (!infos.length && !state.started) {
                mount.innerHTML = '<p class="placeholder-note">暂无文章</p>';
            } else {
                mount.insertAdjacentHTML('beforeend', infos.map(cardHtml).join(''));
            }
            state.loaded += infos.length;
            state.started = true;
            state.noMore = state.next >= state.index.length;
            updateCount();
            if (state.noMore) {
                setStatus(state.loaded ? '' : '暂无文章');
            } else {
                setStatus('');
                if (moreButton) { moreButton.hidden = false; }
            }
        } catch (err) {
            console.error('[article-list]', err);
            setStatus('列表加载失败，请刷新重试');
        } finally {
            state.loading = false;
        }
    }

    function initAutoLoad() {
        if (!('IntersectionObserver' in window) || !moreButton) { return; }
        const io = new IntersectionObserver((entries) => {
            if (entries.some((e) => e.isIntersecting) && !state.loading && !state.noMore && state.started) {
                loadBatch();
            }
        }, { rootMargin: '240px 0px' });
        io.observe(moreButton);
    }

    async function init() {
        showSkeletons(3);
        setStatus('loading');
        try {
            const cfg = await fetchJson(opts.configUrl);
            const indexPath = cfg && cfg.columns && cfg.columns[opts.column];
            if (!indexPath) { throw new Error('config 中缺少栏目：' + opts.column); }
            const [index, authors] = await Promise.all([
                fetchJson(repoPath(indexPath)),
                fetchJson(repoPath('assets/data/author-uids.json')).catch(() => ({}))
            ]);
            state.index = Array.isArray(index.articles) ? index.articles : [];
            state.authors = authors || {};
            updateCount();
            if (state.index.length) {
                state.important = index.important_index
                    ? ((await fetchJson(repoPath(index.important_index))).articles || [])
                    : [];
                await renderImportant();
            }
            await loadBatch();
            initAutoLoad();
        } catch (err) {
            console.error('[article-list]', err);
            clearSkeletons();
            setStatus('列表加载失败，请刷新重试');
        }
    }

    if (moreButton) {
        moreButton.addEventListener('click', () => loadBatch());
    }
    init();
    return { loadBatch };
}

export default initArticleList;
