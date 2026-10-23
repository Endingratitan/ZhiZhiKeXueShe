/* ============================================================
   CSR-MD · 通用工具（DOM-free）
   - HTML 转义 / URL 白名单 / 标题 id / 语言类名 / 行内文本提取
   安全约定（simple mode）：
   - 原生 HTML 一律不直出（文本层全部 escapeHtml）
   - URL 仅允许 http/https/mailto 与相对路径/锚点；拒绝 javascript:/data:/vbscript:
   - 控制字符先剔除再判断 scheme（防止 \u0001javascript: 绕过）
   ============================================================ */

const CONTROL_RE = /[\u0000-\u001f\u007f]/g;

/* 脚注占位符（html 输出后由 footnotes.finalize 替换；渲染前会剔除输入中的 NUL） */
export const FNREF_MARK = '\u0000FNREF';
export const FNDEF_MARK = '\u0000FNDEF';
export const MARK_END = '\u0000';
const HTML_ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(text) {
    return String(text == null ? '' : text).replace(/[&<>"']/g, (c) => HTML_ESC[c]);
}

/** URL 白名单：返回安全 URL，不安全返回 null */
export function sanitizeUrl(raw) {
    if (typeof raw !== 'string') { return null; }
    let url = raw.replace(CONTROL_RE, '').trim();
    if (!url) { return null; }
    // URL 中不允许反斜杠（避免 javascript\: 之类混淆）
    if (url.indexOf('\\') >= 0) { url = url.replace(/\\/g, ''); }
    const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(url);
    if (m) {
        const scheme = m[1].toLowerCase();
        if (scheme !== 'http' && scheme !== 'https' && scheme !== 'mailto') { return null; }
        return url;
    }
    // 相对路径、绝对路径、锚点、协议相对（//host/path，页面协议解析）
    return url;
}

export function isExternalUrl(url) {
    return /^([a-zA-Z][a-zA-Z0-9+.-]*):/.test(url || '') || /^\/\//.test(url || '');
}

/** 相对 URL 按文章 bundle 目录解析；绝对/协议相对/根相对/锚点保持原样 */
export function resolveUrl(url, baseUrl) {
    if (!baseUrl) { return url; }
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url) || /^\/\//.test(url) || url[0] === '#' || url[0] === '/') { return url; }
    try { return new URL(url, baseUrl).href; } catch (e) { return url; }
}

/** 标题 slug：保留字母/数字/汉字，其余折叠为 '-' */
export function slugify(text) {
    const s = String(text || '').toLowerCase().trim()
        .replace(/[^\p{L}\p{N}]+/gu, '-')
        .replace(/^-+|-+$/g, '');
    return s;
}

/** 保证页面内 id 唯一（重复 → -2、-3…） */
export function uniqueId(base, used) {
    const id = base || 'section';
    if (!used[id]) { used[id] = 1; return id; }
    let n = 2;
    while (used[id + '-' + n]) { n += 1; }
    used[id + '-' + n] = 1;
    return id + '-' + n;
}

const LANG_ALIAS = {
    js: 'javascript', ts: 'typescript', py: 'python', sh: 'bash', shell: 'bash',
    'c++': 'cpp', cpp: 'cpp', cs: 'csharp', 'c#': 'csharp', yml: 'yaml',
    md: 'markdown', htm: 'xml', html: 'xml', tex: 'latex'
};

export function languageClass(lang) {
    const l = String(lang || '').toLowerCase().trim().split(/\s+/)[0] || '';
    const mapped = LANG_ALIAS[l] || l;
    return mapped.replace(/[^a-z0-9_+-]/g, '');
}

/** 行内 token → 纯文本（标题 id / toc / 图片 alt 用） */
export function inlinesToText(tokens) {
    let out = '';
    (tokens || []).forEach((t) => {
        switch (t.type) {
            case 'text': out += t.text; break;
            case 'code': out += t.text; break;
            case 'math': out += t.tex; break;
            case 'break': out += ' '; break;
            case 'em':
            case 'strong': out += inlinesToText(t.children); break;
            case 'link': out += inlinesToText(t.children); break;
            case 'image': out += t.alt || ''; break;
            default: break;
        }
    });
    return out;
}

/** 去掉行首行尾空白行 */
export function trimBlankLines(lines) {
    let a = 0, b = lines.length;
    while (a < b && !lines[a].trim()) { a += 1; }
    while (b > a && !lines[b - 1].trim()) { b -= 1; }
    return lines.slice(a, b);
}
