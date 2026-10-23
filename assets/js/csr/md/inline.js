/* ============================================================
   CSR-MD · 行内解析（DOM-free）
   支持：转义、行内代码、`\(...\)`/`$...$`/`$$...$$` 数学、强调/加粗、
         删除线 `~~`、`[[kbd]]`、脚注引用 `[^n]`/`[^.]`、
         链接/图片、`<http(s)://…>` 自动链接、两空格/反斜杠硬换行
   安全：URL 白名单（javascript:/data: 等拒绝；拒绝时按字面文本渲染并警告）
   ============================================================ */

import { sanitizeUrl, inlinesToText } from './utils.js';
import { registerRef } from './footnotes.js';

const ESCAPABLE = '\\`*_{}[]()#+-.!|~<>$&';

function warn(ctx, code, message) {
    if (ctx && typeof ctx.warn === 'function') { ctx.warn(code, message); }
}

function isWS(ch) { return !ch || /\s/.test(ch); }
function isAlnum(ch) { return !!ch && /[\p{L}\p{N}_]/u.test(ch); }

export function parseInline(text, ctx, depth) {
    const d = depth || 0;
    if (d > 12) { return [{ type: 'text', text: String(text == null ? '' : text) }]; }
    const src = String(text == null ? '' : text);
    const out = [];
    let buf = '';
    let i = 0;

    const flush = () => {
        if (buf) { out.push({ type: 'text', text: buf }); buf = ''; }
    };

    while (i < src.length) {
        const ch = src[i];

        /* 反斜杠硬换行（行尾 \） */
        if (ch === '\\' && src[i + 1] === '\n') {
            flush();
            out.push({ type: 'break' });
            i += 2;
            continue;
        }

        /* \( ... \) 数学：优先级高于转义（对齐原 CSR） */
        if (ch === '\\' && src[i + 1] === '(') {
            const close = src.indexOf('\\)', i + 2);
            if (close > i + 2) {
                flush();
                out.push({ type: 'math', tex: src.slice(i + 2, close), display: false });
                ctx.flags.math = true;
                i = close + 2;
                continue;
            }
            warn(ctx, 'math-unclosed', '行内数学未闭合（\\( 缺少 \\)）');
            buf += '\\(';
            i += 2;
            continue;
        }

        /* 反斜杠转义 */
        if (ch === '\\' && i + 1 < src.length && ESCAPABLE.indexOf(src[i + 1]) >= 0) {
            buf += src[i + 1];
            i += 2;
            continue;
        }

        /* 行内代码 */
        if (ch === '`') {
            const end = src.indexOf('`', i + 1);
            if (end > i && src.slice(i + 1, end).indexOf('\n') < 0) {
                flush();
                out.push({ type: 'code', text: src.slice(i + 1, end) });
                i = end + 1;
                continue;
            }
        }

        /* 数学 $...$ / $$...$$ */
        if (ctx.options.math && ch === '$') {
            if (src[i + 1] === '$') {
                const end = findDollarEnd(src, i + 2, true);
                if (end > i + 2) {
                    flush();
                    out.push({ type: 'math', tex: src.slice(i + 2, end), display: true });
                    ctx.flags.math = true;
                    i = end + 2;
                    continue;
                }
            } else if (mathOpen(src, i)) {
                const end = mathClose(src, i);
                if (end > 0) {
                    flush();
                    out.push({ type: 'math', tex: src.slice(i + 1, end), display: false });
                    ctx.flags.math = true;
                    i = end + 1;
                    continue;
                }
            }
        }

        /* 删除线 ~~...~~ */
        if (ch === '~' && src[i + 1] === '~' && !isWS(src[i + 2])) {
            const end = findClose(src, i + 2, '~~', false);
            if (end > i + 2) {
                flush();
                out.push({ type: 'del', children: parseInline(src.slice(i + 2, end), ctx, d + 1) });
                i = end + 2;
                continue;
            }
        }

        /* [[kbd]] */
        if (ch === '[' && src[i + 1] === '[') {
            const end = src.indexOf(']]', i + 2);
            if (end > i + 2) {
                flush();
                out.push({ type: 'kbd', text: src.slice(i + 2, end) });
                i = end + 2;
                continue;
            }
        }

        /* 脚注引用 [^n] / [^.] */
        if (ch === '[' && src[i + 1] === '^') {
            const close = src.indexOf(']', i + 2);
            if (close > i + 2) {
                const label = src.slice(i + 2, close);
                const isRef = label === '.' || (/^\d+$/.test(label));
                if (!isRef) {
                    /* 非数字标签：按字面处理 */
                    buf += src.slice(i, close + 1);
                    i = close + 1;
                    continue;
                }
                if (ctx.inFootDef || !ctx.fn) {
                    buf += src.slice(i, close + 1);
                    i = close + 1;
                    continue;
                }
                const seq = registerRef(ctx, label, ctx.currentLine || 0);
                if (seq !== null) {
                    flush();
                    out.push({ type: 'fnref', seq });
                    i = close + 1;
                    continue;
                }
                buf += src.slice(i, close + 1);
                i = close + 1;
                continue;
            }
        }

        /* 图片 ![alt](src "title") */
        if (ch === '!' && src[i + 1] === '[') {
            const r = parseLinkLike(src, i + 1, true, ctx);
            if (r) { flush(); out.push(r.token); i = r.end; continue; }
        }

        /* 链接 [text](href "title") */
        if (ch === '[') {
            const r = parseLinkLike(src, i, false, ctx);
            if (r) { flush(); out.push(r.token); i = r.end; continue; }
        }

        /* 自动链接 <http(s)://...> */
        if (ch === '<') {
            const close = src.indexOf('>', i + 1);
            if (close > i + 1) {
                const inner = src.slice(i + 1, close);
                if (/^https?:\/\//i.test(inner) && inner.indexOf(' ') < 0) {
                    flush();
                    out.push({
                        type: 'link',
                        href: inner,
                        title: null,
                        children: [{ type: 'text', text: inner }],
                        autolink: true
                    });
                    i = close + 1;
                    continue;
                }
            }
        }

        /* 强调 / 加粗 */
        if (ch === '*' || ch === '_') {
            const strong = src[i + 1] === ch;
            const len = strong ? 2 : 1;
            const mark = strong ? ch + ch : ch;
            const canOpen = ch === '*' ? !isWS(src[i + len]) : openUnder(src, i, len);
            if (canOpen) {
                const end = findClose(src, i + len, mark, ch === '_');
                if (end > i + len) {
                    flush();
                    out.push({
                        type: strong ? 'strong' : 'em',
                        children: parseInline(src.slice(i + len, end), ctx, d + 1)
                    });
                    i = end + len;
                    continue;
                }
            }
        }

        /* 换行：行尾两个空格 = 硬换行，否则视为空格 */
        if (ch === '\n') {
            if (/ {2,}$/.test(buf)) {
                buf = buf.replace(/ {2,}$/, '');
                flush();
                out.push({ type: 'break' });
            } else {
                buf += ' ';
            }
            i += 1;
            continue;
        }

        buf += ch;
        i += 1;
    }

    flush();
    return mergeText(out);
}

