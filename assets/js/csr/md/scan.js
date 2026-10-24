/* ============================================================
   CSR-MD · 块起点扫描（DOM-free，不产 HTML）
   用途：段落何时结束、列表项/引用内嵌套解析
   ============================================================ */

export const HEADING_RE = /^ {0,3}(#{1,6})(?:[ \t]+(.*))?[ \t]*$/;
export const FENCE_RE = /^ {0,3}(`{3,}|~{3,})[ \t]*(.*)$/;
export const QUOTE_RE = /^ {0,3}>[ \t]?/;
export const LIST_RE = /^([ \t]*)([-*+]|\d{1,9}[.)])([ \t]+)(.*)$/;
export const HR_RE = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,}|(?:\+[ \t]*){3,})$/;
export const SETEXT_RE = /^ {0,3}(=+|-+)[ \t]*$/;
export const TABLE_DELIM_RE = /^ {0,3}\|?[ \t]*:?-{3,}:?[ \t]*(\|[ \t]*:?-{3,}:?[ \t]*)+\|?[ \t]*$/;

export function isBlank(line) {
    return !line || !line.trim();
}

export function countIndent(line) {
    let n = 0;
    while (n < line.length && (line[n] === ' ' || line[n] === '\t')) { n += line[n] === '\t' ? 4 : 1; }
    return n;
}

/** 去掉行首最多 n 个字符宽度的缩进（tab 记 4） */
export function stripIndent(line, n) {
    let i = 0, w = 0;
    while (i < line.length && w < n) {
        if (line[i] === ' ') { w += 1; i += 1; }
        else if (line[i] === '\t') { w += 4; i += 1; }
        else { break; }
    }
    return line.slice(i);
}

/** 表格开始判定：本行含 |，下一行是分隔行 */
export function isTableStart(lines, i) {
    if (i + 1 >= lines.length) { return false; }
    if (lines[i].indexOf('|') < 0) { return false; }
    return TABLE_DELIM_RE.test(lines[i + 1]);
}

/** 该行是否是某个块的起点（用于段落结束判定/懒续行判定） */
export function isBlockStart(lines, i) {
    const line = lines[i];
    if (line == null) { return true; }
    if (!line.trim()) { return true; }
    if (HEADING_RE.test(line)) { return true; }
    if (FENCE_RE.test(line)) { return true; }
    if (QUOTE_RE.test(line)) { return true; }
    if (LIST_RE.test(line)) { return true; }
    if (HR_RE.test(line)) { return true; }
    if (/^ {0,3}(\$\$|\\\[)/.test(line)) { return true; }
    if (isTableStart(lines, i)) { return true; }
    return false;
}

/** 分隔线类型：star（三个星号或下划线）/ dash（---）/ plus（+++） */
export function hrType(line) {
    const t = (line || '').trim();
    if (!HR_RE.test(line || '')) { return null; }
    if (/^\*{3,}[ \t]*$/.test(t) || /^_{3,}[ \t]*$/.test(t)) { return 'star'; }
    if (/^-{3,}[ \t]*$/.test(t)) { return 'dash'; }
    if (/^\+{3,}[ \t]*$/.test(t)) { return 'plus'; }
    return null;
}

/** setext 标题下划线：=== → h1，--- → h2 */
export function setextLevel(line) {
    const m = SETEXT_RE.exec(line || '');
    if (!m) { return 0; }
    return m[1].charAt(0) === '=' ? 1 : 2;
}

/** 是否以 $$ 或 \[ 开头的块数学 */
export function isMathBlockStart(line) {
    return /^ {0,3}(\$\$|\\\[)/.test(line || '');
}

/** 缩进代码块起点（4 空格或 tab） */
export function isIndentedCodeStart(line) {
    return /^(?: {4}|\t)/.test(line || '');
}
