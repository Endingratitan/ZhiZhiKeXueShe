/* ============================================================
   CSR-MD · 块解析（DOM-free）
   行数组 → BlockToken 树（AST）。
   顺序：脚注定义占位 → ATX/setext 标题 → hr → 缩进代码 → 围栏代码 →
         块数学 → 引用/callout → 列表 → 表格 → 段落
   ============================================================ */

import {
    HEADING_RE, hrType, setextLevel, LIST_RE, isBlank, isBlockStart,
    isMathBlockStart, isIndentedCodeStart, HR_RE
} from './scan.js';
import { FNDEF_MARK } from './utils.js';
import { parseInline } from './inline.js';
import { parseFence, parseIndentedCode, parseMathBlock } from './code.js';
import { parseList } from './lists.js';
import { parseQuote } from './quotes.js';
import { parseTable } from './tables.js';
import { slugify, uniqueId, inlinesToText } from './utils.js';

export function parseBlocks(lines, ctx, depth) {
    if (!ctx.parseBlocks) { ctx.parseBlocks = parseBlocks; }
    const d = depth || 0;
    const blocks = [];
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];
        if (isBlank(line)) { i += 1; continue; }

        /* 脚注定义占位（inline 显示模式） */
        if (line.indexOf(FNDEF_MARK) === 0) {
            const idx = parseInt(line.slice(FNDEF_MARK.length), 10);
            if (!isNaN(idx)) { blocks.push({ type: 'fndef', idx }); }
            i += 1;
            continue;
        }

        /* ATX 标题（闭合 # 仅在空格后剥离） */
        const h = HEADING_RE.exec(line);
        if (h) {
            ctx.currentLine = i + 1;
            const content = String(h[2] || '').replace(/[ \t]+#+[ \t]*$/, '').trim();
            if (!content) { ctx.warn('empty-heading', '标题为空（# 后无内容）'); }
            blocks.push(makeHeading(ctx, h[1].length, content));
            i += 1;
            continue;
        }

        /* 分隔线（+ 的 +++ 是 plus；--- 在 setext 场景下由段落分支处理） */
        const ht = hrType(line);
        if (ht) {
            blocks.push({ type: 'hr', variant: ht });
            i += 1;
            continue;
        }

        /* 缩进代码（4 空格 / tab） */
        if (isIndentedCodeStart(line)) {
            const code = parseIndentedCode(ctx, lines, i);
            if (code) { blocks.push(code.token); i = code.next; continue; }
        }

        /* 围栏代码 */
        const fence = parseFence(ctx, lines, i);
        if (fence) { blocks.push(fence.token); i = fence.next; continue; }

        /* 块数学 */
        if (isMathBlockStart(line)) {
            const math = parseMathBlock(ctx, lines, i);
            if (math) { blocks.push(math.token); i = math.next; continue; }
        }

        /* 引用 / callout */
        if (/^ {0,3}>/.test(line)) {
            const q = parseQuote(ctx, lines, i, d);
            blocks.push(q.token);
            i = q.next;
            continue;
        }

        /* 列表 */
        if (LIST_RE.test(line)) {
            const l = parseList(ctx, lines, i, d);
            if (l) { blocks.push(l.token); i = l.next; continue; }
        }

        /* 表格 */
        if (ctx.options.tables) {
            const tb = parseTable(ctx, lines, i);
            if (tb) { blocks.push(tb.token); i = tb.next; continue; }
        }

        /* 段落；遇到 setext 下划线则转为标题（支持多行标题） */
        const start = i;
        const buf = [line];
        i += 1;
        let heading = null;
        while (i < lines.length) {
            const nl = setextLevel(lines[i]);
            if (nl) { heading = { level: nl }; i += 1; break; }
            if (isBlockStart(lines, i)) { break; }
            buf.push(lines[i]);
            i += 1;
        }
        ctx.currentLine = start + 1;
        if (heading) {
            blocks.push(makeHeading(ctx, heading.level, buf.join('\n')));
        } else {
            blocks.push({ type: 'paragraph', inlines: parseInline(buf.join('\n'), ctx) });
        }
    }

    return blocks;
}

function makeHeading(ctx, level, content) {
    const inlines = parseInline(content, ctx, 0);
    let id = null;
    if (ctx.options.headingIds) {
        id = uniqueId(slugify(inlinesToText(inlines)), ctx.usedIds);
    }
    return { type: 'heading', level, id, inlines };
}

/* 保留导出，便于测试/扩展 */
export { HR_RE };
