/* ============================================================
   CSR · 文章图片灯箱（影院式 + 缩放滑条）
   - 点击正文 img.art-img 打开全屏图集
   - 右侧小滑条：80% 为默认；向下滑动缩小，向上放大，其它 UI 同步缩小/淡出
   - 滑到顶（100%）：图片全屏、滑条与其它 UI 全部隐藏；点击任意处退回 80%
   - 键盘 Esc / ← / →、按钮、缩略图、触屏左右滑；锁定滚动、恢复焦点
   ============================================================ */

const LOCK_CLASS = 'art-lb-locked';
const DEFAULT_ZOOM = 80;
const FOCUS_ZOOM = 100;
const ZERO = 2;

function pad(n) {
    return String(n).padStart(ZERO, '0');
}

function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
}

function captionOf(img) {
    const fig = img.closest('.art-figure');
    const cap = fig && fig.querySelector('figcaption');
    return (cap && cap.textContent.trim())
        || img.getAttribute('title')
        || img.getAttribute('alt')
        || '';
}

function srcOf(img) {
    return img.currentSrc || img.src || '';
}

function collectImages(container) {
    return Array.from(container.querySelectorAll('img.art-img')).filter((img) => srcOf(img));
}

function makeOverlay() {
    const root = document.createElement('div');
    root.className = 'art-lightbox';
    root.hidden = true;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', '文章图片浏览');
    root.innerHTML = '' +
        '<div class="art-lb-backdrop" aria-hidden="true"></div>' +
        '<div class="art-lb-veil" aria-hidden="true"></div>' +
        '<header class="art-lb-bar">' +
        '<span class="art-lb-brand">致知科学社 · 图集</span>' +
        '<span class="art-lb-counter"><b class="art-lb-current">01</b><span class="art-lb-total">/ 01</span></span>' +
        '<button type="button" class="art-lb-close" aria-label="关闭图片浏览">×</button>' +
        '</header>' +
        '<button type="button" class="art-lb-nav art-lb-prev" aria-label="上一张">←</button>' +
        '<figure class="art-lb-stage"><img class="art-lb-img" alt=""><figcaption class="art-lb-caption"></figcaption></figure>' +
        '<button type="button" class="art-lb-nav art-lb-next" aria-label="下一张">→</button>' +
        '<div class="art-lb-zoom" aria-label="图片缩放">' +
        '<span class="art-lb-zoom-val">80%</span>' +
        '<input class="art-lb-zoom-range" type="range" min="0" max="100" step="1" value="80" aria-label="图片放大程度">' +
        '</div>' +
        '<footer class="art-lb-foot">' +
        '<div class="art-lb-thumbs" aria-label="缩略图"></div>' +
        '<p class="art-lb-hint">ESC 关闭 · ← → 切换 · 点击背景关闭</p>' +
        '</footer>';
    document.body.appendChild(root);
    return root;
}

/**
 * 绑定正文容器（可重复调用；内部只绑一次，图片列表每次打开时重建）。
 * @returns {{open: (index?: number) => void, close: () => void, zoomTo: (value: number) => void}}
 */
