/* ============================================================
   CSR-MD · Token → HTML（DOM-free，唯一 HTML 输出层）
   类名统一 `art-*`；所有文本/属性转义；URL 已在解析层白名单校验。
   数学/代码不在这一层执行：
     - 数学输出 <span class="art-math" data-display>TeX</span>，页面层用 KaTeX 增强
     - 代码输出 <pre class="art-code" data-lang><code class="language-*">，交给代码渲染器
   ============================================================ */

import { escapeHtml, isExternalUrl, inlinesToText, resolveUrl, FNREF_MARK, FNDEF_MARK, MARK_END } from './utils.js';
import { labelFor } from './callouts.js';

export function renderHtml(blocks, ctx) {
    return (blocks || []).map((b) => renderBlock(b, ctx)).join('\n');
}

export function renderInlines(tokens, ctx) {
    return (tokens || []).map((t) => renderInline(t, ctx)).join('');
}

function renderInline(t, ctx) {
    switch (t.type) {
        case 'text': return escapeHtml(t.text);
        case 'code': return '<code class="art-code-inline">' + escapeHtml(t.text) + '</code>';
        case 'em': return '<em>' + renderInlines(t.children, ctx) + '</em>';
        case 'strong': return '<strong>' + renderInlines(t.children, ctx) + '</strong>';
        case 'del': return '<del>' + renderInlines(t.children, ctx) + '</del>';
        case 'kbd': return '<kbd class="art-kbd">' + escapeHtml(t.text) + '</kbd>';
        case 'break': return '<br>';
        case 'math': return mathSpan(t.tex, t.display, t.delim);
        case 'link': return renderLink(t, ctx);
        case 'image': return renderImage(t, ctx);
        case 'fnref': return FNREF_MARK + t.seq + MARK_END;
        default: return escapeHtml(t.text || '');
    }
}

function renderLink(t, ctx) {
    const href = resolveUrl(t.href, ctx && ctx.options.baseUrl);
    const attrs = ['href="' + escapeHtml(href) + '"'];
    if (t.title) { attrs.push('title="' + escapeHtml(t.title) + '"'); }
    if (!t.autolink && isExternalUrl(href)) {
        attrs.push('target="_blank"', 'rel="noopener noreferrer"');
    }
    return '<a ' + attrs.join(' ') + '>' + renderInlines(t.children, ctx) + '</a>';
}

function renderImage(t, ctx) {
    const src = resolveUrl(t.src, ctx && ctx.options.baseUrl);
    const attrs = [
        'class="art-img"',
        'src="' + escapeHtml(src) + '"',
        'alt="' + escapeHtml(t.alt || '') + '"',
        'loading="lazy"',
        'decoding="async"'
    ];
    if (t.title) { attrs.push('title="' + escapeHtml(t.title) + '"'); }
    return '<img ' + attrs.join(' ') + '>';
}

/** 数学占位：文本内容 = TeX 源码（KaTeX 未加载时作为降级显示） */
function mathSpan(tex, display, delim) {
    return '<span class="art-math" data-display="' + (display ? '1' : '0') + '"'
        + (delim ? ' data-delim="' + escapeHtml(delim) + '"' : '')
        + '>' + escapeHtml(tex) + '</span>';
}

function renderBlock(b, ctx) {
    switch (b.type) {
        case 'heading': {
            const level = Math.min(6, Math.max(1, b.level));
            const id = b.id ? ' id="' + escapeHtml(b.id) + '"' : '';
            return '<h' + level + id + '>' + renderInlines(b.inlines, ctx) + '</h' + level + '>';
        }
        case 'paragraph': {
            /* 整段只有一张带 caption 的图片 → 图注（科研报告风格） */
            const only = (b.inlines || []).filter((t) => !(t.type === 'text' && !t.text.trim()));
            if (only.length === 1 && only[0].type === 'image' && only[0].title) {
                const img = only[0];
                return '<figure class="art-figure">' + renderImage(img, ctx)
                    + '<figcaption>' + escapeHtml(img.alt || img.title) + '</figcaption></figure>';
            }
            return '<p>' + renderInlines(b.inlines, ctx) + '</p>';
        }
        case 'hr':
            return '<hr class="art-hr art-hr-' + escapeHtml(b.variant || 'dash') + '">';
        case 'blockquote':
            return '<blockquote class="art-quote">\n' + renderHtml(b.blocks, ctx) + '\n</blockquote>';
        case 'callout':
            return renderCallout(b, ctx);
        case 'list':
            return renderList(b, ctx);
        case 'table':
            return renderTable(b, ctx);
        case 'code':
            return renderCode(b);
        case 'math':
            return mathSpan(b.tex, true, b.delim);
        case 'fndef':
            return FNDEF_MARK + b.idx + MARK_END;
        default:
            return '';
    }
}

