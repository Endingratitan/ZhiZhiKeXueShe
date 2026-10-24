/* ============================================================
   CSR-MD · 引用块 + callouts（DOM-free）
   - `>` 行去标记后递归解析；空行后仍是 `>` 则继续同一引用
   - 懒续行：非 `>` 开头、非块起点的普通段落行归入引用
   - callout：引用首个非空行 `[!TYPE] 可选标题`；16 内置类型 + kebab 扩展
   ============================================================ */

import { QUOTE_RE, isBlank, isBlockStart } from './scan.js';
import { trimBlankLines } from './utils.js';
import { parseInline } from './inline.js';
import { CALLOUT_RE, isKebab, isKnown } from './callouts.js';

function startsCallout(rawLine) {
    const t = String(rawLine || '').replace(/^ {0,3}>[ \t]?/, '');
    const m = CALLOUT_RE.exec(t);
    return !!m && isKebab(m[1].toLowerCase());
}

export function parseQuote(ctx, lines, i, depth) {
    const inner = [];
    let j = i;

    while (j < lines.length) {
        const line = lines[j];
        if (QUOTE_RE.test(line)) {
            inner.push(line.replace(/^ {0,3}>[ \t]?/, ''));
            j += 1;
            continue;
        }
        if (isBlank(line)) {
            let k = j;
            while (k < lines.length && isBlank(lines[k])) { k += 1; }
            if (k < lines.length && QUOTE_RE.test(lines[k])) {
                if (startsCallout(lines[k])) { break; }   // 新 callout 断成两块
                for (; j < k; j += 1) { inner.push(''); }
                continue;
            }
            break;
        }
        /* 懒续行 */
        if (!isBlockStart(lines, j)) {
            inner.push(line.trim());
            j += 1;
            continue;
        }
        break;
    }

    /* callout 检测：首个非空行 */
    let callout = null;
    const firstIdx = inner.findIndex((l) => l.trim() !== '');
    if (firstIdx >= 0) {
        const cm = CALLOUT_RE.exec(inner[firstIdx]);
        if (cm) {
            const type = cm[1].toLowerCase();
            if (isKebab(type)) {
                const title = (cm[2] || '').trim();
                callout = {
                    type,
                    title: title || null,
                    titleInlines: title ? parseInline(title, ctx, 0) : null,
                    hasContent: false
                };
                inner.splice(firstIdx, 1);
                callout.hasContent = inner.some((l) => l.trim() !== '');
                if (!isKnown(type)) {
                    ctx.warn('callout-unknown', '非内置 callout 类型 ' + type + '（按扩展类型渲染）');
                }
                if (!callout.hasContent) { ctx.warn('callout-empty', 'callout 无内容: [' + type + ']'); }
                ctx.flags.callout = true;
            }
        }
    }

    const blocks = ctx.parseBlocks(trimBlankLines(inner), ctx, depth);
    const token = callout
        ? { type: 'callout', calloutType: callout.type, titleInlines: callout.titleInlines, hasTitle: !!callout.title, blocks }
        : { type: 'blockquote', blocks };
    return { token, next: j };
}
