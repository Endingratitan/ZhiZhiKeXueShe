/* ============================================================
   CSR · 文章装饰脚本加载器（assets/js/csr/article/decor.js）
   目的：正文渲染完成后再加载装饰性脚本（公式流/设置等），
         未缓存时不抢首屏带宽；已缓存时几乎无感。
   接口：loadDecorScripts(entries, options)
     entries: [
       { type: 'script'|'css', href: '/assets/js/...', check?: () => boolean }
     ]
     options: { delay?: number }
   - 顺序加载（script 间保持声明顺序，便于依赖）
   - 幂等：已注入过的资源跳过；check() 返回 true 也跳过
   - 单个资源失败不影响其它（优雅降级）
   ============================================================ */

const INJECTED_ATTR = 'data-csr-decor';

function alreadyInjected(href) {
    return !!document.querySelector('[' + INJECTED_ATTR + '="' + href.replace(/"/g, '\\"') + '"]');
}

function loadOne(entry) {
    return new Promise((resolve) => {
        try {
            if (entry.check && entry.check()) { resolve(true); return; }
            if (alreadyInjected(entry.href)) { resolve(true); return; }
            const isCss = entry.type === 'css';
            const el = document.createElement(isCss ? 'link' : 'script');
            el.setAttribute(INJECTED_ATTR, entry.href);
            const timer = setTimeout(() => { resolve(false); }, 10000);
            el.onload = () => { clearTimeout(timer); resolve(true); };
            el.onerror = () => { clearTimeout(timer); resolve(false); };
            if (isCss) {
                el.rel = 'stylesheet';
                el.href = entry.href;
            } else {
                el.src = entry.href;
                el.async = false;
            }
            (isCss ? document.head : document.body).appendChild(el);
        } catch (e) {
            resolve(false);
        }
    });
}

/**
 * 空闲时按顺序加载装饰资源。
 * @returns {Promise<void>}
 */
export function loadDecorScripts(entries, options) {
    const list = Array.isArray(entries) ? entries : [];
    const opts = Object.assign({ delay: 0 }, options || {});
    return new Promise((resolve) => {
        const run = async () => {
            for (const entry of list) {
                /* eslint-disable no-await-in-loop */
                await loadOne(entry);
            }
            resolve();
        };
        const idle = window.requestIdleCallback;
        if (idle) {
            idle(() => { run(); }, { timeout: Math.max(opts.delay, 2500) });
        } else {
            setTimeout(() => { run(); }, opts.delay);
        }
    });
}

export default loadDecorScripts;
