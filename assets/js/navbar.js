/* ============================================================
   致知科学社 · 导航栏 / 页头脚本（由 index.js 拆分而来）
   ------------------------------------------------------------
   覆盖范围（`<header class="site-header">` 组件的行为）：
   - 页头滚动加深阴影
   - 移动端汉堡菜单开关 + 点击菜单内链接自动收起
   - 滚动时高亮当前区块对应的导航项
   - 待上线导航项（如「科研科普」「HNPT 专栏」）阻止跳转
   - 社团培养下拉菜单（点击外部 / Esc 关闭）
   - 夜间模式切换（localStorage 记忆）
   - 页头下方建设提示条的关闭
   相关文件：样式见 assets/css/navbar.css；
             设置按钮与设置面板见 assets/js/setting.js（自行注入到页头操作组）。
   页面内容级脚本（入场动画、页脚年份）仍在 index.js。
   ============================================================ */
(function () {
    'use strict';

    var header = document.getElementById('siteHeader');
    var navToggle = document.getElementById('navToggle');
    var siteNav = document.getElementById('siteNav');

    /* ---------- 页头滚动加深阴影 ---------- */
    function onScroll() {
        if (header) {
            header.classList.toggle('scrolled', window.scrollY > 8);
        }
    }
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });

    /* ---------- 移动端菜单开关 ---------- */
    if (navToggle && siteNav) {
        navToggle.addEventListener('click', function () {
            var open = siteNav.classList.toggle('open');
            navToggle.classList.toggle('active', open);
            navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        });

        /* 点击菜单内链接后自动收起 */
        siteNav.querySelectorAll('a').forEach(function (link) {
            link.addEventListener('click', function () {
                siteNav.classList.remove('open');
                navToggle.classList.remove('active');
                navToggle.setAttribute('aria-expanded', 'false');
            });
        });
    }

    /* ---------- 滚动时高亮当前区块对应的导航项 ---------- */
    var sections = ['home', 'about', 'activities', 'join', 'contact']
        .map(function (id) { return document.getElementById(id); })
        .filter(Boolean);
    var navLinks = Array.prototype.slice.call(
        document.querySelectorAll('.nav-link[href^="#"]')
    );

    function updateActiveLink() {
        if (!sections.length) { return; }
        var current = sections[0].id;
        var probe = window.scrollY + window.innerHeight * 0.32;
        sections.forEach(function (sec) {
            if (sec.offsetTop <= probe) { current = sec.id; }
        });
        navLinks.forEach(function (link) {
            var isActive = link.getAttribute('href') === '#' + current;
            link.classList.toggle('active', isActive);
        });
    }
    if (navLinks.length && 'IntersectionObserver' in window) {
        window.addEventListener('scroll', updateActiveLink, { passive: true });
        updateActiveLink();
    }

    /* ---------- 待上线导航项（暂无对应页面，仅阻止跳转） ---------- */
    Array.prototype.slice.call(document.querySelectorAll('.nav-link-pending')).forEach(function (a) {
        a.addEventListener('click', function (e) { e.preventDefault(); });
    });

    /* ---------- 社团培养下拉菜单 ---------- */
    Array.prototype.slice.call(document.querySelectorAll('.nav-dropdown')).forEach(function (dd) {
        var btn = dd.querySelector('.nav-dropdown-btn');
        if (!btn) { return; }
        function closeDd() {
            dd.classList.remove('open');
            btn.setAttribute('aria-expanded', 'false');
        }
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            var open = dd.classList.toggle('open');
            btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        });
        dd.querySelectorAll('a').forEach(function (a) {
            a.addEventListener('click', closeDd);
        });
        document.addEventListener('click', function (e) {
            if (!dd.contains(e.target)) { closeDd(); }
        });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') { closeDd(); }
        });
    });

    /* ---------- 夜间模式切换（localStorage 记忆，具体由页头按钮触发） ---------- */
    var themeToggle = document.getElementById('themeToggle');
    var THEME_KEY = 'zzkxs-theme';
    if (themeToggle) {
        function currentTheme() {
            return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
        }
        themeToggle.setAttribute('aria-pressed', String(currentTheme() === 'dark'));
        themeToggle.addEventListener('click', function () {
            var next = currentTheme() === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', next);
            themeToggle.setAttribute('aria-pressed', String(next === 'dark'));
            try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* 隐私模式下忽略 */ }
        });
    }

    /* ---------- 网站建设提示条关闭（不缓存，刷新后重新显示） ---------- */
    var siteBanner = document.querySelector('.site-banner');
    var bannerClose = document.getElementById('bannerClose');
    if (siteBanner && bannerClose) {
        bannerClose.addEventListener('click', function () {
            siteBanner.classList.add('banner-hidden');
        });
    }
})();
