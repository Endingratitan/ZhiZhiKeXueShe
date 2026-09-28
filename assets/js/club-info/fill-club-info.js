/* ============================================================
   致知科学社 · 社团信息填充（纯手搓 · 零依赖）
   目录：assets/js/club-info/（本文件与 club-QRcode.js 同目录）
   ------------------------------------------------------------
   职责：读取 assets/data/club-info.json，把值填入页面里带标记的元素
   数据源：.../assets/data/club-info.json（由本脚本自身 URL 推算，任何页面深度都能用）

   页面里的标记：
     <span data-club="email.address">contact@hunnucupt.top</span>
         → 覆盖文本
     <a data-club-href="email.address" data-club-href-prefix="mailto:"
        href="mailto:contact@hunnucupt.top" data-club="email.address">…</a>
         → 覆盖 href 与文本
     <img data-club-img="mapImage" data-club-img-size="360" alt="…">
         → 单独一张图（元素本身就是 <img>）
     <p data-club-list="groups">…</p>
         → 数组渲染；项带 qr 字段时渲染为「加粗名称 + 次级说明」的紧凑文字行，
           二维码地址写进 data-club-qr（不直接显示图片），由 club-QRcode.js 负责悬停弹窗

   设计取舍：HTML 里保留可读兜底文字；只用 textContent / createTextNode；主题色走 CSS 变量。
   已拆分出去的脚本：
     - 二维码悬停弹窗 → assets/js/club-info/club-QRcode.js
     - 导航栏 / 页头行为 → assets/js/navbar.js
     - 页面内容（入场动画、页脚年份）→ assets/js/index.js
     - 公式流、编辑器 → assets/js/formular/ ；设置面板 → assets/js/setting.js
   ============================================================ */
