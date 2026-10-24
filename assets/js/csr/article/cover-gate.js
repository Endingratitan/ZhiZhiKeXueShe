/* ============================================================
   CSR · 封面 → 正文 展示门（assets/js/csr/article/cover-gate.js）
   展示正文需要三个条件同时成立（AND）：
     1) 用户发生了「向下滚动」操作
     2) cover 底部到达阈值（视口底部上方 12.36%，即 coverRect.bottom <= vh * (1 - 0.1236)）
     3) 正文已经加载/渲染完成
   条件未满足时：正文隐藏，cover 下方显示提示（加载中跳动点 / 继续下滑）。
   条件全部满足时：调用方负责插入正文、收拢封面。
   ============================================================ */

export const COVER_EXIT_BOTTOM_RATIO = 0.1236;

export function createCoverGate(options) {
    const page = options.page;
    const cover = options.cover;
    const bodyReady = options.bodyReady;
    const setStatus = options.setStatus || function () { };
    const reducedMotion = options.reducedMotion === true;
    void reducedMotion;

    let destroyed = false;
    let resolved = false;
    let bodyLoaded = false;
    let bodyResult = null;
    /* 页面可能在 gate 创建前就已经滚动过（info 请求期间）——加载顺序问题：
       用当前滚动位置判断"已向下滚动"，避免丢失早期滚动导致条件永远不满足。 */
    let scrollDownSeen = (window.scrollY || 0) > 2;
    let lastY = window.scrollY || 0;
    let coverReady = false;
    let resolveDone = null;

    const coverImg = cover && cover.querySelector ? cover.querySelector('img') : null;
    function markCoverReady() {
        if (coverReady || destroyed) { return; }
        coverReady = true;
        check();
    }
    if (!coverImg) {
        coverReady = true;
    } else if (coverImg.complete) {
        coverReady = true;   // 加载完成（含失败）都算布局就绪，避免门控永久卡住
    } else {
        coverImg.addEventListener('load', markCoverReady, { once: true });
        coverImg.addEventListener('error', markCoverReady, { once: true });
    }

    const done = new Promise((resolve) => { resolveDone = resolve; });

    function updateHint() {
        if (destroyed || resolved) { return; }
        if (!bodyLoaded) {
            setStatus('loading');
        } else if (!scrollDownSeen) {
            setStatus('向下滚动 · 展开正文 ↓');
        } else if (!thresholdReached()) {
            setStatus('继续向下滚动 · 展开正文 ↓');
        } else {
            setStatus('loading');
        }
    }

    function thresholdReached() {
        if (!coverReady) { return false; }      // 等封面布局就绪，避免图片未加载时高度为 0 提前满足
        if (!cover || !cover.getBoundingClientRect) { return true; }
        const vh = window.innerHeight || 0;
        if (!vh) { return true; }
        const rect = cover.getBoundingClientRect();
        return rect.bottom <= vh * (1 - COVER_EXIT_BOTTOM_RATIO);
    }

    function cleanup() {
        window.removeEventListener('scroll', onScroll);
        window.removeEventListener('resize', check);
        if (coverImg) {
            coverImg.removeEventListener('load', markCoverReady);
            coverImg.removeEventListener('error', markCoverReady);
        }
    }

    function settle(result) {
        if (destroyed || resolved) { return; }
        resolved = true;
        cleanup();
        setStatus('');
        if (page) { page.classList.remove('cover-gated'); }
        if (resolveDone) { resolveDone(result); }
    }

    function check() {
        if (destroyed || resolved) { return; }
        if (scrollDownSeen && thresholdReached() && bodyLoaded) {
            settle(bodyResult);
            return;
        }
        updateHint();
    }

    function onScroll() {
        const y = window.scrollY || 0;
        if (y > lastY + 2) { scrollDownSeen = true; }
        lastY = y;
        check();
    }

    bodyReady.then((result) => {
        bodyResult = result;
        bodyLoaded = true;
        check();
    }).catch((err) => {
        bodyResult = { ok: false, err };
        bodyLoaded = true;
        check();
    });

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', check, { passive: true });
    updateHint();
    check();

    return {
        done,
        destroy() {
            destroyed = true;
            cleanup();
        },
        get state() {
            return { bodyLoaded, scrollDownSeen, thresholdReached: thresholdReached(), resolved };
        }
    };
}

export default createCoverGate;