function mergeText(tokens) {
    const out = [];
    tokens.forEach((t) => {
        const last = out[out.length - 1];
        if (t.type === 'text' && last && last.type === 'text') { last.text += t.text; }
        else { out.push(t); }
    });
    return out;
}

/** '_' 开标记：两侧不能同时是字母数字，且后一字符非空白 */
function openUnder(s, i, len) {
    const prevAl = i > 0 && isAlnum(s.charAt(i - 1));
    const next = s.charAt(i + len);
    const nextAl = isAlnum(next);
    return !isWS(next) && (!prevAl || !nextAl);
}

/** 强调闭合标记（跳过转义；_ 需两侧边界；单标记不把 ** 当作闭合） */
function findClose(s, from, mark, under) {
    const ml = mark.length;
    for (let j = from; j + ml <= s.length; j += 1) {
        if (s.slice(j, j + ml) !== mark) { continue; }
        if (j > 0 && s.charAt(j - 1) === '\\') { continue; }
        if (ml === 1 && s.charAt(j + 1) === mark) { j += 1; continue; }
        const prev = j > 0 ? s.charAt(j - 1) : ' ';
        if (isWS(prev)) { continue; }
        if (under) {
            const prevAl = j > 0 && isAlnum(prev);
            const nextAl = j + ml < s.length && isAlnum(s.charAt(j + ml));
            if (prevAl && nextAl) { continue; }
        }
        return j;
    }
    return -1;
}

