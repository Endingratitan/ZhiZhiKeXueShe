/* ============================================================
   news-ar · 文章页逻辑（ESM）
   首屏策略（三条件 AND 后才展示正文）：
   1) 进页立刻并行请求 info.json + article.md
   2) info 先到 → 标题/元信息/大封面先出现（期刊感）
   3) 正文加载中 / 条件未满足时，cover 下方显示提示（加载中跳动点 / 继续下滑）
   4) 展示正文需同时满足：向下滚动操作 + cover 底部到达 6.18% 阈值 + 正文加载完成
   5) 满足后插入正文、收拢封面并保持封面底部视口位置；装饰脚本空闲加载
   - slug：hash 优先，其次 <slug>.html 文件名；无 hash → 列表页
   ============================================================ */

import { renderMarkdown } from '../../assets/js/csr/md/renderer.js';
import { loadInfo, applyInfo } from './info.js';
import { loadDecorScripts } from '../../assets/js/csr/article/decor.js';
import { watchCover, resetCover, collapseCover } from '../../assets/js/csr/article/cover.js';
import { createCoverGate } from '../../assets/js/csr/article/cover-gate.js';

const LIST_HREF = '../news/index.html';
const LIST_LABEL = '← 返回动态列表';
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

const DECOR = [
    { type: 'script', href: '/assets/js/formular/formular-store.js' },
    { type: 'script', href: '/assets/js/formular/formulas.js' }
];

const $ = (id) => document.getElementById(id);

/* 灯箱按需加载：首次点击图片 / 调试参数才下载模块，降低文章页首屏 JS */
let lightboxPromise = null;
function ensureLightbox() {
    if (!lightboxPromise) {
        lightboxPromise = import('../../assets/js/csr/article/lightbox.js').then((mod) => {
            const api = mod.enhanceLightbox($('artBody'));
            window.ZZKXS = window.ZZKXS || {};
            window.ZZKXS.lightbox = api;
            return api;
        }).catch((err) => {
            lightboxPromise = null;
            throw err;
        });
    }
    return lightboxPromise;
}

function bindLightboxLazy() {
    const body = $('artBody');
    if (!body || body._lbLazyBound) { return; }
    body._lbLazyBound = true;
    body.addEventListener('click', (e) => {
        const img = e.target.closest ? e.target.closest('img.art-img') : null;
        if (!img || !body.contains(img)) { return; }
        e.preventDefault();
        const images = Array.from(body.querySelectorAll('img.art-img'));
        const index = images.indexOf(img);
        ensureLightbox().then((api) => api.open(index < 0 ? 0 : index)).catch(() => { });
    });
}
let generation = 0;
let decorStarted = false;
let coverGate = null;

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
    page.classList.remove('cover-gated');
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

async function revealArticle(result, options) {
    const page = $('artPage');
    const cover = $('artCover');
    const myGen = options && options.gen;
    const gated = !!(options && options.gated);

    if (!result || !result.ok) {
        page.classList.remove('cover-gated');
        showError(result && result.err ? result.err : new Error('正文加载失败'));
        return;
    }

    const out = result.out;
    const anchorBottom = (gated && cover) ? cover.getBoundingClientRect().bottom : null;

    $('artBody').innerHTML = out.html;
    bindLightboxLazy();
    page.classList.remove('cover-gated');
    setStatus('');

    const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    await collapseCover(page, $('artCoverImg'), {
        reducedMotion,
        isCancelled: () => myGen !== generation
    });
    if (myGen !== generation) { return; }

    /* 门控解锁后保持封面底部在当前视口位置，避免页面因收拢而突跳 */
    if (anchorBottom !== null && cover) {
        const newBottom = cover.getBoundingClientRect().bottom;
        const delta = newBottom - anchorBottom;
        if (Math.abs(delta) > 1) { window.scrollBy(0, delta); }
    }

    let katexCount = 0;
    if (out.flags.math) { katexCount = await enhanceMath(); }
    if (out.flags.code) {
        /* 只有代码文章才下载代码渲染器 */
        const { enhanceCode } = await import('../../assets/js/csr/code/art-code.js');
        await enhanceCode($('artBody'));
    }
    if (myGen !== generation) { return; }

    page.setAttribute('data-rendered', 'true');
    page.setAttribute('data-katex', String(katexCount));
    page.setAttribute('data-errors', String(out.errors.length));
    page.setAttribute('data-warnings', String(out.warnings.length));
    document.documentElement.setAttribute('data-article-rendered', '1');

    window.ZZKXS = window.ZZKXS || {};
    const lbParams = new URLSearchParams(location.search);
    if (lbParams.get('lightbox') === '1') {
        setTimeout(() => {
            ensureLightbox().then((api) => {
                api.open(0);
                const z = lbParams.get('zoom');
                if (z !== null) { setTimeout(() => api.zoomTo(Number(z)), 160); }
            }).catch(() => { });
        }, 300);
    }
    window.ZZKXS.articleState = {
        slug: page.getAttribute('data-slug') || '',
        title: page.getAttribute('data-title') || '',
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
}

async function renderArticle() {
    const slug = getSlug();
    if (!slug) { location.replace(LIST_HREF); return; }
    if (!SLUG_RE.test(slug)) { showError(new Error('非法文章地址：' + slug)); return; }

    const myGen = ++generation;
    if (coverGate) { coverGate.destroy(); coverGate = null; }
    if (window.ZZKXS && window.ZZKXS.lightbox) { window.ZZKXS.lightbox.close(); }

    const params = new URLSearchParams(location.search);
    const page = $('artPage');
    page.setAttribute('data-rendered', 'false');
    page.classList.remove('article-loaded', 'cover-gated');
    resetCover($('artCoverImg'));
    page.setAttribute('data-slug', slug);
    $('artError').hidden = true;
    $('artBody').innerHTML = '';
    setStatus('loading');
    window.scrollTo(0, 0);

    const bundle = new URL('../../articles/' + slug + '/', location.href).href;
    const infoPromise = loadInfo(bundle);
    const slowMs = Math.max(0, parseInt(params.get('slowbody') || '0', 10) || 0);
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

        const bodyReady = mdPromise.then((md) => ({
            ok: true,
            out: renderMarkdown(md, { baseUrl: bundle })
        })).catch((err) => ({ ok: false, err }));

        const gateOff = params.get('gate') === 'off' || params.get('lightbox') === '1';
        const hasCover = !!info.coverUrl;

        if (!hasCover || gateOff) {
            page.classList.remove('cover-gated');
            const result = await bodyReady;
            if (myGen !== generation) { return; }
            await revealArticle(result, { gated: false, gen: myGen });
            return;
        }

        page.classList.add('cover-gated');
        coverGate = createCoverGate({
            page,
            cover: $('artCover'),
            bodyReady,
            setStatus,
            reducedMotion: window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
        });
        const result = await coverGate.done;
        if (myGen !== generation) { return; }
        await revealArticle(result, { gated: true, gen: myGen });
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
