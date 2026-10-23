/* ============================================================
   CSR-MD · 脚注子系统（DOM-free，对齐原 CSR 语义）
   流程：
     ① 扫描顶层定义行：`[^1]: 内容`（显式编号）/ `[.^]: 内容`（懒定义）
     ② 行内引用登记：`[^1]` / `[^.]`（placeholder 由 html.js 输出）
     ③ 编号分配：显式配对 → 未配对引用与未配对定义按顺序配对 → 未定义引用报错
     ④ 替换正文占位符（同编号多次引用 → fnref-N-2…）
     ⑤ end 模式生成文末脚注区；inline 模式在定义原位置渲染
   错误只收集，不抛异常
   ============================================================ */

import { parseInline } from './inline.js';
import { renderInlines } from './html.js';
import { FNREF_MARK, FNDEF_MARK, MARK_END } from './utils.js';

const EXPLICIT_RE = /^ {0,3}\[\^(\d+)\]:[ \t]*(.*)$/;
const LAZY_RE = /^ {0,3}\[\.\^\]:[ \t]*(.*)$/;

export function createFootnotes() {
    return { explicitDefs: [], lazyDefs: [], allDefs: [], refs: [] };
}

/** 扫描定义行；返回替换后的行数组（保留行数）
 *  end 模式：定义行 → 空行；inline 模式：定义行 → FNDEF 占位标记 */
export function scanDefinitions(lines, ctx) {
    const out = lines.slice();
    const fn = ctx.fn;
    for (let idx = 0; idx < lines.length; idx += 1) {
        const line = lines[idx];
        if (line.indexOf('[^') < 0 && line.indexOf('[.^]') < 0) { continue; }
        let m = EXPLICIT_RE.exec(line);
        let def = null;
        if (m) {
            const numStr = m[1];
            if (numStr.length > 6) {
                ctx.error('footnote-num', '脚注编号过大（最多 6 位）: [^' + numStr + ']', idx + 1);
                continue;
            }
            const num = parseInt(numStr, 10);
            if (!(num > 0)) {
                ctx.error('footnote-num', '脚注编号必须为正整数: [^' + numStr + ']', idx + 1);
                continue;
            }
            const content = m[2].trim();
            if (!content) { ctx.error('footnote-empty', '脚注定义内容为空', idx + 1); continue; }
            if (fn.explicitDefs.some((d) => d.num === num)) {
                ctx.error('footnote-duplicate', '脚注编号重复定义: [^' + num + ']', idx + 1);
                continue;
            }
            def = { num, lineNo: idx + 1, content, dispNum: null };
            fn.explicitDefs.push(def);
        } else {
            m = LAZY_RE.exec(line);
            if (!m) { continue; }
            const content = m[1].trim();
            if (!content) { ctx.error('footnote-empty', '脚注定义内容为空', idx + 1); continue; }
            def = { num: null, lineNo: idx + 1, content, dispNum: null };
            fn.lazyDefs.push(def);
        }
        const defIdx = fn.allDefs.length;
        fn.allDefs.push(def);
        out[idx] = ctx.options.footnoteDisplay === 'inline'
            ? (FNDEF_MARK + defIdx + MARK_END)
            : '';
        ctx.flags.footnotes = true;
    }
    return out;
}

/** 行内解析回调：登记引用，返回 seq（非法编号返回 null，由调用方按字面输出） */
export function registerRef(ctx, label, lineNo) {
    if (!ctx.fn || ctx.inFootDef) { return null; }
    const isAuto = label === '.';
    if (!isAuto) {
        if (!/^\d+$/.test(label) || label.length > 6) {
            ctx.error('footnote-num', '脚注编号过大或非法: [^' + label + ']（最多 6 位）', lineNo);
            return null;
        }
        if (parseInt(label, 10) <= 0) {
            ctx.error('footnote-num', '脚注编号必须为正整数: [^' + label + ']', lineNo);
            return null;
        }
    }
    const seq = ctx.fn.refs.length;
    ctx.fn.refs.push({ label, lineNo, seq, num: -1, def: null });
    ctx.flags.footnotes = true;
    return seq;
}

function nextFree(reserved) {
    let n = 1;
    while (reserved[n]) { n += 1; }
    return n;
}

function renderDefContent(ctx, def) {
    const prev = ctx.inFootDef;
    ctx.inFootDef = true;
    try {
        const inlines = parseInline(def.content, ctx, 0);
        return renderInlines(inlines, ctx);
    } finally {
        ctx.inFootDef = prev;
    }
}

function anchorPrefix(ctx) {
    return String(ctx.options.idPrefix || '').replace(/[^A-Za-z0-9_-]/g, '');
}

