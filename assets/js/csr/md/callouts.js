/* ============================================================
   CSR-MD · callout 类型表（DOM-free，无状态）
   引用块首行 `[!TYPE] 可选标题`；16 个内置类型有中文默认标签，
   其它 kebab-case 类型是扩展逃生舱（标题回落 humanize）
   ============================================================ */

export const CALLOUT_RE = /^\[!([A-Za-z][A-Za-z0-9-]*)\]\s*(.*)$/;

const BUILTIN = {
    note: '注意', tip: '提示', important: '重要', warning: '警告',
    caution: '小心', info: '信息', success: '成功', question: '疑问',
    example: '示例', quote: '引用', abstract: '摘要', todo: '待办',
    danger: '危险', failure: '失败', bug: '缺陷', debug: '调试'
};

export function isKebab(type) {
    return !!type && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(type);
}

export function isKnown(type) {
    return Object.prototype.hasOwnProperty.call(BUILTIN, type);
}

export function humanize(type) {
    return String(type || '').split('-').filter(Boolean)
        .map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
}

export function labelFor(type) {
    return isKnown(type) ? BUILTIN[type] : humanize(type);
}
