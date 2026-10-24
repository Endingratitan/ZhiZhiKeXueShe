/* ============================================================
   致知科学社 · 二维码悬停弹窗（纯手搓 · 零依赖）
   目录：assets/js/club-info/（与 fill-club-info.js 同目录）
   ------------------------------------------------------------
   触发点：fill-club-info.js 渲染出的、带 data-club-qr 的元素（点划线名称所在的那一行）
   交互（按需求实现）：
     - 鼠标移到触发点上 → 弹窗出现；移走 → 消失
     - 点击触发点 → 弹窗固定显示，鼠标移走也不消失；再点一次取消固定
     - 点击其他区域 / 按 Esc → 消失
     - 键盘 Tab 聚焦到触发点也会显示（可访问性）
   实现要点：
     - 弹窗只建一次，挂到 <body>，用 position:absolute + 页面坐标定位（随页面滚动自然跟随，不需要滚动监听）
     - 弹窗在触发点下方；下方空间不够时自动翻到上方；左右做视口夹紧
     - 鼠标可以从触发点移进弹窗（有 180ms 延迟关闭 + 进入弹窗取消关闭），方便手机/鼠标两种操作
     - 颜色走站点 CSS 变量（--line/--muted/--shadow-md），但图片底色恒为白色（二维码需要浅色静区）
   数据：可在 club-info.json 的 ui 里调 qrSize（弹窗内二维码边长，默认 150）
   ============================================================ */
