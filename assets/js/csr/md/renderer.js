/* ============================================================
   CSR-MD · 门面（DOM-free）
   renderMarkdown(md, options) → { html, toc, flags, errors, warnings, blocks }
     toc    : [{ level, id, text }]
     flags  : { math, code, tables, callout, footnotes, task }（页面层按需加载 KaTeX/hljs）
     errors/warnings: [{ line, code, message }]（内容错误只收集，不抛异常）

   选项：math / tables / headingIds / idPrefix / footnotes / footnoteDisplay / calloutTitle / baseUrl
   安全：原生 HTML 一律转义（simple mode，不提供 raw-html 开关）。
   ============================================================ */

import { parseBlocks } from './blocks.js';
import { renderHtml, renderInlines, collectToc } from './html.js';
import { parseInline } from './inline.js';
import { createFootnotes, scanDefinitions, finalizeFootnotes } from './footnotes.js';

export const DEFAULTS = {
    math: true,
    tables: true,
    headingIds: true,
    idPrefix: 'art-',
    footnotes: true,
    footnoteDisplay: 'end',      // end | inline
    calloutTitle: 'default',     // default | none
    baseUrl: ''                  // 文章 bundle 目录（page.js 传入），用于解析作者写的相对链接/图片
};

export function normalizeOptions(options) {
    return Object.assign({}, DEFAULTS, options || {});
}

/** 统一换行（CRLF→LF）、去 BOM、tab→4 空格 */
export function normalizeInput(src) {
    return String(src == null ? '' : src)
        .replace(/^\uFEFF/, '')
        .replace(/\r\n?/g, '\n')
        .replace(/\t/g, '    ');
}

function makeContext(options) {
    const ctx = {
        options,
        flags: { math: false, code: false, tables: false, callout: false, footnotes: false, task: false },
        errors: [],
        warnings: [],
        usedIds: Object.create(null),
        currentLine: 0,
        fn: null,
        inFootDef: false,
        warn(code, message, line) {
            ctx.warnings.push({ line: line || ctx.currentLine || 0, code, message });
        },
        error(code, message, line) {
            ctx.errors.push({ line: line || ctx.currentLine || 0, code, message });
        }
    };
    return ctx;
}

export function renderMarkdown(src, options) {
    const opts = normalizeOptions(options);
    const ctx = makeContext(opts);
    let text = normalizeInput(src);
    if (text.indexOf('\u0000') >= 0) {
        ctx.warn('control-char', '源文含控制字符 U+0000（已剔除）');
        text = text.replace(/\u0000/g, '');
    }
    let lines = text.split('\n');
    if (opts.footnotes) {
        ctx.fn = createFootnotes();
        lines = scanDefinitions(lines, ctx);
    }
    const blocks = parseBlocks(lines, ctx, 0);
    let html = renderHtml(blocks, ctx);
    if (ctx.fn) { html = finalizeFootnotes(ctx, html); }
    return {
        html,
        toc: collectToc(blocks),
        flags: ctx.flags,
        errors: ctx.errors,
        warnings: ctx.warnings,
        blocks
    };
}

export function renderInlineMarkdown(text, options) {
    const opts = normalizeOptions(options);
    const ctx = makeContext(opts);
    const inlines = parseInline(normalizeInput(text), ctx, 0);
    return renderInlines(inlines, ctx);
}
