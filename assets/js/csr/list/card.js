/* ============================================================
   CSR · 列表卡片渲染（纯模板，不取数）
   assets/js/csr/list/card.js
   ============================================================ */

export function escapeHtml(str) {
    return String(str == null ? '' : str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function formatDate(iso) {
    return iso ? String(iso).replace(/-/g, '.') : '';
}

/**
 * 文章卡片渲染器。
 * @param {{hrefBase: string, showAuthors?: boolean}} options
 */
export function articleCard(options) {
    const opts = Object.assign({
        hrefBase: '../news-ar/article.html#',
        showAuthors: true,
        linkText: '阅读更多 →'
    }, options || {});

    function articleHref(slug) {
        return opts.hrefBase + encodeURIComponent(slug);
    }

    function render(info, ctx) {
        const href = articleHref(info._slug);
        const thumb = info._coverUrl
            ? '<img src="' + escapeHtml(info._coverUrl) + '" alt="" loading="lazy" decoding="async">'
            : '<span class="thumb-fallback">' + escapeHtml((info.tags && info.tags[0]) || '动态') + '</span>';
        const tag = (info.tags && info.tags[0]) || info.column || '';
        const authors = ctx && typeof ctx.authorsText === 'function'
            ? ctx.authorsText(info.authors)
            : '';
        const draft = info.draft ? '<span class="post-draft">DRAFT</span>' : '';
        const important = info.important ? String(info.important) : '';
        const importantClass = important ? ' is-important' : '';
        const importantAttr = important ? ' data-important="' + escapeHtml(important) + '"' : '';
        return '' +
            '<article class="post-card list-card' + importantClass + '"' + importantAttr + '>' +
            '<a class="post-thumb" href="' + escapeHtml(href) + '" aria-label="' + escapeHtml(info.title) + '">' + thumb + '</a>' +
            '<div class="post-body">' +
            '<div class="post-meta"><span class="tag">' + escapeHtml(tag) + '</span>' +
            '<time datetime="' + escapeHtml(info.date || '') + '">' + escapeHtml(formatDate(info.date)) + '</time>' + draft + '</div>' +
            '<h3><a href="' + escapeHtml(href) + '">' + escapeHtml(info.title || '未命名文章') + '</a></h3>' +
            '<p>' + escapeHtml(info.summary || '') + '</p>' +
            '<div class="post-foot">' +
            (opts.showAuthors ? '<span class="post-authors">' + escapeHtml(authors) + '</span>' : '') +
            '<a class="post-link" href="' + escapeHtml(href) + '">' + escapeHtml(opts.linkText) + '</a>' +
            '</div></div></article>';
    }

    return { render, href: articleHref };
}

export default articleCard;