/** $ 开标记：前后都是边界（行首尾/空白/$）时视为孤立（货币），否则是数学候选 */
function mathOpen(s, i) {
    const prev = i === 0 ? ' ' : s.charAt(i - 1);
    const next = i + 1 >= s.length ? ' ' : s.charAt(i + 1);
    const prevB = isWS(prev) || prev === '$';
    const nextB = isWS(next) || next === '$';
    return !(prevB && nextB);
}

/** 闭 $：前邻非空白非 $；跳过被 \ 转义的 $ */
function mathClose(s, open) {
    for (let j = open + 2; j < s.length; j += 1) {
        if (s.charAt(j) !== '$') { continue; }
        if (j > 0 && s.charAt(j - 1) === '\\') { continue; }
        const p = s.charAt(j - 1);
        if (!isWS(p) && p !== '$') { return j; }
    }
    return -1;
}

function findDollarEnd(s, from, double) {
    for (let j = from; j + (double ? 1 : 0) < s.length; j += 1) {
        if (double) {
            if (s.charAt(j) === '$' && s.charAt(j + 1) === '$') { return j > from ? j : -1; }
        } else if (s.charAt(j) === '$' && j > from) {
            return j;
        }
    }
    return -1;
}

/** 解析 [label](href "title") / ![alt](src "title") */
function parseLinkLike(src, openIdx, isImage, ctx) {
    let i = openIdx + 1;
    let depth = 1;
    const labelStart = i;
    while (i < src.length) {
        const c = src[i];
        if (c === '\\') { i += 2; continue; }
        if (c === '[') { depth += 1; }
        else if (c === ']') {
            depth -= 1;
            if (depth === 0) { break; }
        }
        i += 1;
    }
    if (depth !== 0 || src[i + 1] !== '(') { return null; }
    const label = src.slice(labelStart, i);
    let j = i + 2;
    let par = 1;
    while (j < src.length) {
        const c = src[j];
        if (c === '\\') { j += 2; continue; }
        if (c === '(') { par += 1; }
        else if (c === ')') {
            par -= 1;
            if (par === 0) { break; }
        }
        j += 1;
    }
    if (par !== 0) { return null; }
    const end = j + 1;
    const inner = src.slice(i + 2, j).trim();
    let href = inner;
    let title = null;
    const tm = /^(\S+?)(?:\s+["'](.*)["'])?$/.exec(inner);
    if (tm) { href = tm[1]; title = tm[2] || null; }

    const safe = sanitizeUrl(href);
    if (!safe) {
        warn(ctx, 'unsafe-url', (isImage ? '图片' : '链接') + ' URL 被拒绝：' + String(href).slice(0, 80));
        return { token: { type: 'text', text: src.slice(openIdx, end) }, end };
    }
    if (isImage) {
        return {
            token: {
                type: 'image',
                src: safe,
                alt: inlinesToText(parseInline(label, ctx, 8)),
                title
            },
            end
        };
    }
    return {
        token: { type: 'link', href: safe, title, children: parseInline(label, ctx, 8) },
        end
    };
}