export function enhanceLightbox(container) {
    if (!container) { return { open() { }, close() { }, zoomTo() { } }; }
    if (container._lbApi) { return container._lbApi; }

    let root = null;
    let images = [];
    let index = 0;
    let isOpen = false;
    let lastFocus = null;
    let touchStartX = 0;
    const state = { zoom: DEFAULT_ZOOM, focus: false, focusAt: 0 };

    function els() {
        return {
            backdrop: root.querySelector('.art-lb-backdrop'),
            current: root.querySelector('.art-lb-current'),
            total: root.querySelector('.art-lb-total'),
            img: root.querySelector('.art-lb-img'),
            caption: root.querySelector('.art-lb-caption'),
            thumbs: root.querySelector('.art-lb-thumbs'),
            prev: root.querySelector('.art-lb-prev'),
            next: root.querySelector('.art-lb-next'),
            close: root.querySelector('.art-lb-close'),
            zoom: root.querySelector('.art-lb-zoom'),
            zoomRange: root.querySelector('.art-lb-zoom-range'),
            zoomVal: root.querySelector('.art-lb-zoom-val')
        };
    }

    function preload(i) {
        const img = images[i];
        if (!img) { return; }
        const pre = new Image();
        pre.src = srcOf(img);
    }

    /** 缩放：80% = 画面适配；100% = 全屏专注态；低于 80% 为缩小 */
    function applyZoom(value) {
        if (!root) { return; }
        const v = clamp(Number(value) || 0, 0, 100);
        state.zoom = v;
        const e = els();
        if (e.zoomRange) { e.zoomRange.value = String(v); }
        if (e.zoomVal) { e.zoomVal.textContent = v + '%'; }

        const above = clamp((v - DEFAULT_ZOOM) / (FOCUS_ZOOM - DEFAULT_ZOOM), 0, 1);
        const imgScale = v <= DEFAULT_ZOOM
            ? (0.55 + (v / DEFAULT_ZOOM) * 0.45)   /* 0% → 55%，80% → 100% */
            : (1 + above * 0.35);                 /* 80% → 100%，100% 前放大到 135% */
        root.style.setProperty('--lb-img-scale', imgScale.toFixed(3));
        root.style.setProperty('--lb-ui-opacity', String(1 - above * 0.85));
        root.style.setProperty('--lb-ui-scale', String(1 - above * 0.25));

        if (v >= FOCUS_ZOOM) { enterFocus(); }
        else { exitFocus(); }
    }

    function enterFocus() {
        if (!root || state.focus) { return; }
        state.focus = true;
        state.focusAt = performance.now();
        root.classList.add('is-focus');
    }

    function exitFocus() {
        if (!root || !state.focus) { return; }
        state.focus = false;
        root.classList.remove('is-focus');
    }

    function render() {
        const e = els();
        const img = images[index];
        if (!img) { return; }
        const src = srcOf(img);
        e.current.textContent = pad(index + 1);
        e.total.textContent = '/ ' + pad(images.length);
        e.caption.textContent = captionOf(img);
        e.img.alt = img.getAttribute('alt') || '';
        e.img.src = src;
        e.backdrop.style.backgroundImage = 'url("' + src.replace(/"/g, '\\"') + '")';
        const single = images.length < 2;
        e.prev.hidden = single;
        e.next.hidden = single;
        e.thumbs.hidden = single;
        Array.from(e.thumbs.querySelectorAll('img')).forEach((thumb, i) => {
            thumb.classList.toggle('active', i === index);
        });
        preload(index + 1);
        preload(index - 1);
    }

    function buildThumbs() {
        const e = els();
        e.thumbs.innerHTML = images.map((img, i) =>
            '<img class="art-lb-thumb" data-i="' + i + '" src="' + srcOf(img).replace(/"/g, '&quot;') + '" alt="" loading="lazy">'
        ).join('');
    }

    function goTo(i) {
        if (!images.length) { return; }
        index = (i + images.length) % images.length;
        render();
    }

    function onKey(e) {
        if (!isOpen) { return; }
        if (e.key === 'Escape') { e.preventDefault(); close(); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(index - 1); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); goTo(index + 1); }
    }

    function bindOnce() {
        root = makeOverlay();
        const e = els();
        e.close.addEventListener('click', close);
        e.prev.addEventListener('click', () => goTo(index - 1));
        e.next.addEventListener('click', () => goTo(index + 1));
        e.backdrop.addEventListener('click', () => {
            if (state.focus) { return; }   // 专注态由根节点处理“退回 80%”
            close();
        });
        e.thumbs.addEventListener('click', (ev) => {
            const t = ev.target.closest('.art-lb-thumb');
            if (t) { goTo(Number(t.dataset.i) || 0); }
        });
        e.zoomRange.addEventListener('input', (ev) => { applyZoom(ev.target.value); });
        const stage = root.querySelector('.art-lb-stage');
        stage.addEventListener('touchstart', (ev) => {
            touchStartX = ev.touches && ev.touches[0] ? ev.touches[0].clientX : 0;
        }, { passive: true });
        stage.addEventListener('touchend', (ev) => {
            const endX = ev.changedTouches && ev.changedTouches[0] ? ev.changedTouches[0].clientX : 0;
            const dx = endX - touchStartX;
            if (Math.abs(dx) > 48) { goTo(index + (dx < 0 ? 1 : -1)); }
        }, { passive: true });
        /* 专注态：点击任意处退回 80% */
        root.addEventListener('click', (ev) => {
            if (!state.focus) { return; }
            if (performance.now() - state.focusAt < 350) { return; }
            ev.preventDefault();
            applyZoom(DEFAULT_ZOOM);
        });
    }

    function open(start) {
        images = collectImages(container);
        if (!images.length) { return; }
        if (!root) { bindOnce(); }
        index = Math.max(0, Math.min(images.length - 1, Number(start) || 0));
        lastFocus = document.activeElement;
        state.focus = false;
        root.classList.remove('is-focus');
        buildThumbs();
        render();
        applyZoom(DEFAULT_ZOOM);
        root.hidden = false;
        document.body.classList.add(LOCK_CLASS);
        requestAnimationFrame(() => { root.classList.add('open'); });
        document.addEventListener('keydown', onKey, true);
        isOpen = true;
        root.querySelector('.art-lb-close').focus({ preventScroll: true });
    }

    function close() {
        if (!root || !isOpen) { return; }
        isOpen = false;
        document.removeEventListener('keydown', onKey, true);
        root.classList.remove('open');
        document.body.classList.remove(LOCK_CLASS);
        setTimeout(() => {
            if (!isOpen && root) {
                root.hidden = true;
                root.classList.remove('is-focus');
            }
        }, 240);
        if (lastFocus && typeof lastFocus.focus === 'function') {
            lastFocus.focus({ preventScroll: true });
        }
    }

    container.addEventListener('click', (e) => {
        const img = e.target.closest ? e.target.closest('img.art-img') : null;
        if (!img || !container.contains(img)) { return; }
        const list = collectImages(container);
        const i = list.indexOf(img);
        e.preventDefault();
        open(i >= 0 ? i : 0);
    });

    const api = { open, close, zoomTo: (v) => applyZoom(v) };
    container._lbApi = api;
    return api;
}

export default enhanceLightbox;