/** 编号分配 + 占位符替换 + 脚注区（end）/定义块（inline） */
export function finalizeFootnotes(ctx, html) {
    const fn = ctx.fn;
    if (!fn) { return html; }
    const refs = fn.refs;
    if (!refs.length && !fn.explicitDefs.length && !fn.lazyDefs.length) { return html; }

    /* ① 显式配对 */
    const reserved = Object.create(null);
    refs.forEach((r) => { if (r.label !== '.') { reserved[parseInt(r.label, 10)] = true; } });
    const byNum = new Map();
    fn.explicitDefs.forEach((d) => byNum.set(d.num, d));

    const unmatchedRefs = [];
    refs.forEach((r) => {
        if (r.label !== '.') {
            const n = parseInt(r.label, 10);
            const d = byNum.get(n);
            if (d) { r.num = n; r.def = d; d.dispNum = n; }
            else { unmatchedRefs.push(r); }
        } else {
            unmatchedRefs.push(r);
        }
    });

    const referenced = new Set();
    refs.forEach((r) => { if (r.def) { referenced.add(r.num); } });
    const unmatchedDefs = [];
    fn.explicitDefs.forEach((d) => { if (!referenced.has(d.num)) { unmatchedDefs.push(d); } });
    fn.lazyDefs.forEach((d) => unmatchedDefs.push(d));

    /* ② 懒惰/空位池按顺序配对 */
    let k = 0;
    unmatchedRefs.forEach((ur) => {
        if (k < unmatchedDefs.length) {
            const nn = ur.label === '.' ? nextFree(reserved) : parseInt(ur.label, 10);
            reserved[nn] = true;
            ur.num = nn;
            ur.def = unmatchedDefs[k];
            unmatchedDefs[k].dispNum = nn;
            k += 1;
        } else {
            ctx.error('footnote-undefined', '脚注引用未定义: [^' + ur.label + ']', ur.lineNo);
            ur.num = -1;
        }
    });
    for (; k < unmatchedDefs.length; k += 1) {
        const dd = unmatchedDefs[k];
        ctx.warn('footnote-unused', '脚注定义未被引用（多余第 ' + (k - unmatchedRefs.length + 1) + ' 个）: ' + dd.content, dd.lineNo);
        dd.dispNum = -1;
    }

    const prefix = anchorPrefix(ctx);
    const occ = Object.create(null);

    /* ③ 替换引用占位符 */
    html = html.replace(/\u0000FNREF(\d+)\u0000/g, (m, seqStr) => {
        const r = refs[parseInt(seqStr, 10)];
        if (!r || r.num < 0) { return '[^' + (r ? r.label : '?') + ']'; }
        occ[r.num] = (occ[r.num] || 0) + 1;
        const c = occ[r.num];
        const id = c === 1 ? prefix + 'fnref-' + r.num : prefix + 'fnref-' + r.num + '-' + c;
        return '<sup class="art-fn-ref" id="' + id + '"><a href="#' + prefix + 'fn-' + r.num + '">' + r.num + '</a></sup>';
    });

    /* ④ 替换定义占位符（inline 模式） */
    html = html.replace(/\u0000FNDEF(\d+)\u0000/g, (m, diStr) => {
        const def = fn.allDefs[parseInt(diStr, 10)];
        if (!def) { return ''; }
        const content = renderDefContent(ctx, def);
        if (def.dispNum !== null && def.dispNum > 0) {
            return '<div class="art-footnote" id="' + prefix + 'fn-' + def.dispNum + '">' + content
                + ' <a href="#' + prefix + 'fnref-' + def.dispNum + '" class="art-fn-back">↩</a></div>';
        }
        return '<div class="art-footnote">' + content + '</div>';
    });

    if (ctx.options.footnoteDisplay === 'inline') { return html; }

    /* ⑤ end 模式脚注区（按编号升序；同编号只出现一次） */
    const section = [];
    const seen = Object.create(null);
    refs.forEach((r) => {
        if (r.num > 0 && r.def && !seen[r.num]) {
            seen[r.num] = true;
            section.push({ num: r.num, def: r.def });
        }
    });
    if (!section.length) { return html; }
    section.sort((a, b) => a.num - b.num);
    let out = '<div class="art-footnotes">\n<hr>\n<ol>\n';
    section.forEach((e) => {
        out += '<li id="' + prefix + 'fn-' + e.num + '">' + renderDefContent(ctx, e.def)
            + ' <a href="#' + prefix + 'fnref-' + e.num + '" class="art-fn-back">↩</a></li>\n';
    });
    out += '</ol>\n</div>\n';
    return html + '\n' + out;
}
