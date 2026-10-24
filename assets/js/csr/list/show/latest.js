/* ============================================================
   show · latest：固定展示最新 N 条
   - source: 'column'（栏目最新）| 'important'（important 区）
   - 无加载更多 / 无页码
   ============================================================ */

import { mountCards, setCount, renderImportant, emptyMarkup, showSkeletons, clearSkeletons, createStatus } from '../ui.js';

export function createLatestList(options) {
    const opts = Object.assign({
        limit: 3,
        source: 'column',
        showImportant: false,
        skeletons: 0,
        moreHref: '',
        moreLabel: '查看全部 →'
    }, options || {});
    const data = opts.data;
    const mount = typeof opts.mount === 'string' ? document.querySelector(opts.mount) : opts.mount;
    const importantMount = typeof opts.importantMount === 'string' ? document.querySelector(opts.importantMount) : opts.importantMount;
    const card = opts.card;
    if (!data || !mount || !card) { return null; }

    const ctx = { authorsText: (list) => data.authorsText(list) };
    const status = createStatus(opts.statusEl || opts.status);

    async function init() {
        const skeletons = opts.skeletons || opts.limit;
        showSkeletons(mount, skeletons);
        if (status) { status.set('loading'); }
        try {
            await data.loadAuthors();
            if (opts.showImportant) {
                await renderImportant(data, opts.column, card, ctx, importantMount);
            }
            const all = opts.source === 'important'
                ? await data.getImportantSlugs(opts.column)
                : await data.getSlugs(opts.column);
            const slugs = all.slice(0, opts.limit);
            const { items, failures } = await data.getInfos(slugs);
            clearSkeletons(mount);
            if (!items.length) { mount.innerHTML = emptyMarkup('暂无文章'); status.set(''); return; }
            mountCards(mount, items, card, ctx, false);
            status.set('');
            if (failures.length) { console.warn('[list:latest] 部分文章加载失败', failures); }
            setCount(opts.countEl || opts.count, items.length);
            if (opts.moreHref) {
                const more = document.createElement('a');
                more.className = 'list-more-link';
                more.href = opts.moreHref;
                more.textContent = opts.moreLabel;
                mount.insertAdjacentElement('afterend', more);
            }
        } catch (err) {
            console.error('[list:latest]', err);
            clearSkeletons(mount);
            mount.innerHTML = emptyMarkup('列表加载失败，请刷新重试');
            status.set('');
        }
    }

    init();
    return {};
}

export default createLatestList;
