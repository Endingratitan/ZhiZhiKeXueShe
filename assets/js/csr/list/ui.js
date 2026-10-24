/* ============================================================
   CSR · 列表 UI 小工具（加载状态/骨架/important 区/计数）
   assets/js/csr/list/ui.js
   ============================================================ */

import { escapeHtml } from './card.js';

export function createStatus(el) {
    const node = typeof el === 'string' ? document.querySelector(el) : el;
    return {
        node,
        set(text) {
            if (!node) { return; }
            if (text === 'loading') {
                node.innerHTML = '加载中<span class="art-dots" aria-hidden="true"><i></i><i></i><i></i></span>';
                node.hidden = false;
                return;
            }
            node.textContent = text || '';
            node.hidden = !text;
        }
    };
}

export function skeletonCard() {
    return '<article class="post-card skeleton" aria-hidden="true">' +
        '<div class="post-thumb"></div>' +
        '<div class="post-body">' +
        '<span class="sk-line sk-meta"></span>' +
        '<span class="sk-line sk-title"></span>' +
        '<span class="sk-line sk-text"></span>' +
        '<span class="sk-line sk-short"></span>' +
        '</div></article>';
}

export function showSkeletons(mount, n) {
    if (!mount) { return; }
    mount.innerHTML = Array.from({ length: n || 3 }).map(() => skeletonCard()).join('');
}

export function clearSkeletons(mount) {
    if (mount && mount.querySelector('.skeleton')) { mount.innerHTML = ''; }
}

export function mountCards(mount, items, card, ctx, append) {
    if (!mount) { return; }
    const html = items.map((item) => card.render(item, ctx)).join('');
    if (append) { mount.insertAdjacentHTML('beforeend', html); }
    else { mount.innerHTML = html; }
}

export function setCount(el, total) {
    const node = typeof el === 'string' ? document.querySelector(el) : el;
    if (node) { node.textContent = total ? '共 ' + total + ' 篇' : ''; }
}

/**
 * 渲染 important 区（调用方用 showImportant 决定是否调用）。
 * @returns {Promise<Array>} 分组结果，便于调试
 */
export async function renderImportant(data, column, card, ctx, mount) {
    if (!mount) { return []; }
    const slugs = await data.getImportantSlugs(column);
    if (!slugs.length) { mount.innerHTML = ''; return []; }
    const { items } = await data.getInfos(slugs);
    const groups = new Map();
    items.forEach((info) => {
        const key = String(info.important || '').trim();
        if (!key) { return; }
        if (!groups.has(key)) { groups.set(key, []); }
        groups.get(key).push(info);
    });
    const html = [];
    groups.forEach((list, key) => {
        html.push(
            '<section class="important-block" data-important-group="' + escapeHtml(key) + '">' +
            '<div class="important-head"><span class="important-kicker">重要</span>' +
            '<h2 class="important-title">' + escapeHtml(key) + '</h2></div>' +
            '<div class="card-grid important-grid">' + list.map((info) => card.render(info, ctx)).join('') + '</div>' +
            '</section>'
        );
    });
    mount.innerHTML = html.join('');
    return Array.from(groups.entries());
}

export function emptyMarkup(text) {
    return '<p class="placeholder-note">' + escapeHtml(text || '暂无文章') + '</p>';
}