(function () {
    'use strict';

    var POPUP_ID = 'club-qr-popup';
    var SHOW_DELAY = 90;    // 移入后延迟显示，避免掠过时闪烁
    var HIDE_DELAY = 180;   // 移出后延迟关闭，允许鼠标移进弹窗

    var popup = null;       // 弹窗元素
    var popupImg = null;
    var popupLink = null;   // 图片外链（点击看大图）
    var popupCap = null;
    var popupOpen = null;   // 「查看大图」
    var popupDown = null;   // 「下载图片」
    var current = null;     // 当前触发元素
    var pinned = null;      // 被点击固定的触发元素
    var showTimer = null;
    var hideTimer = null;

    function mkBtn(text, title) {
        var b = document.createElement('a');
        b.textContent = text;
        if (title) { b.title = title; }
        b.style.cssText = 'flex:1 1 0;display:block;box-sizing:border-box;padding:5px 8px;border-radius:8px;' +
            'font-size:12px;line-height:1.4;text-align:center;text-decoration:none;cursor:pointer;' +
            'background:var(--accent-soft);color:var(--accent-deep);';
        return b;
    }

    function build(size) {
        if (popup) { return popup; }
        popup = document.createElement('div');
        popup.id = POPUP_ID;
        popup.setAttribute('role', 'dialog');
        popup.style.cssText = 'position:absolute;z-index:9999;display:none;' +
            'box-sizing:border-box;padding:10px 10px 8px;text-align:center;' +
            'background:var(--card);border:1px solid var(--line);border-radius:12px;' +
            'box-shadow:var(--shadow-md);';

        popupLink = document.createElement('a');
        popupLink.target = '_blank';
        popupLink.rel = 'noopener';
        popupLink.title = '在新标签页查看大图';
        popupLink.style.cssText = 'display:block;';
        popupImg = document.createElement('img');
        popupImg.width = size;
        popupImg.height = size;
        popupImg.style.cssText = 'display:block;background:#fff;border-radius:6px;';
        popupLink.appendChild(popupImg);
        popup.appendChild(popupLink);

        popupCap = document.createElement('div');
        popupCap.style.cssText = 'margin-top:6px;font-size:12px;line-height:1.5;color:var(--muted);';
        popup.appendChild(popupCap);

        var actions = document.createElement('div');
        actions.style.cssText = 'display:flex;gap:6px;margin-top:8px;';
        popupOpen = mkBtn('查看大图', '在新标签页打开原图');
        popupOpen.target = '_blank';
        popupOpen.rel = 'noopener';
        popupDown = mkBtn('下载图片', '保存到本地');
        actions.appendChild(popupOpen);
        actions.appendChild(popupDown);
        popup.appendChild(actions);

        // 鼠标进入弹窗：取消关闭（方便点到按钮）
        popup.addEventListener('mouseenter', function () { clearTimeout(hideTimer); });
        popup.addEventListener('mouseleave', function () { if (!pinned) { hide(); } });
        document.body.appendChild(popup);
        return popup;
    }

    /* 下载文件名：优先用数据里的 qrFile，否则取图片地址的最后一段 */
    function fileName(trigger, src) {
        var custom = trigger.getAttribute('data-club-qr-file');
        if (custom) { return custom; }
        try {
            var name = decodeURIComponent(new URL(src, location.href).pathname.split('/').pop() || '');
            return name || 'qrcode';
        } catch (e) { return 'qrcode'; }
    }

    function place(trigger) {
        var r = trigger.getBoundingClientRect();
        var pw = popup.offsetWidth;
        var ph = popup.offsetHeight;
        var vw = document.documentElement.clientWidth;
        var vh = document.documentElement.clientHeight;
        var sx = window.pageXOffset;
        var sy = window.pageYOffset;
        var gap = 10;

        var left = r.left + sx;
        if (left + pw > sx + vw - 8) { left = sx + vw - pw - 8; }
        if (left < sx + 8) { left = sx + 8; }

        var top = r.bottom + sy + gap;
        if (r.bottom + gap + ph > vh && r.top - gap - ph > 0) {   // 下方不够 → 翻到上方
            top = r.top + sy - ph - gap;
        }
        popup.style.left = Math.round(left) + 'px';
        popup.style.top = Math.round(top) + 'px';
    }

    function show(trigger, size) {
        if (!trigger || !trigger.getAttribute) { return; }
        var src = srcFor(trigger);
        if (!src) { return; }
        clearTimeout(hideTimer);
        build(size);
        popupImg.src = src;
        popupImg.alt = trigger.getAttribute('data-club-qr-alt') || '二维码';
        popupLink.href = src;
        popupOpen.href = src;
        popupDown.href = src;
        // download 属性在同源时生效（本站二维码都是同源）；跨域时浏览器会改为直接打开
        popupDown.setAttribute('download', fileName(trigger, src));
        var title = trigger.getAttribute('data-club-qr-title');
        popupCap.textContent = title ? title + ' · 扫码' : '扫码';
        popup.style.display = 'block';
        current = trigger;
        place(trigger);   // 先显示再定位（需要真实尺寸）
        place(trigger);
    }

    function hide() {
        clearTimeout(showTimer);
        clearTimeout(hideTimer);
        if (popup) { popup.style.display = 'none'; }
        current = null;
        if (!pinned) { pinned = null; }
    }

    function unpin() { pinned = null; }

    /* 按当前主题选图：暗色主题用 data-club-qr-dark，浅色用 data-club-qr；
       某一侧缺失时用另一侧（例如只有一张图的公众号占位） */
    function isDarkTheme() {
        return document.documentElement.getAttribute('data-theme') === 'dark';
    }
    function srcFor(trigger) {
        var light = trigger.getAttribute('data-club-qr');
        var dark = trigger.getAttribute('data-club-qr-dark');
        return (isDarkTheme() && dark) ? dark : (light || dark);
    }

    function uiSize() {
        var el = document.documentElement.getAttribute('data-club-qr-size');
        return el ? Number(el) : 150;
    }

    function bind() {
        var triggers = document.querySelectorAll('[data-club-qr]');
        for (var i = 0; i < triggers.length; i++) {
            var t = triggers[i];
            if (t.getAttribute('data-club-qr-bound')) { continue; }
            t.setAttribute('data-club-qr-bound', '1');

            t.addEventListener('mouseenter', function () {
                if (pinned) { return; }                       // 已固定时不被悬停干扰
                var self = this;
                clearTimeout(showTimer);
                showTimer = setTimeout(function () { show(self, uiSize()); }, SHOW_DELAY);
            });
            t.addEventListener('mouseleave', function () {
                clearTimeout(showTimer);
                if (pinned === this) { return; }              // 固定的不因移走而消失
                hideTimer = setTimeout(hide, HIDE_DELAY);
            });
            t.addEventListener('focus', function () { if (!pinned) { show(this, uiSize()); } });
            t.addEventListener('click', function (e) {
                e.stopPropagation();                          // 别触发 document 的"点其他区域关闭"
                if (pinned === this) { pinned = null; hide(); return; }   // 再点一次取消固定
                pinned = this;
                show(this, uiSize());
            });
        }
    }

    /* 点击其他区域 → 收起（点弹窗内部不算） */
    document.addEventListener('click', function (e) {
        if (!popup || popup.style.display === 'none') { return; }
        if (popup.contains(e.target)) { return; }
        if (e.target && e.target.closest && e.target.closest('[data-club-qr]')) { return; }
        unpin();
        hide();
    });

    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' || e.key === 'Esc') { unpin(); hide(); }
    });

    window.addEventListener('resize', function () {
        if (popup && popup.style.display !== 'none' && current) { place(current); }
    });

    /* 切换明暗主题时，弹窗里显示的二维码跟着换（亮色/暗色两版） */
    if (window.MutationObserver) {
        new MutationObserver(function () {
            if (popup && popup.style.display !== 'none' && current) { show(current, uiSize()); }
        }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    }

    /* fill-club-info.js 渲染完会派发这个事件；页面直接打开时也绑定一次 */
    document.addEventListener('club-info:filled', bind);
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bind);
    } else {
        bind();
    }
})();
