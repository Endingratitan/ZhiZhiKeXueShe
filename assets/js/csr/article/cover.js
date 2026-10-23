/* ============================================================
   CSR · 封面尺寸与收拢动画（assets/js/csr/article/cover.js）
   - watchCover(img)：用图片原始比例直接计算高度（设置 aspect-ratio）
   - resetCover(img)：清理内联 height / transition（切换文章时）
   - collapseCover(page, img, options)：正文就绪后从「满宽自然高度」平滑收拢到
     「固定高度 + 中间裁切」的紧凑形态（.article-loaded），尊重 reduced-motion。
   注：JS 的紧凑高度与 page.css 的 clamp 值保持同步：
       桌面 clamp(200px, 30vh, 340px) / 移动 clamp(180px, 26vh, 260px)
   ============================================================ */

function prefersReducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

/** 比例直接计算：把图片原始的宽高比写到 aspect-ratio，加载阶段高度 = 宽度 × 比例 */
export function watchCover(img) {
    if (!img) { return; }
    const apply = () => {
        if (img.naturalWidth > 0 && img.naturalHeight > 0) {
            img.style.aspectRatio = img.naturalWidth + ' / ' + img.naturalHeight;
        }
    };
    if (img.complete) { apply(); }
    else { img.addEventListener('load', apply, { once: true }); }
}

export function resetCover(img) {
    if (!img) { return; }
    img.style.transition = '';
    img.style.height = '';
    img.style.objectFit = '';
}

function compactHeight() {
    const mobile = window.matchMedia && window.matchMedia('(max-width: 720px)').matches;
    const vh = window.innerHeight || 800;
    const min = mobile ? 180 : 200;
    const max = mobile ? 260 : 340;
    const pref = mobile ? vh * 0.26 : vh * 0.30;
    return Math.round(Math.min(max, Math.max(min, pref)));
}

function waitTransitionEnd(img, ms) {
    return new Promise((resolve) => {
        let done = false;
        const finish = () => {
            if (done) { return; }
            done = true;
            img.removeEventListener('transitionend', onEnd);
            resolve();
        };
        const onEnd = (e) => { if (e.propertyName === 'height') { finish(); } };
        img.addEventListener('transitionend', onEnd);
        setTimeout(finish, ms + 120);
    });
}

/**
 * 正文就绪：封面从自然高度平滑收拢到紧凑裁切形态。
 * @returns {Promise<void>}
 */
export async function collapseCover(page, img, options) {
    const opts = options || {};
    const cancelled = () => !!(opts.isCancelled && opts.isCancelled());
    const done = () => { if (page) { page.classList.add('article-loaded'); } };

    if (!img || cancelled()) { done(); return; }
    if (opts.reducedMotion === true || prefersReducedMotion()) {
        resetCover(img);
        done();
        return;
    }

    const startH = img.getBoundingClientRect().height;
    const target = compactHeight();
    if (!startH || Math.abs(startH - target) < 4 || typeof img.animate !== 'function') {
        resetCover(img);
        done();
        return;
    }

    /* 从当前实际高度出发，object-fit 在动画前切到 cover（裁切中间） */
    img.style.transition = 'none';
    img.style.height = startH + 'px';
    img.style.objectFit = 'cover';
    void img.offsetHeight;
    img.style.transition = 'height 560ms cubic-bezier(0.22, 0.61, 0.36, 1)';
    img.style.height = target + 'px';

    await waitTransitionEnd(img, 560);
    if (cancelled()) { return; }
    done();
    resetCover(img);
}

export default { watchCover, resetCover, collapseCover };
