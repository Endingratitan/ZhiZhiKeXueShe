/* ============================================================
   致知科学社 · 公式导出（formular-publisher）
   ------------------------------------------------------------
   【职责】
   - 把公式数组构建为 JSON 文本，并触发浏览器下载（或复制到剪贴板）；
   - 支持「部分导出」（编辑器中勾选的条目）与「全部导出」，
     导出范围由调用方（formular-editor.js）决定，本模块只负责生成与投递。

   【导出格式】
   - 与官方 assets/data/formulas.json 完全一致的裸数组，
     4 空格缩进，字段顺序固定为：
        formula / name / proposer / theory / note_link
   - 因此导出的文件既能直接替换官方数据文件，也能被
     formular-loader.js 原样读回（往返无损）；
   - note_link 只保留 http(s) 链接；无协议的自动补 https://（与编辑器录入、
     导入模块同一规则），危险协议（javascript: / file: 等）直接丢弃，
     保证导出文件既干净又不丢数据。

   【对外接口】window.ZZKXS.formular.publisher
   - build(entries)                 → JSON 文本（含结尾换行）
   - download(entries, scopeLabel)  → 触发下载，返回文件名
   - copy(entries)                  → Promise<boolean> 复制到剪贴板
   - filename(scopeLabel, count)    → 建议文件名（带日期）

   【说明】
   - 本模块不读写 localStorage、不修改页面结构，属纯导出工具；
   - 由 formular-editor.js 在首次进入「数据」标签时按需加载，
     普通访客若从不打开编辑器，不会产生这次请求。
   ============================================================ */
(function () {
    'use strict';

    /* ---------- 规范化单条：只输出约定字段 ---------- */
    function cleanEntry(e) {
        var src = (e && typeof e === 'object') ? e : {};
        var links = Array.isArray(src.note_link) ? src.note_link : [];
        var outLinks = [];
        links.forEach(function (l) {
            if (!l || typeof l.url !== 'string') { return; }
            var url = l.url.trim();
            if (!url) { return; }
            if (/^[a-z][a-z0-9+.-]*:/i.test(url)) {
                /* 已带协议：只保留 http(s)，其余（javascript:、file: 等）一律丢弃 */
                if (!/^https?:\/\//i.test(url)) { return; }
            } else {
                /* 无协议：与编辑器录入、导入模块的规则保持一致，自动补 https://，
                   避免导出时静默丢链接 */
                url = 'https://' + url;
            }
            outLinks.push({ name: String(l.name || '').trim(), url: url });
        });
        return {
            formula: String(src.formula || ''),
            name: String(src.name || ''),
            proposer: String(src.proposer || ''),
            theory: String(src.theory || ''),
            note_link: outLinks
        };
    }

    /* ---------- 生成 JSON 文本（4 空格缩进，末尾换行） ---------- */
    function build(entries) {
        var list = (Array.isArray(entries) ? entries : []).map(cleanEntry);
        return JSON.stringify(list, null, 4) + '\n';
    }

    /* ---------- 建议文件名：zzkxs-formulas-<范围>-<条数>-<日期>.json ---------- */
    function filename(scopeLabel, count) {
        var d = new Date();
        var pad = function (n) { return (n < 10 ? '0' : '') + n; };
        var stamp = '' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate());
        return 'zzkxs-formulas-' + (scopeLabel || 'export') + '-' + (count || 0) + '-' + stamp + '.json';
    }

    /* ---------- 触发下载（Blob + 隐藏 <a download>） ---------- */
    function download(entries, scopeLabel) {
        var list = Array.isArray(entries) ? entries : [];
        var text = build(list);
        var name = filename(scopeLabel, list.length);
        var blob = new Blob([text], { type: 'application/json;charset=utf-8' });
        var url = URL.createObjectURL(blob);

        var a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        /* 及时释放内存（部分浏览器需要延迟一点再 revoke） */
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        return name;
    }

    /* ---------- 复制到剪贴板（含旧浏览器兜底） ---------- */
    function copy(entries) {
        var text = build(entries);
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            return navigator.clipboard.writeText(text).then(
                function () { return true; },
                function () { return false; }
            );
        }
        try {
            var ta = document.createElement('textarea');
            ta.value = text;
            ta.setAttribute('readonly', 'readonly');
            ta.style.position = 'fixed';
            ta.style.top = '-1000px';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            var ok = document.execCommand('copy');
            document.body.removeChild(ta);
            return Promise.resolve(!!ok);
        } catch (e) {
            return Promise.resolve(false);
        }
    }

    /* ---------- 注册到统一命名空间 ---------- */
    window.ZZKXS = window.ZZKXS || {};
    window.ZZKXS.formular = window.ZZKXS.formular || {};
    window.ZZKXS.formular.publisher = {
        build: build,
        download: download,
        copy: copy,
        filename: filename
    };
})();
