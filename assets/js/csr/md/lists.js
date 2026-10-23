/* ============================================================
   CSR-MD · 列表（DOM-free）
   有序/无序 + 任务列表；嵌套不限（递归深度由浏览器栈约束）；
   懒续行：未出现空行时，非块起点的未缩进行仍属于当前列表项
   ============================================================ */

import { LIST_RE, countIndent, stripIndent, isBlockStart, isBlank } from './scan.js';

const TASK_RE = /^\[([ xX])\](?:[ \t]+|$)/;

export function parseList(ctx, lines, i, depth) {
    const first = LIST_RE.exec(lines[i]);
    if (!first) { return null; }
    const ordered = /^\d/.test(first[2]);
    const baseIndent = countIndent(lines[i]);
    const start = ordered ? parseInt(first[2], 10) : 1;
    const items = [];
    let j = i;

    while (j < lines.length) {
        const mm = LIST_RE.exec(lines[j]);
        if (!mm) { break; }
        if (countIndent(lines[j]) !== baseIndent) { break; }
        if (/^\d/.test(mm[2]) !== ordered) { break; }

        const contentIndent = countIndent(lines[j]) + mm[2].length + mm[3].length;
        let firstContent = mm[4];
        let task = null;
        const tm = TASK_RE.exec(firstContent);
        if (tm) {
            task = { checked: tm[1] === 'x' || tm[1] === 'X' };
            firstContent = firstContent.slice(tm[0].length);
            ctx.flags.task = true;
        }

        const itemLines = [firstContent];
        j += 1;
        let sawBlank = false;

        while (j < lines.length) {
            const line = lines[j];
            if (isBlank(line)) { itemLines.push(''); sawBlank = true; j += 1; continue; }

            const mm2 = LIST_RE.exec(line);
            if (mm2 && countIndent(line) === baseIndent) { break; }   // 下一个同层项

            const ind = countIndent(line);
            if (ind >= contentIndent) {
                itemLines.push(stripIndent(line, contentIndent));
                sawBlank = false;
                j += 1;
                continue;
            }
            /* 懒续行：没有空行、且不是新的块起点 → 继续当前项 */
            if (!sawBlank && !isBlockStart(lines, j)) {
                itemLines.push(line.trim());
                j += 1;
                continue;
            }
            break;
        }

        while (itemLines.length && !itemLines[itemLines.length - 1].trim()) { itemLines.pop(); }
        items.push({ blocks: ctx.parseBlocks(itemLines, ctx, depth + 1), task });
    }

    if (!items.length) { return null; }
    return { token: { type: 'list', ordered, start, items }, next: j };
}
