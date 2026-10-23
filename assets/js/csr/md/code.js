/* ============================================================
   CSR-MD · 代码块与块数学（DOM-free）
   - 围栏代码：```/~~~ [lang]（PassThrough 语义：转义 + language-* 类，上色交给代码渲染器）
   - 缩进代码：4 空格 / tab（CommonMark 习惯）
   - 块数学：$$…$$ 或 \[…\]
   ============================================================ */

import { languageClass } from './utils.js';
import { countIndent, stripIndent, isIndentedCodeStart } from './scan.js';

const FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})[ \t]*(.*)$/;

/** 围栏代码块。返回 { token, next } 或 null */
export function parseFence(ctx, lines, i) {
    const m = FENCE_OPEN_RE.exec(lines[i]);
    if (!m) { return null; }
    const fence = m[1];
    const info = (m[2] || '').trim();
    if (fence[0] === '`' && info.indexOf('`') >= 0) { return null; }
    const lang = info.split(/\s+/)[0] || '';
    const closeRe = new RegExp('^ {0,3}' + (fence[0] === '`' ? '`' : '~') + '{' + fence.length + ',}[ \\t]*$');
    const body = [];
    let j = i + 1;
    let closed = false;
    for (; j < lines.length; j += 1) {
        if (closeRe.test(lines[j])) { closed = true; break; }
        body.push(lines[j]);
    }
    if (!closed) { ctx.warn('unclosed-fence', '代码围栏未闭合（按到文末处理）'); }
    ctx.flags.code = true;
    return {
        token: { type: 'code', lang: languageClass(lang), info, text: body.join('\n'), indented: false },
        next: closed ? j + 1 : lines.length
    };
}

/** 缩进代码块（4 空格 / tab），空行保留、行尾空行去掉 */
export function parseIndentedCode(ctx, lines, i) {
    if (!isIndentedCodeStart(lines[i] || '')) { return null; }
    const body = [];
    let j = i;
    while (j < lines.length) {
        const line = lines[j];
        if (!line.trim()) { body.push(''); j += 1; continue; }
        if (!isIndentedCodeStart(line)) { break; }
        body.push(stripIndent(line, 4));
        j += 1;
    }
    while (body.length && !body[body.length - 1].trim()) { body.pop(); }
    if (!body.length) { return null; }
    ctx.flags.code = true;
    return {
        token: { type: 'code', lang: '', info: '', text: body.join('\n'), indented: true },
        next: j
    };
}

const MATH_OPEN_RE = /^ {0,3}(\$\$|\\\[)/;

/** 块数学：$$…$$ 或 \[…\]。返回 { token, next } 或 null */
export function parseMathBlock(ctx, lines, i) {
    const m = MATH_OPEN_RE.exec(lines[i] || '');
    if (!m) { return null; }
    const bracket = m[1] === '\\[';
    const open = m[1];
    const close = bracket ? '\\]' : '$$';
    const first = lines[i].trim();
    /* 单行 */
    if (first.length > open.length + close.length && first.endsWith(close)) {
        const tex = first.slice(open.length, -close.length).trim();
        if (tex) {
            ctx.flags.math = true;
            return { token: { type: 'math', tex, display: true, delim: bracket ? 'latex' : 'dollar' }, next: i + 1 };
        }
    }
    const body = [];
    const afterOpen = first.slice(open.length).trim();
    if (afterOpen) { body.push(afterOpen); }
    let j = i + 1;
    let closed = false;
    for (; j < lines.length; j += 1) {
        const line = lines[j];
        if (line.trim().endsWith(close)) {
            body.push(line.slice(0, line.lastIndexOf(close)));
            closed = true;
            break;
        }
        body.push(line);
    }
    if (!closed) {
        ctx.warn('unclosed-math', '块数学未闭合（按普通文本渲染）');
        return null;
    }
    const tex = body.join('\n').trim();
    if (!tex) { return null; }
    ctx.flags.math = true;
    return { token: { type: 'math', tex, display: true, delim: bracket ? 'latex' : 'dollar' }, next: j + 1 };
}
