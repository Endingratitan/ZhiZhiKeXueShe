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

    /* ---------- 防止本文件被重复引入时重复绑定 ---------- */
    if (document.documentElement.hasAttribute('data-navbar-ready')) { return; }
    document.documentElement.setAttribute('data-navbar-ready', '');

    /* ---------- 与「旧缓存脚本」共存：接管被重复绑定的节点 ----------
       背景：GitHub Pages 的静态资源带 10 分钟 max-age，Cloudflare 边缘也会缓存。
       浏览器里可能同时存在「拆分前的 index.js」（它也绑定了 #themeToggle、
       #navToggle、#bannerClose）和新的 navbar.js；而且旧脚本是顶层 IIFE、
       在 navbar.js 之前执行，于是同一个按钮上会有两个 click 处理器，
       切换类/属性的操作被抵消（开→关），表现就是"按钮失灵"。

       做法：绑定前用同结构克隆替换原节点，旧监听器随旧节点一起被丢弃。
       这比在 document 捕获阶段拦截 + stopPropagation() 更轻：
       不需要全局拦截点击事件，也没有每次点击的额外判定开销。
       前提（已核实）：旧脚本在 navbar.js 之前同步绑定。 */
    function takeOver(el) {
        if (!el || !el.parentNode) { return el; }
        var fresh = el.cloneNode(true);
        el.parentNode.replaceChild(fresh, el);
        return fresh;
    }

    var header = document.getElementById('siteHeader');
    var navToggle = takeOver(document.getElementById('navToggle'));
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

    /* ---------- 夜间模式切换（localStorage 记忆，具体由页头按钮触发） ----------
       这里刻意用「document 捕获阶段 + 事件委托 + stopPropagation()」，而不是
       直接在按钮上 addEventListener，原因是兼容浏览器缓存：

       拆分导航栏之前，主题切换代码在 index.js 里，绑定的是同一个 #themeToggle。
       若浏览器仍缓存着那份旧 index.js（GitHub Pages 的静态资源有 10 分钟
       max-age，Cloudflare 边缘也会缓存），页面里就会同时存在两个 click 处理器：
       点一次被切换两次（亮→暗→亮），用户看到的就是"按钮失灵"——而手机端、
       本地开发、以及硬刷新过的浏览器都正常。

       在捕获阶段把事件拦下并停止继续传播后，事件不会再到达元素上的旧处理器，
       因此无论缓存里是新版还是旧版脚本，点击都只切换一次。 */
    var THEME_KEY = 'zzkxs-theme';

    function currentTheme() {
        return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    }

    function applyTheme(next) {
        document.documentElement.setAttribute('data-theme', next);
        var btn = document.getElementById('themeToggle');
        if (btn) { btn.setAttribute('aria-pressed', String(next === 'dark')); }
        try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* 隐私模式下忽略 */ }
    }

    /* ---------- 夜间模式切换（localStorage 记忆，具体由页头按钮触发） ----------
       直接绑在按钮上；按钮先经 takeOver() 换成新节点，
       因此缓存里那份旧 index.js 的重复监听器已经被丢弃（见文件顶部说明）。 */
    var THEME_KEY = 'zzkxs-theme';
    var themeToggle = takeOver(document.getElementById('themeToggle'));

    if (themeToggle) {
        themeToggle.setAttribute('aria-pressed', String(currentTheme() === 'dark'));
        themeToggle.addEventListener('click', function () {
            applyTheme(currentTheme() === 'dark' ? 'light' : 'dark');
        });
    }

    /* ---------- 网站建设提示条关闭（不缓存，刷新后重新显示） ---------- */
    var siteBanner = document.querySelector('.site-banner');
    var bannerClose = takeOver(document.getElementById('bannerClose'));
    if (siteBanner && bannerClose) {
        bannerClose.addEventListener('click', function () {
            siteBanner.classList.add('banner-hidden');
        });
    }
})();
