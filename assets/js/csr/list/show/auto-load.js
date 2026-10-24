/* ============================================================
   show · auto-load：滚动到底自动分批加载
   - 一页约定只放一个（不做数量校验）
   - 不显示“加载更多”按钮
   - 首批 6 条；并行加载作者/索引/important；空闲预取下一批
   ============================================================ */

import { createStatus, showSkeletons, mountCards, setCount, renderImportant, emptyMarkup } from '../ui.js';
import { prefetchWhenIdle } from '../prefetch.js';

export function createAutoLoadList(options) {
    const opts = Object.assign({
        pageSize: 6,
        skeletons: 6,
        showImportant: false,
        rootMargin: '600px',
        prefetch: true
    }, options || {});
    const data = opts.data;
    const mount = typeof opts.mount === 'string' ? document.querySelector(opts.mount) : opts.mount;
    const importantMount = typeof opts.importantMount === 'string' ? document.querySelector(opts.importantMount) : opts.importantMount;
    const card = opts.card;
    if (!data || !mount || !card) { return null; }

    const status = createStatus(opts.statusEl || opts.status);
    const ctx = { authorsText: (list) => data.authorsText(list) };
    const sentinel = document.createElement('div');
    sentinel.className = 'list-sentinel';
    sentinel.setAttribute('aria-hidden', 'true');

    let slugs = [];
    let next = 0;
    let loading = false;
    let noMore = false;
    let observer = null;
    let userScrolled = false;

    const marginPx = (() => {
        const m = parseInt(String(opts.rootMargin || '0'), 10);
        return Number.isFinite(m) ? m : 0;
    })();

    function sentinelNear() {
        const rect = sentinel.getBoundingClientRect();
        return rect.top <= (window.innerHeight || 0) + marginPx;
    }

    function onWindowScroll() {
        if ((window.scrollY || 0) > 0) { userScrolled = true; }
        if (userScrolled && sentinelNear()) { loadBatch(); }
    }

    function placeSentinel() {
        if (mount.parentNode) { mount.parentNode.insertBefore(sentinel, mount.nextSibling); }
    }

    function renderResult(result, append) {
        mountCards(mount, result.items, card, ctx, append);
        if (!result.items.length && !append) { mount.innerHTML = emptyMarkup('暂无文章'); }
        if (result.failures.length) { console.warn('[list:auto] 部分文章加载失败', result.failures); }
    }

    function prefetchNext() {
        if (!opts.prefetch || noMore) { return; }
        prefetchWhenIdle(data, slugs.slice(next, next + opts.pageSize));
    }

    async function loadBatch() {
        if (loading || noMore) { return; }
        loading = true;
        status.set('loading');
        try {
            const batch = slugs.slice(next, next + opts.pageSize);
            const result = await data.getInfos(batch);
            next += batch.length;
            renderResult(result, next > batch.length);
            noMore = next >= slugs.length;
            setCount(opts.countEl || opts.count, slugs.length);
            status.set('');
            if (noMore && observer) { observer.disconnect(); sentinel.remove(); }
            else { prefetchNext(); }
        } catch (err) {
            console.error('[list:auto]', err);
            status.set('列表加载失败，请刷新重试');
        } finally {
            loading = false;
        }
    }

    function observe() {
        if (!('IntersectionObserver' in window)) { return; }
        observer = new IntersectionObserver((entries) => {
            /* 首屏观察器可能立即触发；必须等用户真正滚动后才加载下一批 */
            if (!userScrolled) { return; }
            if (entries.some((e) => e.isIntersecting)) { loadBatch(); }
        }, { rootMargin: opts.rootMargin });
        observer.observe(sentinel);
    }

    function bindScrollGate() {
        window.addEventListener('scroll', onWindowScroll, { passive: true });
    }

    function unbindScrollGate() {
        window.removeEventListener('scroll', onWindowScroll);
    }

    async function init() {
        showSkeletons(mount, opts.skeletons);
        status.set('loading');
        try {
            /* 作者表 + 栏目索引并行 */
            const [authors, loadedSlugs] = await Promise.all([
                data.loadAuthors(),
                data.getSlugs(opts.column)
            ]);
            void authors;
            slugs = loadedSlugs;
            setCount(opts.countEl || opts.count, slugs.length);

            /* important 与首批 info 并行；都完成后再渲染，避免首屏上下跳动 */
            const importantP = opts.showImportant
                ? renderImportant(data, opts.column, card, ctx, importantMount).catch((err) => {
                    console.warn('[list:auto] important 加载失败', err);
                })
                : Promise.resolve();
            const batch = slugs.slice(0, opts.pageSize);
            const [result] = await Promise.all([data.getInfos(batch), importantP]);

            next = batch.length;
            renderResult(result, false);
            noMore = next >= slugs.length;
            status.set('');
            placeSentinel();
            observe();
            bindScrollGate();
            prefetchNext();
        } catch (err) {
            console.error('[list:auto] init', err);
            status.set('列表加载失败，请刷新重试');
        }
    }

    init();
    return {
        loadBatch,
        destroy() {
            if (observer) { observer.disconnect(); }
            unbindScrollGate();
            sentinel.remove();
        }
    };
}

export default createAutoLoadList;
