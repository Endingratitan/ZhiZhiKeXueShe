/* ============================================================
   列表预取：浏览器空闲时提前请求下一批 info（不渲染）
   - 尊重 Save-Data / 2G-like 连接
   - 依赖 core 的 info 缓存，真正加载时命中缓存
   ============================================================ */

export function prefetchWhenIdle(data, slugs) {
    if (!data || !Array.isArray(slugs) || !slugs.length) { return; }
    try {
        const conn = navigator.connection;
        if (conn && (conn.saveData || /(^|-)2g$/.test(conn.effectiveType || ''))) { return; }
    } catch (e) { /* 无 navigator.connection */ }
    const run = () => {
        data.getInfos(slugs).catch(() => { /* 预取失败静默，正式加载时再处理 */ });
    };
    if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(run, { timeout: 2000 });
    } else {
        window.setTimeout(run, 800);
    }
}
