/* ============================================================
   show · paged：1、2、3… 数字页码跳转
   - showImportant 仅布尔开关；important 只在初始化时渲染一次
   - 多实例用不同 pageParam 区分 URL 参数；不做冲突检查
   - scrollTarget: 'list-top' | 'list-bottom'
   - 首批 6 条；空闲预取下一页 info
   ============================================================ */

import { createStatus, showSkeletons, mountCards, setCount, renderImportant, emptyMarkup } from '../ui.js';
import { prefetchWhenIdle } from '../prefetch.js';

export function createPagedList(options) {
    const opts = Object.assign({
        pageSize: 3,
        skeletons: 3,
        showImportant: false,
        pageParam: 'page',
        scrollTarget: 'list-top',
        scrollOffset: 112,
        prefetch: true
    }, options || {});
    const data = opts.data;
    const mount = typeof opts.mount === 'string' ? document.querySelector(opts.mount) : opts.mount;
    const pagerMount = typeof opts.pagerMount === 'string' ? document.querySelector(opts.pagerMount) : opts.pagerMount;
    const importantMount = typeof opts.importantMount === 'string' ? document.querySelector(opts.importantMount) : opts.importantMount;
    const card = opts.card;
    if (!data || !mount || !card) { return null; }

    const status = createStatus(opts.statusEl || opts.status);
    const ctx = { authorsText: (list) => data.authorsText(list) };
    let slugs = [];
    let total = 0;
    let pages = 1;
    let current = 1;
    let loading = false;

    function readPage() {
        try {
            const params = new URLSearchParams(location.search);
            const n = parseInt(params.get(opts.pageParam) || '1', 10);
            return Number.isFinite(n) && n > 0 ? n : 1;
        } catch (e) {
            return 1;
        }
    }

    function writePage(page) {
        try {
            const url = new URL(location.href);
            url.searchParams.set(opts.pageParam, String(page));
            history.replaceState(null, '', url.href);
        } catch (e) { /* 忽略 */ }
    }

    function scrollToList() {
        if (typeof window.scrollTo !== 'function') { return; }
        const target = opts.scrollTarget === 'list-bottom' ? (pagerMount || mount) : mount;
        const rect = target.getBoundingClientRect();
        let top;
        if (opts.scrollTarget === 'list-bottom') {
            top = window.scrollY + rect.top + rect.height - window.innerHeight + 24;
        } else {
            top = window.scrollY + rect.top - (opts.scrollOffset || 0);
        }
        window.scrollTo({ top: Math.max(0, Math.round(top)), behavior: 'smooth' });
    }

    function renderPager() {
        if (!pagerMount) { return; }
        if (pages <= 1) { pagerMount.innerHTML = ''; return; }
        const parts = ['<nav class="list-pager" aria-label="分页">'];
        parts.push('<button type="button" class="list-page list-page-prev" data-page="' + (current - 1) + '"' +
            (current <= 1 || loading ? ' disabled' : '') + ' aria-label="上一页">←</button>');
        for (let i = 1; i <= pages; i += 1) {
            parts.push('<button type="button" class="list-page' + (i === current ? ' is-current' : '') + '" data-page="' + i + '"' +
                (loading ? ' disabled' : '') +
                (i === current ? ' aria-current="page"' : '') + '>' + i + '</button>');
        }
        parts.push('<button type="button" class="list-page list-page-next" data-page="' + (current + 1) + '"' +
            (current >= pages || loading ? ' disabled' : '') + ' aria-label="下一页">→</button>');
        parts.push('</nav>');
        pagerMount.innerHTML = parts.join('');
    }

    function prefetchPage(page) {
        if (!opts.prefetch || page < 1 || page > pages) { return; }
        const batch = slugs.slice((page - 1) * opts.pageSize, page * opts.pageSize);
        prefetchWhenIdle(data, batch);
    }

    function batchSlugs(page) {
        return slugs.slice((page - 1) * opts.pageSize, page * opts.pageSize);
    }

    function renderResult(result, page, doScroll) {
        mountCards(mount, result.items, card, ctx, false);
        if (!result.items.length) { mount.innerHTML = emptyMarkup('暂无文章'); }
        if (result.failures.length) { console.warn('[list:paged] 部分文章加载失败', result.failures); }
        current = page;
        setCount(opts.countEl || opts.count, total);
        writePage(page);
        status.set('');
        if (doScroll) { scrollToList(); }
        prefetchPage(page + 1);
    }

    async function renderPage(page, doScroll) {
        if (loading || page < 1 || page > pages) { return; }
        loading = true;
        status.set('loading');
        showSkeletons(mount, opts.skeletons);
        renderPager();
        try {
            const result = await data.getInfos(batchSlugs(page));
            renderResult(result, page, doScroll);
        } catch (err) {
            console.error('[list:paged]', err);
            status.set('列表加载失败，请刷新重试');
        } finally {
            loading = false;
            renderPager();
        }
    }

    async function init() {
        showSkeletons(mount, opts.skeletons);
        status.set('loading');
        renderPager();
        try {
            const [authors, loadedSlugs] = await Promise.all([
                data.loadAuthors(),
                data.getSlugs(opts.column)
            ]);
            void authors;
            slugs = loadedSlugs;
            total = slugs.length;
            pages = Math.max(1, Math.ceil(total / opts.pageSize));
            current = Math.min(Math.max(1, readPage()), pages);
            setCount(opts.countEl || opts.count, total);

            /* important 与当前页 info 并行，完成后一起渲染 */
            const importantP = opts.showImportant
                ? renderImportant(data, opts.column, card, ctx, importantMount).catch((err) => {
                    console.warn('[list:paged] important 加载失败', err);
                })
                : Promise.resolve();
            const [result] = await Promise.all([data.getInfos(batchSlugs(current)), importantP]);
            renderResult(result, current, false);
        } catch (err) {
            console.error('[list:paged] init', err);
            status.set('列表加载失败，请刷新重试');
        } finally {
            loading = false;
            renderPager();
        }
    }

    if (pagerMount) {
        pagerMount.addEventListener('click', (e) => {
            const btn = e.target.closest ? e.target.closest('.list-page') : null;
            if (!btn || btn.disabled) { return; }
            const page = Number(btn.dataset.page);
            if (!Number.isFinite(page) || page < 1 || page > pages || page === current) { return; }
            renderPage(page, true);
        });
    }

    init();
    return {
        goTo(page) { return renderPage(page, true); }
    };
}

export default createPagedList;