function renderCallout(b, ctx) {
    const type = b.calloutType;
    let html = '<blockquote class="art-callout art-callout-' + escapeHtml(type) + '" data-callout="' + escapeHtml(type) + '">\n';
    const titleMode = ctx.options.calloutTitle;
    let titleHtml = null;
    if (b.hasTitle && b.titleInlines) {
        titleHtml = renderInlines(b.titleInlines, ctx);
    } else if (titleMode !== 'none') {
        titleHtml = '<span class="art-callout-label">' + escapeHtml(labelFor(type)) + '</span>';
    }
    if (titleHtml !== null) {
        html += '<p class="art-callout-title' + (b.hasTitle ? '' : ' art-callout-title-default') + '">' + titleHtml + '</p>\n';
    }
    html += renderHtml(b.blocks, ctx) + '\n</blockquote>';
    return html;
}

function renderList(b, ctx) {
    const tag = b.ordered ? 'ol' : 'ul';
    const start = b.ordered && b.start !== 1 ? ' start="' + b.start + '"' : '';
    const items = (b.items || []).map((item) => {
        const task = item.task;
        let head = '';
        if (task) { head = '<input type="checkbox" disabled' + (task.checked ? ' checked' : '') + '> '; }
        const liClass = task ? ' class="art-task"' : '';
        const blocks = item.blocks || [];
        if (blocks.length === 1 && blocks[0].type === 'paragraph') {
            return '<li' + liClass + '>' + head + renderInlines(blocks[0].inlines, ctx) + '</li>';
        }
        return '<li' + liClass + '>\n' + head + renderHtml(blocks, ctx) + '\n</li>';
    });
    return '<' + tag + start + '>\n' + items.join('\n') + '\n</' + tag + '>';
}

function renderTable(b, ctx) {
    const alignStyle = (i) => (b.align && b.align[i] ? ' style="text-align:' + b.align[i] + '"' : '');
    const head = (b.head || []).map((cell, i) => '<th' + alignStyle(i) + '>' + renderInlines(cell, ctx) + '</th>').join('');
    const rows = (b.rows || []).map((row) => {
        const tds = row.map((cell, i) => '<td' + alignStyle(i) + '>' + renderInlines(cell, ctx) + '</td>').join('');
        return '<tr>' + tds + '</tr>';
    });
    return '<table class="art-table">\n<thead><tr>' + head + '</tr></thead>\n<tbody>\n' +
        rows.join('\n') + '\n</tbody>\n</table>';
}

function renderCode(b) {
    const lang = b.lang || '';
    const cls = lang ? ' class="language-' + escapeHtml(lang) + '"' : '';
    const data = lang ? ' data-lang="' + escapeHtml(lang) + '"' : '';
    return '<pre class="art-code"' + data + '><code' + cls + '>' + escapeHtml(b.text) + '</code></pre>';
}

/** 从 BlockToken 树收集目录（标题顺序；含引用/列表内标题） */
export function collectToc(blocks) {
    const toc = [];
    const walk = (list) => {
        (list || []).forEach((b) => {
            if (b.type === 'heading') {
                toc.push({ level: b.level, id: b.id, text: inlinesToText(b.inlines) });
            } else if (b.type === 'blockquote' || b.type === 'callout') {
                walk(b.blocks);
            } else if (b.type === 'list') {
                (b.items || []).forEach((it) => walk(it.blocks));
            }
        });
    };
    walk(blocks);
    return toc;
}
