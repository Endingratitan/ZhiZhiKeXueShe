/* ============================================================
   致知科学社 · 页面内容脚本（纯手搓 · 零依赖）
   ------------------------------------------------------------
   职责：与「页面内容」相关的通用行为
   - 入场动画（IntersectionObserver，无兼容则直接显示）
   - 页脚年份自动更新
   已拆分出去的脚本：
   - 导航栏 / 页头行为（滚动阴影、汉堡菜单、下拉菜单、待上线项、夜间模式、提示条）
     → assets/js/navbar.js
   - 公式流、编辑器、导出导入 → assets/js/formular/
   - 设置面板 → assets/js/setting.js
   ============================================================ */
(function () {
    'use strict';

    /* ---------- 入场动画（IntersectionObserver，无兼容则直接显示） ---------- */
    var reveals = document.querySelectorAll('.reveal');
    if ('IntersectionObserver' in window) {
        var io = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (entry.isIntersecting) {
                    entry.target.classList.add('visible');
                    io.unobserve(entry.target);
                }
            });
        }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });
        reveals.forEach(function (el) { io.observe(el); });
    } else {
        reveals.forEach(function (el) { el.classList.add('visible'); });
    }

    /* ---------- 页脚年份 ---------- */
    var yearEl = document.getElementById('year');
    if (yearEl) {
        yearEl.textContent = String(new Date().getFullYear());
    }
})();