(function () {
    'use strict';

    /* 用脚本自身地址推算：.../assets/js/club-info/fill-club-info.js
       → 数据 .../assets/data/club-info.json ；站点根 .../ */
    var self = document.currentScript;
    var DATA_URL = self
        ? new URL('../../data/club-info.json', self.src).href
        : 'assets/data/club-info.json';
    var SITE_ROOT = self ? new URL('../../../', self.src).href : '';

    /* 图片地址：完整 URL / 根绝对 / data: 原样，其余按"站点根相对"补全 */
    function resolveUrl(p) {
        if (!p) { return ''; }
        var s = String(p);
        if (/^[a-z][a-z0-9+.-]*:/i.test(s) || s.indexOf('//') === 0 || s.charAt(0) === '/') { return s; }
        return SITE_ROOT + s;
    }

    /* 按 "a.b.c" 取值 */
    function pick(obj, path) {
        if (!path) { return undefined; }
        var cur = obj;
        var keys = String(path).split('.');
        for (var i = 0; i < keys.length; i++) {
            if (cur === null || cur === undefined) { return undefined; }
            cur = cur[keys[i]];
        }
        return cur;
    }

    function asText(value) {
        if (value === undefined || value === null) { return ''; }
        if (Array.isArray(value)) { return value.join(' / '); }
        if (typeof value === 'object') { return value.address || value.name || ''; }
        return String(value);
    }

    /* 文本填充 */
    function fillText(data) {
        var nodes = document.querySelectorAll('[data-club]');
        for (var i = 0; i < nodes.length; i++) {
            var text = asText(pick(data, nodes[i].getAttribute('data-club')));
            if (text) { nodes[i].textContent = text; }
        }
    }

    /* 链接填充 */
    function fillHref(data) {
        var nodes = document.querySelectorAll('[data-club-href]');
        for (var i = 0; i < nodes.length; i++) {
            var value = asText(pick(data, nodes[i].getAttribute('data-club-href')));
            if (!value) { continue; }
            var prefix = nodes[i].getAttribute('data-club-href-prefix') || '';
            nodes[i].setAttribute('href', prefix + value);
        }
    }

    /* 单张图片填充 */
    function fillImg(data) {
        var nodes = document.querySelectorAll('[data-club-img]');
        for (var i = 0; i < nodes.length; i++) {
            var el = nodes[i];
            var src = pick(data, el.getAttribute('data-club-img'));
            if (!src) { continue; }
            el.setAttribute('src', resolveUrl(src));
            var altPath = el.getAttribute('data-club-img-alt');
            if (altPath) { el.setAttribute('alt', asText(pick(data, altPath))); }
            var size = el.getAttribute('data-club-img-size');
            if (size) { el.setAttribute('width', size); el.setAttribute('height', size); }
            el.style.display = 'block';
        }
    }

    /* 小图标（内联 SVG，随文字颜色走，无需额外图片资源）
       在 club-info.json 的群项里写 "icon": "chat" / "users" 即可 */
    var ICONS = {
        chat: '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>',
        users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
        qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14h1M14 20h1M18 18h3v3h-3z"/>'
    };

    function makeIcon(name) {
        var path = ICONS[name];
        if (!path) { return null; }
        var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('width', '15');
        svg.setAttribute('height', '15');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor');
        svg.setAttribute('stroke-width', '1.8');
        svg.setAttribute('stroke-linecap', 'round');
        svg.setAttribute('stroke-linejoin', 'round');
        svg.setAttribute('aria-hidden', 'true');
        svg.style.cssText = 'flex:0 0 auto;margin-right:5px;vertical-align:-2px;';
        svg.innerHTML = path;
        return svg;
    }

    /* 一个填色块（span）：图标 + 名称 + 说明；带 qr 时整个色块就是二维码触发点
       —— 样式走站点 CSS 变量，明暗主题自适应 */
    function groupTile(item, ui) {
        var tile = document.createElement('span');
        tile.style.cssText = 'display:block;box-sizing:border-box;' +
            'flex:1 1 calc(50% - ' + Math.round((ui.groupGap || 8) / 2) + 'px);' +
            'min-width:' + (ui.groupMinWidth || 150) + 'px;' +
            'padding:9px 11px;border-radius:12px;border:1px solid transparent;' +
            'background:var(--accent-soft);' +
            'transition:border-color .18s,transform .18s;';

        if (item.name) {
            var nameRow = document.createElement('span');
            nameRow.style.cssText = 'display:flex;align-items:center;font-weight:600;font-size:13.5px;' +
                'line-height:1.45;color:var(--accent-deep);';
            var icon = makeIcon(item.icon);
            if (icon) { nameRow.appendChild(icon); }
            var nm = document.createElement('span');
            nm.textContent = item.name;
            nameRow.appendChild(nm);
            tile.appendChild(nameRow);
        }
        if (item.desc) {
            var ds = document.createElement('span');
            ds.style.cssText = 'display:block;font-size:12px;line-height:1.55;color:var(--muted);margin-top:3px;';
            ds.textContent = item.desc;
            tile.appendChild(ds);
        }

        if (item.qr) {
            tile.style.cursor = 'pointer';
            tile.setAttribute('data-club-qr', resolveUrl(item.qr));
            if (item.qrDark) { tile.setAttribute('data-club-qr-dark', resolveUrl(item.qrDark)); }
            tile.setAttribute('data-club-qr-alt', item.qrAlt || ((item.name || '') + '二维码'));
            tile.setAttribute('data-club-qr-title', item.name || '');
            if (item.qrFile) { tile.setAttribute('data-club-qr-file', item.qrFile); }
            tile.setAttribute('role', 'button');
            tile.setAttribute('tabindex', '0');
            tile.setAttribute('aria-haspopup', 'dialog');
            tile.addEventListener('mouseenter', function () { tile.style.borderColor = 'var(--accent)'; });
            tile.addEventListener('mouseleave', function () {
                tile.style.borderColor = 'transparent';
                tile.style.transform = 'none';
            });
            tile.addEventListener('focus', function () { tile.style.borderColor = 'var(--accent)'; });
            tile.addEventListener('blur', function () { tile.style.borderColor = 'transparent'; });
        }
        return tile;
    }

    /* 列表填充：数组 → 色块网格（默认两个一排，容器窄了自动变一排；
       没有 qr 的项退化成普通文字行） */
    function fillList(data, ui) {
        var nodes = document.querySelectorAll('[data-club-list]');
        for (var i = 0; i < nodes.length; i++) {
            var list = pick(data, nodes[i].getAttribute('data-club-list'));
            if (!Array.isArray(list) || !list.length) { continue; }
            var el = nodes[i];
            el.textContent = '';
            var hasTile = false;
            for (var j = 0; j < list.length; j++) {
                var item = list[j];
                var isObj = !!(item && typeof item === 'object');
                if (isObj) {
                    el.appendChild(groupTile(item, ui));
                    hasTile = true;
                    continue;
                }
                var line = asText(item);
                if (j) { el.appendChild(document.createElement('br')); }
                el.appendChild(document.createTextNode(line));
            }
            if (hasTile) {
                // 让文字块占满整张卡片（原本被父级 flex 收缩到只剩内容宽），色块才有空间两列排
                if (el.parentElement) {
                    el.parentElement.style.flex = '1 1 auto';
                    el.parentElement.style.minWidth = '0';
                }
                el.style.display = 'flex';
                el.style.flexWrap = 'wrap';
                el.style.gap = (ui.groupGap || 8) + 'px';
                el.style.width = '100%';
                el.style.marginTop = '6px';
            }
            document.dispatchEvent(new CustomEvent('club-info:filled'));
        }
    }

    function run() {
        if (!window.fetch) { return; }
        fetch(DATA_URL, { cache: 'no-cache' })
            .then(function (res) {
                if (!res.ok) { throw new Error('HTTP ' + res.status); }
                return res.json();
            })
            .then(function (data) {
                var ui = { rowGap: 8, groupGap: 8, groupMinWidth: 150 };
                if (data && data.ui && typeof data.ui === 'object') {
                    for (var k in data.ui) { if (k.charAt(0) !== '_') { ui[k] = data.ui[k]; } }
                }
                fillText(data);
                fillHref(data);
                fillImg(data);
                fillList(data, ui);
                // 把弹窗尺寸传给 club-QRcode.js（避免两个脚本各读一次数据）
                document.documentElement.setAttribute('data-club-qr-size', String(Number(ui.qrSize) || 150));
                document.documentElement.setAttribute('data-club-info', 'ok');
            })
            .catch(function (err) {
                if (window.console && console.warn) {
                    console.warn('[club-info] 读取 ' + DATA_URL + ' 失败，保留页面兜底文字：', err && err.message);
                }
            });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', run);
    } else {
        run();
    }
})();
