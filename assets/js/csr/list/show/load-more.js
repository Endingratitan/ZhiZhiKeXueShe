/* ============================================================
   show · load-more：点击按钮分批加载
   - 可同页多个实例，各自独立按钮/状态
   - 首批 6 条；并行加载作者/索引/important；空闲预取下一批
   ============================================================ */

import { createStatus, showSkeletons, mountCards, setCount, renderImportant, emptyMarkup } from '../ui.js';
import { prefetchWhenIdle } from '../prefetch.js';

export function createLoadMoreList(options) {
    const opts = Object.assign({
        pageSize: 6,
        skeletons: 6,
        showImportant: false,
        prefetch: true,
        moreText: '加载更多',
        loadingText: '加载中…',
        doneText: '已加载全部'
    }, options || {});
    const data = opts.data;
    const mount = typeof opts.mount === 'string' ? document.querySelector(opts.mount) : opts.mount;
    const importantMount = typeof opts.importantMount === 'string' ? document.querySelector(opts.importantMount) : opts.importantMount;
    const button = typeof opts.button === 'string' ? document.querySelector(opts.button) : opts.button;
    const card = opts.card;
    if (!data || !mount || !card) { return null; }

    const status = createStatus(opts.statusEl || opts.status);
    const ctx = { authorsText: (list) => data.authorsText(list) };
    let slugs = [];
    let next = 0;
    let loading = false;
    let noMore = false;

    function syncButton() {
        if (!button) { return; }
        button.hidden = false;
        button.disabled = loading || noMore;
        button.textContent = loading ? opts.loadingText : (noMore ? opts.doneText : opts.moreText);
    }

    function prefetchNext() {
        if (!opts.prefetch || noMore) { return; }
        prefetchWhenIdle(data, slugs.slice(next, next + opts.pageSize));
    }

    async function loadBatch() {
        if (loading || noMore) { return; }
        loading = true;
        status.set('loading');
        syncButton();
        try {
            const batch = slugs.slice(next, next + opts.pageSize);
            const result = await data.getInfos(batch);
            const append = next > 0;
            next += batch.length;
            mountCards(mount, result.items, card, ctx, append);
            if (!result.items.length && !append) { mount.innerHTML = emptyMarkup('暂无文章'); }
            if (result.failures.length) { console.warn('[list:more] 部分文章加载失败', result.failures); }
            noMore = next >= slugs.length;
            setCount(opts.countEl || opts.count, slugs.length);
            status.set('');
            syncButton();
            prefetchNext();
        } catch (err) {
            console.error('[list:more]', err);
            status.set('列表加载失败，请刷新重试');
        } finally {
            loading = false;
            syncButton();
        }
    }

    async function init() {
        showSkeletons(mount, opts.skeletons);
        status.set('loading');
        if (button) { button.hidden = true; }
        try {
            const [authors, loadedSlugs] = await Promise.all([
                data.loadAuthors(),
                data.getSlugs(opts.column)
            ]);
            void authors;
            slugs = loadedSlugs;
            setCount(opts.countEl || opts.count, slugs.length);

            const importantP = opts.showImportant
                ? renderImportant(data, opts.column, card, ctx, importantMount).catch((err) => {
                    console.warn('[list:more] important 加载失败', err);
                })
                : Promise.resolve();
            const batch = slugs.slice(0, opts.pageSize);
            const [result] = await Promise.all([data.getInfos(batch), importantP]);

            next = batch.length;
            mountCards(mount, result.items, card, ctx, false);
            if (!result.items.length) { mount.innerHTML = emptyMarkup('暂无文章'); }
            if (result.failures.length) { console.warn('[list:more] 部分文章加载失败', result.failures); }
            noMore = next >= slugs.length;
            setCount(opts.countEl || opts.count, slugs.length);
            status.set('');
            syncButton();
            prefetchNext();
        } catch (err) {
            console.error('[list:more] init', err);
            status.set('列表加载失败，请刷新重试');
        }
    }

    if (button) { button.addEventListener('click', loadBatch); }
    init();
    return { loadBatch };
}

export default createLoadMoreList;
