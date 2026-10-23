/* ============================================================
   article-ar · 文章页逻辑（ESM）
   首屏策略（自然加载，无封面页阶段）：
   1) 进页立刻并行请求 info.json + article.md
   2) info 先到 → 标题/元信息/大封面先出现（期刊感）
   3) 正文未就绪时，cover 下方显示小字「正文加载中…」
   4) 正文就绪 → 直接插入正文并增强 KaTeX/代码；装饰脚本空闲加载
   - slug：hash 优先，其次 <slug>.html 文件名；无 hash → 列表页
   ============================================================ */

import { renderMarkdown } from '../../assets/js/csr/md/renderer.js';
import { enhanceCode } from '../../assets/js/csr/code/art-code.js';
import { loadInfo, applyInfo } from './info.js';
import { loadDecorScripts } from '../../assets/js/csr/article/decor.js';
import { watchCover, resetCover, collapseCover } from '../../assets/js/csr/article/cover.js';

const LIST_HREF = '../news/index.html';
const LIST_LABEL = '← 返回列表';
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

const DECOR = [
    { type: 'script', href: '/assets/js/formular/formular-store.js' },
    { type: 'script', href: '/assets/js/formular/formulas.js' },
    { type: 'script', href: '/assets/js/setting.js' }
];

const $ = (id) => document.getElementById(id);
let generation = 0;
let decorStarted = false;

function getSlug() {
    let raw = location.hash.replace(/^#\/?/, '');
    if (raw) {
        try { raw = decodeURIComponent(raw); } catch (e) { /* 保留原文 */ }
        return raw.trim();
    }
    const base = (location.pathname.split('/').pop() || '');
    const m = /^([a-z0-9][a-z0-9-]*)\.html$/.exec(base);
    return (m && m[1] !== 'article') ? m[1] : '';
}

async function fetchText(url) {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) { throw new Error('article.md HTTP ' + res.status); }
    return res.text();
}

function setStatus(text) {
    const status = $('artStatus');
    if (text === 'loading') {
        status.innerHTML = '正文加载中<span class="art-dots" aria-hidden="true"><i></i><i></i><i></i></span>';
        status.hidden = false;
        return;
    }
    status.textContent = text || '';
    status.hidden = !text;
}

function showError(err) {
    const page = $('artPage');
    page.setAttribute('data-rendered', 'false');
    const box = $('artError');
    box.hidden = false;
    box.textContent = '文章加载失败：' + (err && err.message ? err.message : String(err));
    const link = document.createElement('a');
    link.href = LIST_HREF;
    link.textContent = ' 返回列表 →';
    link.className = 'art-back';
    box.appendChild(link);
    setStatus('');
}

/* 加载结束后把视角拉回封面：封面顶部对齐固定头部下方，
   给用户看到收拢后的 cover，而不是直接落到正文里。 */
function pullBackToCover(coverEl, scrollBefore) {
    if (!coverEl || scrollBefore < 20) { return; }
    const top = coverEl.getBoundingClientRect().top + window.scrollY;
    const target = Math.max(0, Math.round(top - 112));
    if (Math.abs(window.scrollY - target) < 24) { return; }
    window.scrollTo({ top: target, behavior: 'smooth' });
}

async function enhanceMath() {
    const els = Array.from(document.querySelectorAll('#artBody .art-math'));
    if (!els.length) { return 0; }
    try {
        const deps = window.ZZKXS && window.ZZKXS.deps;
        if (!deps || typeof deps.katex !== 'function') { return 0; }
        const ok = await deps.katex();
        if (!ok || !window.katex) { return 0; }
        els.forEach((el) => {
            try {
                window.katex.render(el.textContent, el, {
                    displayMode: el.getAttribute('data-display') === '1',
                    throwOnError: false,
                    strict: false
                });
            } catch (e) { /* 单条失败保留源码 */ }
        });
        return document.querySelectorAll('#artBody .katex').length;
    } catch (e) {
        return 0;
    }
}

async function renderArticle() {
    const slug = getSlug();
    if (!slug) { location.replace(LIST_HREF); return; }
    if (!SLUG_RE.test(slug)) { showError(new Error('非法文章地址：' + slug)); return; }

    const myGen = ++generation;
    const page = $('artPage');
    page.setAttribute('data-rendered', 'false');
    page.classList.remove('article-loaded');
    resetCover($('artCoverImg'));
    page.setAttribute('data-slug', slug);
    $('artError').hidden = true;
    $('artBody').innerHTML = '';
    setStatus('loading');
    window.scrollTo(0, 0);

    const bundle = new URL('../../articles/' + slug + '/', location.href).href;
    /* 进页即并行请求：标题/封面先到，正文在后台加载 */
    const infoPromise = loadInfo(bundle);
    /* 调试：?slowbody=<ms> 显式放慢正文，便于观察封面下方的加载提示 */
    const slowMs = Math.max(0, parseInt(new URLSearchParams(location.search).get('slowbody') || '0', 10) || 0);
    let mdPromise = fetchText(bundle + 'article.md');
    if (slowMs > 0) {
        mdPromise = mdPromise.then((md) => new Promise((resolve) => setTimeout(() => resolve(md), slowMs)));
    }

    try {
        const info = await infoPromise;
        if (myGen !== generation) { return; }
        applyInfo(info, { backHref: LIST_HREF, backLabel: LIST_LABEL });
        watchCover($('artCoverImg'));
        page.setAttribute('data-title', info.title);

        const md = await mdPromise;
        if (myGen !== generation) { return; }
        const out = renderMarkdown(md, { baseUrl: bundle });

        const scrollBefore = window.scrollY;
        $('artBody').innerHTML = out.html;
        setStatus('');
        const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        void collapseCover(page, $('artCoverImg'), {
            reducedMotion,
            isCancelled: () => myGen !== generation
        }).then(() => {
            if (myGen === generation) { pullBackToCover($('artCover'), scrollBefore); }
        });

        let katexCount = 0;
        if (out.flags.math) { katexCount = await enhanceMath(); }
        if (out.flags.code) { await enhanceCode($('artBody')); }
        if (myGen !== generation) { return; }

        setStatus('');
        page.setAttribute('data-rendered', 'true');
        page.setAttribute('data-katex', String(katexCount));
        page.setAttribute('data-errors', String(out.errors.length));
        page.setAttribute('data-warnings', String(out.warnings.length));
        document.documentElement.setAttribute('data-article-rendered', '1');

        window.ZZKXS = window.ZZKXS || {};
        window.ZZKXS.articleState = {
            slug,
            title: info.title,
            flags: out.flags,
            errors: out.errors,
            warnings: out.warnings,
            katex: katexCount,
            rendered: true
        };
        if (out.warnings.length) { console.info('[article] warnings', out.warnings); }
        if (out.errors.length) { console.warn('[article] errors', out.errors); }

        if (!decorStarted) {
            decorStarted = true;
            loadDecorScripts(DECOR);
        }
    } catch (err) {
        if (myGen !== generation) { return; }
        showError(err);
    }
}

function init() {
    const back = $('artBack');
    if (back) { back.href = LIST_HREF; back.textContent = LIST_LABEL; }
    renderArticle();
    window.addEventListener('hashchange', renderArticle);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
    init();
}
