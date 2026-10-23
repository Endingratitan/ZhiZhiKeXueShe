/* ============================================================
   CSR-MD · GFM 表格（DOM-free）
   表头 + 分隔行（:--- / :---: / ---:）+ 数据行；单元格走行内解析
   ============================================================ */

import { parseInline } from './inline.js';
import { TABLE_DELIM_RE } from './scan.js';

export function isTableStart(lines, i) {
    if (i + 1 >= lines.length) { return false; }
    if (lines[i].indexOf('|') < 0) { return false; }
    return TABLE_DELIM_RE.test(lines[i + 1]);
}

export function parseTable(ctx, lines, i) {
    if (!isTableStart(lines, i)) { return null; }
    const head = splitCells(lines[i]);
    const delim = splitCells(lines[i + 1]);
    if (!head.length || head.length !== delim.length) { return null; }

    const align = delim.map((c) => {
        const t = c.trim();
        const left = t.startsWith(':');
        const right = t.endsWith(':');
        if (left && right) { return 'center'; }
        if (right) { return 'right'; }
        if (left) { return 'left'; }
        return null;
    });

    const rows = [];
    let j = i + 2;
    for (; j < lines.length; j += 1) {
        const line = lines[j];
        if (!line.trim() || line.indexOf('|') < 0) { break; }
        let cells = splitCells(line);
        while (cells.length < head.length) { cells.push(''); }
        if (cells.length > head.length) { cells = cells.slice(0, head.length); }
        rows.push(cells.map((c) => parseInline(c, ctx)));
    }
    if (!rows.length) { return null; }

    ctx.flags.tables = true;
    return {
        token: {
            type: 'table',
            head: head.map((c) => parseInline(c, ctx)),
            rows,
            align
        },
        next: j
    };
}

/** 拆分表格行：处理 \| 转义与首尾可选竖线 */
export function splitCells(line) {
    let s = String(line || '').trim();
    if (s.startsWith('|')) { s = s.slice(1); }
    if (s.endsWith('|') && !s.endsWith('\\|')) { s = s.slice(0, -1); }
    const cells = [];
    let cur = '';
    let i = 0;
    while (i < s.length) {
        const c = s[i];
        if (c === '\\' && s[i + 1] === '|') { cur += '|'; i += 2; continue; }
        if (c === '|') { cells.push(cur.trim()); cur = ''; i += 1; continue; }
        cur += c;
        i += 1;
    }
    cells.push(cur.trim());
    return cells;
}
