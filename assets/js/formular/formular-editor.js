/* ============================================================
   致知科学社 · 公式编辑器（formular-editor）
   ------------------------------------------------------------
   【职责】
   - 公式库编辑：公式条目增删改 + note_link 多链接管理；
   - 显示设置：流速（统一/各自随机）、字号、密度；
   - 所有修改通过 window.ZZKXS.formular API 提交，由 formulas.js
     统一负责 localStorage 持久化与公式流重渲染——本文件不直接
     触碰任何存储键；
   - 通过 API.openEditor 注册打开函数，供 setting.js 的
     「公式编辑器」入口调用。

   【面板结构（三块平级，用顶部标签切换）】
   - 顶部标签栏： 「公式库」 / 「显示设置」 —— 两者同级，
     不再把显示设置塞进单条公式的编辑表单里；
   - 公式库：左侧「搜索 + 列表」，右侧「编辑公式表单」；
   - 显示设置：行式滑杆与模式开关，位于独立标签页；
   - 数据：导出 JSON（全部 / 已勾选）与导入 JSON（追加 / 替换）；
   - 头部左侧「‹ 返回」回到设置面板，右上角「×」直接关闭全部面板。

   【数据模块（懒加载）】
   - 导出、导入分别由同目录的 formular-publisher.js / formular-loader.js 提供；
     仅在用户首次切到「数据」标签（或点击导出/导入）时才注入脚本，
     从不打开编辑器的访客不会产生这两个请求；
   - 本文件只负责界面与调用编排，两个模块内部都不写 localStorage。

   【批量操作】
   - 列表每行左侧为选择框（不再逐行提供删除按钮）；
   - 勾选任意条目后，左栏底部托盘出现「添加 NoteLink」与「删除」两个按钮：
       · 删除 → 二次确认后一次性移除全部勾选条目；
       · 添加 NoteLink → 弹出子窗口，所填链接统一追加到全部勾选条目
         （重复 URL 自动跳过）。
   - 批量操作只改工作副本，仍需点击「保存」写入本地。

   【保存模型（重要）】
   - 公式数据（含 note_link）采用**显式保存**：
       · 任何文本 / 链接改动 → 标记「未保存的修改」（底部状态点变黄）；
       · 点击底部「保存」按钮（或 Ctrl+S）→ 写入 localStorage 并重渲染；
       · 关闭面板时若有未保存修改 → 弹确认框，避免误丢数据。
     注意：链接行输入必须先把值读回工作副本再保存（readForm），
     否则只会写入旧的 note_link —— 这是此前的持久化 bug 修复点。
   - 显示设置采用**即时生效**：滑杆/模式变化后防抖 120ms 写入
     localStorage 并立即作用于公式流（所见即所得）。

   【界面文案约定】
   - 面板内不出现内部术语与技术细节（note_link、localStorage、KaTeX 等），
     统一使用面向访问者的说法：「NoteLink」「自动保存在此浏览器中」等；
   - 「领域」与「年份」拆成两个输入框，内部用 " · " 合并为 theory，
     载入时再按 " · " 拆回两个框，保证全站「·」风格统一。

   【安全】
   - 所有用户输入只经 textContent / KaTeX 渲染进入 DOM，杜绝 XSS；
   - note_link 的 URL 仅接受 http(s)://，未带协议时自动补 https://。
   ============================================================ */
(function () {
    'use strict';

    var API = (window.ZZKXS && window.ZZKXS.formular) || null;
    if (!API) {
        console.warn('[formular-editor] window.ZZKXS.formular 不可用（formulas.js 未加载？），编辑器停用');
        return;
    }

    /* ============================================================
       一、状态
       ============================================================ */
    var workData = [];      // 工作副本（打开时深拷贝，保存时写回）
    var selected = -1;      // 当前选中条目下标
    var query = '';         // 列表搜索关键字
    var dirty = false;      // 是否有未保存的公式数据修改
    var tab = 'library';    // 当前标签：library | settings
    var mode = 'random';    // 速度模式
    var previewTimer = null;// 预览防抖
    var uiTimer = null;     // 显示设置防抖
    var checked = [];       // 批量勾选的下标集合（列表选择框）
    var exportScope = 'all';    // 数据标签：导出范围 all | selected
    var importMode = 'append';  // 数据标签：导入方式 append | replace
    var dataQuery = '';         // 数据标签：勾选栏内的搜索关键字
    var modulesLoaded = null;   // publisher / loader 懒加载 Promise

    /* ============================================================
       一·二、按需加载数据模块（formular-publisher / formular-loader）
       ============================================================ */
    /* 编辑器脚本自身目录：currentScript 仅在脚本执行期有效，故立即取出并缓存 */
    var SELF_BASE = (function () {
        var s = document.currentScript;
        if (!s || !s.src) {
            var all = document.getElementsByTagName('script');
            for (var i = 0; i < all.length; i++) {
                if (all[i].src && all[i].src.indexOf('formular-editor.js') !== -1) { s = all[i]; break; }
            }
        }
        return (s && s.src) ? s.src.replace(/[^/]*$/, '') : '';
    })();

    function loadScriptOnce(src) {
        return new Promise(function (resolve) {
            var s = document.createElement('script');
            s.src = src;
            s.async = true;
            s.onload = function () { resolve(true); };
            s.onerror = function () { resolve(false); };   // 失败不抛异常，交由调用方提示
            document.head.appendChild(s);
        });
    }

    /* 首次需要时加载两个模块（已注入过则直接复用） */
    function ensureDataModules() {
        if (modulesLoaded) { return modulesLoaded; }
        var has = function (name) {
            return !!(window.ZZKXS && window.ZZKXS.formular && window.ZZKXS.formular[name]);
        };
        modulesLoaded = Promise.all([
            has('publisher') ? true : loadScriptOnce(SELF_BASE + 'formular-publisher.js'),
            has('loader') ? true : loadScriptOnce(SELF_BASE + 'formular-loader.js')
        ]).then(function () {
            return !!(has('publisher') && has('loader'));
        });
        return modulesLoaded;
    }

    /* 统一入口：模块就绪后执行 fn；失败时给出可见提示而不是静默失败 */
    function withDataModules(fn) {
        ensureDataModules().then(function (ok) {
            if (!ok) {
                setDataStatus('数据模块加载失败，请检查网络或刷新后重试。', true);
                return;
            }
            fn();
        });
    }

    /* ============================================================
       二、工具
       ============================================================ */
    function deepCopy(v) { return JSON.parse(JSON.stringify(v)); }

    function normalizeEntry(e) {
        var links = Array.isArray(e && e.note_link)
            ? e.note_link.map(function (l) {
                return { name: String((l && l.name) || ''), url: String((l && l.url) || '') };
            })
            : [];
        return {
            formula: String((e && e.formula) || ''),
            name: String((e && e.name) || ''),
            proposer: String((e && e.proposer) || ''),
            theory: String((e && e.theory) || ''),
            note_link: links
        };
    }

    function normalizeData(arr) {
        if (!Array.isArray(arr)) { return []; }
        return arr.map(normalizeEntry);
    }

    function nowTime() { return new Date().toTimeString().slice(0, 8); }

    /* 领域 + 年份 → 内部 theory（两侧都有时用 " · " 连接，缺失一侧则只留另一侧） */
    function joinTheory(field, year) {
        var a = String(field == null ? '' : field).trim();
        var b = String(year == null ? '' : year).trim();
        if (a && b) { return a + ' · ' + b; }
        return a || b;
    }

    /* 内部 theory → 两个输入框（兼容历史数据的 '/' 与多段分隔） */
    function splitTheory(theory) {
        var t = String(theory == null ? '' : theory).trim();
        if (!t) { return { field: '', year: '' }; }
        var parts = t.split('·');
        if (parts.length === 1) { return { field: t, year: '' }; }
        return { field: parts[0].trim(), year: parts.slice(1).join('·').trim() };
    }

    /* ============================================================
       三、DOM 引用与构建
       ============================================================ */
    var overlay, tabBtns, panes = {}, countEl, hintEl;
    var listEl, searchEl, addBtn;
    var previewEl, errEl, fFormula, fName, fProposer, fField, fYear, linksBox, linkAddBtn, linksEmpty;
    var sSpeed, sSize, sDensity, vSpeed, vSize, vDensity, vMode, segBtns;
    var statusEl, saveBtn, restoreBtn, closeBtn, backBtn;
    var trayCountEl, trayAllBtn, trayActionsEl, trayLinkBtn, trayDelBtn;
    var subEl, subRowsEl, subCountEl, subErrEl, subOkBtn, subCancelBtn, subAddRowBtn;
    var scopeBtns, scopeCountEl, exportBtn, copyBtn, dropEl, pickBtn, fileInput, importBtns, dataStatusEl;
    var pickWrapEl, pickListEl, pickSearchEl, pickAllBtn, pickNoneBtn;

    function build() {
        overlay = document.createElement('div');
        overlay.className = 'fe-overlay';
        overlay.hidden = true;
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-label', '公式编辑器');
        overlay.innerHTML =
            '<div class="fe-panel">' +

                /* ---- 头部：返回设置 / 标题 / 关闭 ---- */
                '<header class="fe-head">' +
                    '<button type="button" class="fe-back" title="返回设置" aria-label="返回设置">' +
                        '<svg class="fe-back-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>' +
                    '</button>' +
                    '<div class="fe-head-text">' +
                        '<h2 class="fe-title">公式编辑器</h2>' +
                        '<p class="fe-subtitle">修改保存在浏览器本地，可随时恢复官方数据</p>' +
                    '</div>' +
                    '<button type="button" class="fe-x" aria-label="关闭">×</button>' +
                '</header>' +

                /* ---- 平级标签栏：公式库 / 显示设置 ---- */
                '<nav class="fe-tabs" role="tablist" aria-label="编辑器分区">' +
                    '<button type="button" class="fe-tab" data-tab="library" role="tab" aria-selected="true">' +
                        '公式库 <span class="fe-tab-count">0</span>' +
                    '</button>' +
                    '<button type="button" class="fe-tab" data-tab="settings" role="tab" aria-selected="false">显示设置</button>' +
                    '<button type="button" class="fe-tab" data-tab="data" role="tab" aria-selected="false">数据</button>' +
                '</nav>' +

                '<div class="fe-panes">' +

                    /* ---- 分区一：公式库（搜索/列表 + 编辑表单） ---- */
                    '<section class="fe-pane fe-pane-library" data-pane="library" role="tabpanel">' +
                        '<aside class="fe-left">' +
                            '<div class="fe-toolbar">' +
                                '<input class="fe-search" type="search" placeholder="搜索公式、名称或提出者…" aria-label="搜索公式">' +
                                '<button type="button" class="btn btn-primary btn-sm fe-add">＋ 新增</button>' +
                            '</div>' +
                            '<p class="fe-hint" hidden>官方数据已更新，可在底部恢复官方版本。</p>' +
                            '<ul class="fe-list"></ul>' +
                            /* ---- 批量操作托盘：单行，勾选后出现方形按钮 ---- */
                            '<div class="fe-tray" role="toolbar" aria-label="批量选择">' +
                                '<span class="fe-tray-count">未选择公式</span>' +
                                '<span class="fe-tray-spacer"></span>' +
                                '<button type="button" class="fe-tray-all">全选</button>' +
                                '<span class="fe-tray-actions" hidden>' +
                                    '<button type="button" class="fe-act fe-tray-link" title="批量添加 NoteLink" aria-label="批量添加 NoteLink">' +
                                        '<svg class="fe-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>' +
                                    '</button>' +
                                    '<span class="fe-act-sep" aria-hidden="true"></span>' +
                                    '<button type="button" class="fe-act fe-tray-del" title="删除已选公式" aria-label="删除已选公式">' +
                                        '<svg class="fe-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M10 11v6M14 11v6"/></svg>' +
                                    '</button>' +
                                '</span>' +
                            '</div>' +
                        '</aside>' +
                        '<div class="fe-right">' +
                            '<div class="fe-preview-wrap">' +
                                '<span class="fe-preview-label">预览</span>' +
                                '<div class="fe-preview" aria-label="公式预览"></div>' +
                                '<p class="fe-err" role="alert"></p>' +
                            '</div>' +
                            '<label class="fe-field"><span>公式（LaTeX 语法）</span>' +
                                '<input class="fe-input fe-mono fe-f-formula" type="text" spellcheck="false" autocomplete="off">' +
                            '</label>' +
                            '<label class="fe-field"><span>名称</span>' +
                                '<input class="fe-input fe-f-name" type="text" autocomplete="off">' +
                            '</label>' +
                            '<label class="fe-field"><span>提出者</span>' +
                                '<input class="fe-input fe-f-proposer" type="text" autocomplete="off">' +
                            '</label>' +
                            '<div class="fe-row2">' +
                                '<label class="fe-field"><span>领域</span>' +
                                    '<input class="fe-input fe-f-field" type="text" placeholder="如：经典力学" autocomplete="off">' +
                                '</label>' +
                                '<label class="fe-field"><span>年份</span>' +
                                    '<input class="fe-input fe-f-year" type="text" placeholder="如：1687" autocomplete="off">' +
                                '</label>' +
                            '</div>' +
                            '<div class="fe-links">' +
                                '<div class="fe-links-head">' +
                                    '<span class="fe-sec-title">NoteLink</span>' +
                                    '<button type="button" class="btn btn-ghost btn-sm fe-link-add">＋ 添加链接</button>' +
                                '</div>' +
                                '<div class="fe-link-rows"></div>' +
                                '<p class="fe-links-empty">暂无链接。点击「＋ 添加链接」为该公式补充参考笔记或科普文章。</p>' +
                            '</div>' +
                        '</div>' +
                    '</section>' +

                    /* ---- 分区二：显示设置（与公式库平级，单列行式） ---- */
                    '<section class="fe-pane fe-pane-settings" data-pane="settings" role="tabpanel" hidden>' +
                        '<div class="fe-set-list">' +
                            '<div class="fe-set-row" title="每次完整漂浮动画的基准时长（秒），数值越小越快">' +
                                '<span class="fe-set-name">流速</span>' +
                                '<input class="fe-s-speed" type="range" min="8" max="40" step="1" aria-label="流速">' +
                                '<span class="fe-badge fe-v-speed">21s</span>' +
                            '</div>' +
                            '<div class="fe-set-row" title="统一：所有公式同速；随机：以基准时长 ±40% 浮动">' +
                                '<span class="fe-set-name">速度模式</span>' +
                                '<span class="fe-seg fe-seg-speed" role="group" aria-label="速度模式">' +
                                    '<button type="button" data-mode="uniform">全部统一</button>' +
                                    '<button type="button" data-mode="random">各自随机</button>' +
                                '</span>' +
                                '<span class="fe-badge fe-v-mode">随机</span>' +
                            '</div>' +
                            '<div class="fe-set-row" title="调整公式在页面两侧的整体字号">' +
                                '<span class="fe-set-name">字号</span>' +
                                '<input class="fe-s-size" type="range" min="10" max="26" step="1" aria-label="字号">' +
                                '<span class="fe-badge fe-v-size">14px</span>' +
                            '</div>' +
                            '<div class="fe-set-row" title="公式流展示的条数；0 表示隐藏公式流">' +
                                '<span class="fe-set-name">密度</span>' +
                                '<input class="fe-s-density" type="range" min="0" max="100" step="1" aria-label="密度">' +
                                '<span class="fe-badge fe-v-density">100 条</span>' +
                            '</div>' +
                        '</div>' +
                        '<p class="fe-settings-tip">显示设置即时生效，并自动保存在此浏览器中。</p>' +
                    '</section>' +

                    /* ---- 分区三：数据（导出 / 导入 JSON） ---- */
                    '<section class="fe-pane fe-pane-data" data-pane="data" role="tabpanel" hidden>' +
                        '<div class="fe-data-wrap">' +

                            /* 导出 */
                            '<div class="fe-data-block">' +
                                '<div class="fe-data-head"><span class="fe-data-title">导出 JSON</span></div>' +
                                '<div class="fe-set-row">' +
                                    '<span class="fe-set-name">导出范围</span>' +
                                    '<span class="fe-seg fe-scope" role="group" aria-label="导出范围">' +
                                        '<button type="button" data-scope="all">全部</button>' +
                                        '<button type="button" data-scope="selected">已勾选</button>' +
                                    '</span>' +
                                    '<span class="fe-badge fe-scope-count">0 条</span>' +
                                '</div>' +
                                /* 勾选栏：仅在「已勾选」范围下出现，勾选结果与「公式库」共用同一份选择 */
                                '<div class="fe-pick-wrap" hidden>' +
                                    '<div class="fe-pick-head">' +
                                        '<span class="fe-pick-title">勾选要导出的公式</span>' +
                                        '<span class="fe-pick-tools">' +
                                            '<input class="fe-pick-search" type="search" placeholder="搜索…" aria-label="在导出列表中搜索">' +
                                            '<button type="button" class="fe-pick-all">全选</button>' +
                                            '<button type="button" class="fe-pick-none">清空</button>' +
                                        '</span>' +
                                    '</div>' +
                                    '<ul class="fe-pick-list"></ul>' +
                                '</div>' +
                                '<p class="fe-data-desc">导出为与官方一致的 JSON（含 NoteLink），可用于备份、分享，或之后再导入回来。</p>' +
                                '<div class="fe-data-actions">' +
                                    '<button type="button" class="btn btn-primary btn-sm fe-export">下载 JSON</button>' +
                                    '<button type="button" class="btn btn-ghost btn-sm fe-copy">复制到剪贴板</button>' +
                                '</div>' +
                            '</div>' +

                            /* 导入 */
                            '<div class="fe-data-block">' +
                                '<div class="fe-data-head"><span class="fe-data-title">导入 JSON</span></div>' +
                                '<div class="fe-drop">' +
                                    '<p class="fe-drop-text">把 JSON 文件拖到这里，或</p>' +
                                    '<button type="button" class="btn btn-ghost btn-sm fe-pick">选择文件</button>' +
                                    '<input type="file" class="fe-file" accept=".json,application/json" hidden>' +
                                '</div>' +
                                '<div class="fe-set-row">' +
                                    '<span class="fe-set-name">导入方式</span>' +
                                    '<span class="fe-seg fe-import-mode" role="group" aria-label="导入方式">' +
                                        '<button type="button" data-imode="append">追加到现有</button>' +
                                        '<button type="button" data-imode="replace">替换全部</button>' +
                                    '</span>' +
                                '</div>' +
                                '<p class="fe-data-desc">支持本编辑器导出的文件，或符合官方结构的 JSON（数组，或含 formulas / data 数组的对象）。</p>' +
                            '</div>' +
                        '</div>' +
                        '<p class="fe-data-status" role="status"></p>' +
                    '</section>' +
                '</div>' +

                /* ---- 底部操作栏 ---- */
                '<footer class="fe-foot">' +
                    '<span class="fe-status" data-state="saved"></span>' +
                    '<span class="fe-spacer"></span>' +
                    '<button type="button" class="btn btn-ghost btn-sm fe-restore">恢复官方数据</button>' +
                    '<button type="button" class="btn btn-primary btn-sm fe-save" disabled>保存</button>' +
                    '<button type="button" class="btn btn-ghost btn-sm fe-close-btn">关闭</button>' +
                '</footer>' +

                /* ---- 子弹窗：批量添加 NoteLink（层级高于主面板） ---- */
                '<div class="fe-sub" hidden>' +
                    '<div class="fe-sub-panel" role="dialog" aria-modal="true" aria-label="批量添加 NoteLink">' +
                        '<h3 class="fe-sub-title">批量添加 NoteLink</h3>' +
                        '<p class="fe-sub-desc">为已选中的 <b class="fe-sub-count">0</b> 条公式添加以下链接；已存在的相同链接会自动跳过。</p>' +
                        '<div class="fe-sub-rows"></div>' +
                        '<button type="button" class="btn btn-ghost btn-sm fe-sub-addrow">＋ 添加一行</button>' +
                        '<p class="fe-sub-err" role="alert"></p>' +
                        '<div class="fe-sub-foot">' +
                            '<button type="button" class="btn btn-ghost btn-sm fe-sub-cancel">取消</button>' +
                            '<button type="button" class="btn btn-primary btn-sm fe-sub-ok">添加</button>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
            '</div>';
        document.body.appendChild(overlay);

        /* 引用收集 */
        tabBtns = overlay.querySelectorAll('.fe-tab');
        panes.library = overlay.querySelector('[data-pane="library"]');
        panes.settings = overlay.querySelector('[data-pane="settings"]');
        panes.data = overlay.querySelector('[data-pane="data"]');
        countEl = overlay.querySelector('.fe-tab-count');
        hintEl = overlay.querySelector('.fe-hint');
        listEl = overlay.querySelector('.fe-list');
        searchEl = overlay.querySelector('.fe-search');
        addBtn = overlay.querySelector('.fe-add');
        previewEl = overlay.querySelector('.fe-preview');
        errEl = overlay.querySelector('.fe-err');
        fFormula = overlay.querySelector('.fe-f-formula');
        fName = overlay.querySelector('.fe-f-name');
        fProposer = overlay.querySelector('.fe-f-proposer');
        fField = overlay.querySelector('.fe-f-field');
        fYear = overlay.querySelector('.fe-f-year');
        linksBox = overlay.querySelector('.fe-link-rows');
        linkAddBtn = overlay.querySelector('.fe-link-add');
        linksEmpty = overlay.querySelector('.fe-links-empty');
        sSpeed = overlay.querySelector('.fe-s-speed');
        sSize = overlay.querySelector('.fe-s-size');
        sDensity = overlay.querySelector('.fe-s-density');
        vSpeed = overlay.querySelector('.fe-v-speed');
        vSize = overlay.querySelector('.fe-v-size');
        vDensity = overlay.querySelector('.fe-v-density');
        vMode = overlay.querySelector('.fe-v-mode');
        segBtns = overlay.querySelectorAll('.fe-seg-speed button');
        scopeBtns = overlay.querySelectorAll('.fe-scope button');
        scopeCountEl = overlay.querySelector('.fe-scope-count');
        exportBtn = overlay.querySelector('.fe-export');
        copyBtn = overlay.querySelector('.fe-copy');
        dropEl = overlay.querySelector('.fe-drop');
        pickBtn = overlay.querySelector('.fe-pick');
        fileInput = overlay.querySelector('.fe-file');
        importBtns = overlay.querySelectorAll('.fe-import-mode button');
        dataStatusEl = overlay.querySelector('.fe-data-status');
        pickWrapEl = overlay.querySelector('.fe-pick-wrap');
        pickListEl = overlay.querySelector('.fe-pick-list');
        pickSearchEl = overlay.querySelector('.fe-pick-search');
        pickAllBtn = overlay.querySelector('.fe-pick-all');
        pickNoneBtn = overlay.querySelector('.fe-pick-none');
        statusEl = overlay.querySelector('.fe-status');
        saveBtn = overlay.querySelector('.fe-save');
        restoreBtn = overlay.querySelector('.fe-restore');
        closeBtn = overlay.querySelector('.fe-close-btn');
        backBtn = overlay.querySelector('.fe-back');

        /* 批量选择托盘 + 子弹窗引用 */
        trayCountEl = overlay.querySelector('.fe-tray-count');
        trayAllBtn = overlay.querySelector('.fe-tray-all');
        trayActionsEl = overlay.querySelector('.fe-tray-actions');
        trayLinkBtn = overlay.querySelector('.fe-tray-link');
        trayDelBtn = overlay.querySelector('.fe-tray-del');
        subEl = overlay.querySelector('.fe-sub');
        subRowsEl = overlay.querySelector('.fe-sub-rows');
        subCountEl = overlay.querySelector('.fe-sub-count');
        subErrEl = overlay.querySelector('.fe-sub-err');
        subOkBtn = overlay.querySelector('.fe-sub-ok');
        subCancelBtn = overlay.querySelector('.fe-sub-cancel');
        subAddRowBtn = overlay.querySelector('.fe-sub-addrow');

        bindEvents();
    }

    /* ============================================================
       四、状态提示与保存
       ============================================================ */
    function markDirty(text) {
        dirty = true;
        saveBtn.disabled = false;
        statusEl.setAttribute('data-state', 'dirty');
        statusEl.textContent = text || '未保存的修改';
    }

    function markClean(text) {
        dirty = false;
        saveBtn.disabled = true;
        statusEl.setAttribute('data-state', 'saved');
        statusEl.textContent = text || ('已保存 · ' + nowTime());
    }

    /* 保存：先把表单（含 note_link 链接行）读回工作副本，再提交 API */
    function save() {
        readForm();
        API.setCustomData(deepCopy(workData));
        updateDensityMax();
        markClean();
    }

    /* ============================================================
       五、标签切换（公式库 / 显示设置 平级）
       ============================================================ */
    function switchTab(name) {
        tab = (name === 'settings' || name === 'data') ? name : 'library';
        tabBtns.forEach(function (b) {
            var on = b.getAttribute('data-tab') === tab;
            b.classList.toggle('active', on);
            b.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        panes.library.hidden = (tab !== 'library');
        panes.settings.hidden = (tab !== 'settings');
        panes.data.hidden = (tab !== 'data');
        if (tab === 'data') {
            syncDataUI();          // 导出范围与条数随勾选实时反映
            renderPicker();        // 勾选栏（仅在「已勾选」范围下可见）
            ensureDataModules();   // 首次进入才加载导出/导入模块
        }
        if (tab === 'library') {
            renderList();          // 勾选可能在数据标签里被改动过，回到列表时同步
        }
    }

    /* ============================================================
       六、列表渲染与选择
       ============================================================ */
    /* 当前搜索条件下的可见条目下标（勾选与「全选」都以此为准） */
    function visibleIndices() {
        var q = query.trim().toLowerCase();
        var out = [];
        workData.forEach(function (d, i) {
            if (!q || (d.name + ' ' + d.formula + ' ' + d.proposer).toLowerCase().indexOf(q) !== -1) {
                out.push(i);
            }
        });
        return out;
    }

    function renderList() {
        listEl.innerHTML = '';
        countEl.textContent = String(workData.length);

        var filtered = visibleIndices();
        updateTray();
        renderPicker();   // 数据标签的勾选栏与列表共用同一份数据，保持同步

        if (!filtered.length) {
            var empty = document.createElement('li');
            empty.className = 'fe-empty';
            empty.textContent = q ? '无匹配结果' : '暂无公式，点击「＋ 新增」添加';
            listEl.appendChild(empty);
            return;
        }

        filtered.forEach(function (i) {
            var d = workData[i];
            var li = document.createElement('li');
            li.className = 'fe-item' + (i === selected ? ' active' : '');
            li.setAttribute('data-index', i);

            var body = document.createElement('span');
            body.className = 'fe-item-body';

            var name = document.createElement('span');
            name.className = 'fe-item-name';
            name.textContent = d.name || '（未命名）';

            var formula = document.createElement('span');
            formula.className = 'fe-item-formula';
            formula.textContent = d.formula || '（空公式）';

            var badges = document.createElement('span');
            badges.className = 'fe-item-badges';
            if (d.note_link && d.note_link.length) {
                var linkBadge = document.createElement('span');
                linkBadge.className = 'fe-mini-badge';
                linkBadge.textContent = '链接 ' + d.note_link.length;
                badges.appendChild(linkBadge);
            }

            body.appendChild(name);
            body.appendChild(formula);
            body.appendChild(badges);

            /* 选择框：靠右、平时隐藏（悬停该行或已勾选时显示） */
            var box = document.createElement('input');
            box.type = 'checkbox';
            box.className = 'fe-item-check';
            box.checked = isChecked(i);
            box.setAttribute('aria-label', '选择「' + (d.name || '未命名') + '」');
            box.addEventListener('click', function (e) { e.stopPropagation(); }); // 不触发行选中编辑
            box.addEventListener('change', function () { toggleCheck(i); });

            li.appendChild(body);
            li.appendChild(box);   // 选择框靠右
            li.addEventListener('click', function () { select(i); });
            listEl.appendChild(li);
        });
    }

    function select(i) {
        selected = i;
        renderList();
        fillForm();
        setFormEnabled(i !== -1);
    }

    function setFormEnabled(on) {
        [fFormula, fName, fProposer, fField, fYear].forEach(function (el) { el.disabled = !on; });
        linkAddBtn.disabled = !on;
        if (!on) {
            linksBox.innerHTML = '';
            previewEl.textContent = '';
            errEl.textContent = '';
            linksEmpty.hidden = true;
        }
    }

    function addEntry() {
        workData.push({ formula: '', name: '新公式', proposer: '', theory: '', note_link: [] });
        query = '';
        searchEl.value = '';
        renderList();
        select(workData.length - 1);
        markDirty();
        fFormula.focus();
    }

    /* ============================================================
       六·二、批量选择：选择框 → 托盘 → 批量删除 / 批量 NoteLink
       ============================================================ */
    function isChecked(i) { return checked.indexOf(i) !== -1; }

    function toggleCheck(i) {
        var at = checked.indexOf(i);
        if (at === -1) { checked.push(i); } else { checked.splice(at, 1); }
        updateTray();
    }

    /* 勾选 / 取消勾选一组下标（公式库与数据标签的勾选栏共用） */
    function toggleAllFor(indices) {
        var allChecked = indices.length > 0 && indices.every(function (i) { return isChecked(i); });
        if (allChecked) {
            checked = checked.filter(function (i) { return indices.indexOf(i) === -1; });
        } else {
            indices.forEach(function (i) { if (!isChecked(i)) { checked.push(i); } });
        }
    }

    /* 公式库：勾选 / 取消勾选当前可见（搜索过滤后）的全部条目 */
    function toggleCheckAll() {
        toggleAllFor(visibleIndices());
        renderList();
    }

    /* 托盘状态：未勾选时只显示计数与「全选」，勾选后出现两个批量按钮 */
    function updateTray() {
        var n = checked.length;
        trayCountEl.textContent = n ? ('已选 ' + n + ' 项') : '未选择公式';
        trayActionsEl.hidden = n === 0;
        var vis = visibleIndices();
        var allChecked = vis.length > 0 && vis.every(function (i) { return isChecked(i); });
        trayAllBtn.textContent = allChecked ? '取消全选' : '全选';
        syncDataUI();   // 勾选变化同时刷新「数据」标签的导出范围/条数
    }

    /* ---------- 批量删除（二次确认，保存后生效） ---------- */
    function batchDelete() {
        var targets = checked.slice().sort(function (a, b) { return a - b; });
        if (!targets.length) { return; }
        if (!confirm('确定删除已选中的 ' + targets.length + ' 条公式？\n保存后生效；如需找回官方条目，可用底部「恢复官方数据」。')) { return; }
        /* 从后往前删，避免下标位移 */
        for (var k = targets.length - 1; k >= 0; k--) { workData.splice(targets[k], 1); }
        checked = [];
        selected = -1;
        renderList();
        updateDensityMax();
        if (workData.length) { select(Math.min(targets[0], workData.length - 1)); } else { setFormEnabled(false); }
        markDirty('已删除 ' + targets.length + ' 条公式，请点击保存');
    }

    /* ---------- 批量 NoteLink 子弹窗 ---------- */
    function makeDialogLinkRow(l) {
        var row = document.createElement('div');
        row.className = 'fe-link-row';

        var name = document.createElement('input');
        name.type = 'text';
        name.className = 'fe-input fe-link-name';
        name.placeholder = '链接名称（可留空）';
        name.value = l.name || '';

        var url = document.createElement('input');
        url.type = 'text';
        url.className = 'fe-input fe-mono fe-link-url';
        url.placeholder = 'https://…';
        url.value = l.url || '';

        var del = document.createElement('button');
        del.type = 'button';
        del.className = 'fe-link-del';
        del.setAttribute('aria-label', '删除该行');
        del.textContent = '×';
        del.addEventListener('click', function () { if (row.parentNode) { row.parentNode.removeChild(row); } });

        row.appendChild(name);
        row.appendChild(url);
        row.appendChild(del);
        return row;
    }

    function openSub() {
        if (!checked.length) { return; }
        subRowsEl.innerHTML = '';
        subRowsEl.appendChild(makeDialogLinkRow({ name: '', url: '' }));
        subCountEl.textContent = String(checked.length);
        subErrEl.textContent = '';
        subEl.hidden = false;
        var first = subRowsEl.querySelector('.fe-link-url');
        if (first) { first.focus(); }
    }

    function closeSub() { subEl.hidden = true; }

    /* 把弹窗中填写的链接统一追加到所有勾选条目（已存在相同 URL 则跳过） */
    function applyBatchLinks() {
        var links = collectLinks(subRowsEl);
        if (!links.length) { subErrEl.textContent = '请至少填写一个链接地址。'; return; }
        var added = 0, skipped = 0;
        checked.slice().sort(function (a, b) { return a - b; }).forEach(function (i) {
            var entry = workData[i];
            if (!entry) { return; }
            links.forEach(function (l) {
                var dup = entry.note_link.some(function (x) { return x.url === l.url; });
                if (dup) { skipped++; return; }
                entry.note_link.push({ name: l.name, url: l.url });
                added++;
            });
        });
        closeSub();
        renderList();
        markDirty('已添加 ' + added + ' 条链接' + (skipped ? '（跳过重复 ' + skipped + ' 条）' : '') + '，请点击保存');
    }

    /* ============================================================
       七、表单：填充 / 回写 / 链接行
       ============================================================ */
    function makeLinkRow(l) {
        var row = document.createElement('div');
        row.className = 'fe-link-row';

        var name = document.createElement('input');
        name.type = 'text';
        name.className = 'fe-input fe-link-name';
        name.placeholder = '链接名称（如：维基百科）';
        name.value = l.name || '';

        var url = document.createElement('input');
        url.type = 'text';
        url.className = 'fe-input fe-mono fe-input-url fe-link-url';
        url.placeholder = 'https://…';
        url.value = l.url || '';

        var del = document.createElement('button');
        del.type = 'button';
        del.className = 'fe-link-del';
        del.setAttribute('aria-label', '删除该链接');
        del.textContent = '×';
        del.addEventListener('click', function () {
            if (row.parentNode) { row.parentNode.removeChild(row); }
            readForm();   // 删除链接同样先回写工作副本
            markDirty();
            updateLinksEmpty();
        });

        /* ★ 修复点：链接输入必须回写到工作副本，否则保存时写入的是旧 note_link */
        [name, url].forEach(function (el) {
            el.addEventListener('input', function () {
                readForm();
                markDirty();
            });
        });

        row.appendChild(name);
        row.appendChild(url);
        row.appendChild(del);
        return row;
    }

    function buildLinkRows(links) {
        linksBox.innerHTML = '';
        (Array.isArray(links) ? links : []).forEach(function (l) {
            linksBox.appendChild(makeLinkRow(l));
        });
        updateLinksEmpty();
    }

    function updateLinksEmpty() {
        linksEmpty.hidden = !!linksBox.querySelector('.fe-link-row');
    }

    /* 收集任意容器内的链接行 → 链接数组：空 URL 忽略；无协议自动补 https://
       （编辑器表单与批量弹窗共用同一套链接行结构） */
    function collectLinks(container) {
        var out = [];
        container.querySelectorAll('.fe-link-row').forEach(function (row) {
            var nameEl = row.querySelector('.fe-link-name');
            var urlEl = row.querySelector('.fe-link-url');
            var url = urlEl.value.trim();
            if (!url) { return; }
            if (!/^https?:\/\//i.test(url)) { url = 'https://' + url; }
            out.push({ name: nameEl.value.trim(), url: url });
        });
        return out;
    }

    /* 编辑器表单里的链接 → 当前条目的 note_link */
    function readLinks() { return collectLinks(linksBox); }

    function fillForm() {
        if (selected < 0 || selected >= workData.length) { return; }
        var d = workData[selected];
        fFormula.value = d.formula;
        fName.value = d.name;
        fProposer.value = d.proposer;
        var t = splitTheory(d.theory);  // 内部 "领域 · 年份" → 两个输入框
        fField.value = t.field;
        fYear.value = t.year;
        buildLinkRows(d.note_link);
        preview();
    }

    function readForm() {
        if (selected < 0 || selected >= workData.length) { return; }
        var d = workData[selected];
        d.formula = fFormula.value;
        d.name = fName.value;
        d.proposer = fProposer.value;
        d.theory = joinTheory(fField.value, fYear.value); // 两个输入框 → 内部 "领域 · 年份"
        d.note_link = readLinks();
    }

    /* ============================================================
       八、KaTeX 实时预览（防抖 300ms）
       ============================================================ */
    function preview() {
        clearTimeout(previewTimer);
        previewTimer = setTimeout(function () {
            var tex = fFormula.value;
            API.katexReady().then(function (ok) {
                if (!ok || !window.katex) {
                    previewEl.textContent = tex;
                    errEl.textContent = '公式渲染组件未加载，以下显示原始写法';
                    return;
                }
                try {
                    window.katex.render(tex, previewEl, { displayMode: true, throwOnError: true });
                    errEl.textContent = '';
                } catch (e) {
                    previewEl.textContent = tex;
                    errEl.textContent = 'LaTeX 语法错误：' + (e && e.message ? e.message : e);
                }
            });
        }, 300);
    }

    /* ============================================================
       九、显示设置（即时生效 + 即时持久化）
       ============================================================ */
    function applySettings() {
        clearTimeout(uiTimer);
        uiTimer = setTimeout(function () {
            API.setSettings({
                speedMode: mode,
                speed: Number(sSpeed.value),
                size: Number(sSize.value),
                density: Number(sDensity.value)
            });
        }, 120);
    }

    /* 滑杆已填充部分用强调色描出（配合自定义细轨道样式） */
    function paintRange(el) {
        var min = Number(el.min || 0), max = Number(el.max || 100), val = Number(el.value);
        var pct = (max > min) ? ((val - min) / (max - min)) * 100 : 0;
        el.style.background = 'linear-gradient(to right, var(--accent) ' + pct + '%, var(--line) ' + pct + '%)';
    }

    function updateSliderLabels() {
        vSpeed.textContent = sSpeed.value + 's';
        vSize.textContent = sSize.value + 'px';
        vDensity.textContent = sDensity.value + ' 条';
        [sSpeed, sSize, sDensity].forEach(paintRange);
    }

    function updateSegUI() {
        segBtns.forEach(function (b) {
            b.classList.toggle('active', b.getAttribute('data-mode') === mode);
        });
        vMode.textContent = (mode === 'uniform') ? '统一' : '随机';
    }

    function updateDensityMax() {
        var max = Math.max(0, workData.length);
        sDensity.max = String(max);
        if (Number(sDensity.value) > max) {
            sDensity.value = String(max);
            applySettings();
        }
        updateSliderLabels();
    }

    function syncSettingsUI() {
        var s = API.getSettings();
        mode = (s.speedMode === 'uniform') ? 'uniform' : 'random';
        sSpeed.value = s.speed;
        sSize.value = s.size;
        sDensity.value = s.density;
        updateDensityMax();
        updateSegUI();
        updateSliderLabels();
    }

    /* ============================================================
       十、恢复官方数据 / 打开 / 关闭
       ============================================================ */
    function restoreOfficial() {
        if (!confirm('确定恢复自带的官方公式数据？你的本地修改将被清除。')) { return; }
        API.resetToOfficial();
        workData = normalizeData(API.getData());
        checked = [];
        query = '';
        searchEl.value = '';
        selected = -1;
        renderList();
        updateDensityMax();
        hintEl.hidden = true;
        markClean('已恢复官方数据 · ' + nowTime());
        if (workData.length) { select(0); } else { setFormEnabled(false); }
    }

    function open() {
        workData = normalizeData(API.getData());
        checked = [];              // 每次打开都从零开始勾选
        subEl.hidden = true;
        query = '';
        searchEl.value = '';
        syncSettingsUI();
        switchTab('library');
        hintEl.hidden = !API.isOfficialChanged();
        renderList();
        selected = -1;
        if (workData.length) { select(0); } else { setFormEnabled(false); }
        markClean('与本地数据一致');
        overlay.hidden = false;
        document.body.style.overflow = 'hidden';
    }

    function close() {
        if (dirty) {
            var ok = confirm('有未保存的修改。\n点击「确定」保存并关闭，点击「取消」返回继续编辑。');
            if (!ok) { return; }
            save();
        }
        subEl.hidden = true;   // 关闭面板时一并收起批量弹窗
        overlay.hidden = true;
        document.body.style.overflow = '';
    }

    /* ---------- 返回设置面板（编辑器是从设置面板进入的，返回符合预期） ----------
       有未保存修改时同样先确认；若 setting.js 未加载则退化为「关闭」。 */
    function backToSettings() {
        if (dirty) {
            var ok = confirm('有未保存的修改。\n点击「确定」保存并返回设置，点击「取消」继续编辑。');
            if (!ok) { return; }
            save();
        }
        subEl.hidden = true;
        overlay.hidden = true;
        document.body.style.overflow = '';
        var settings = window.ZZKXS && window.ZZKXS.settings;
        if (settings && typeof settings.open === 'function') { settings.open(); }
    }

    /* ============================================================
       十·二、数据标签：导出 / 导入（对接 publisher / loader 模块）
       ============================================================ */
    function setDataStatus(text, kind) {
        dataStatusEl.textContent = text || '';
        dataStatusEl.classList.toggle('error', kind === true || kind === 'error');
        dataStatusEl.classList.toggle('warn', kind === 'warn');
    }

    /* 导出范围与条数实时刷新；勾选栏随范围显隐 */
    function syncDataUI() {
        var total = workData.length;
        var picked = checked.length;

        scopeBtns.forEach(function (b) {
            b.disabled = (total === 0);
            b.classList.toggle('active', b.getAttribute('data-scope') === exportScope);
        });
        scopeCountEl.textContent = (exportScope === 'selected' ? picked : total) + ' 条';
        exportBtn.disabled = total === 0;
        copyBtn.disabled = total === 0;

        importBtns.forEach(function (b) {
            b.classList.toggle('active', b.getAttribute('data-imode') === importMode);
        });

        if (pickWrapEl) { pickWrapEl.hidden = (exportScope !== 'selected'); }
    }

    /* 勾选栏里当前可见（其搜索框过滤后）的下标 */
    function pickerIndices() {
        var q = dataQuery.trim().toLowerCase();
        var out = [];
        workData.forEach(function (d, i) {
            if (!q || (d.name + ' ' + d.formula + ' ' + d.proposer).toLowerCase().indexOf(q) !== -1) {
                out.push(i);
            }
        });
        return out;
    }

    /* 渲染勾选栏（未处于「已勾选」范围时不渲染，避免无谓的 DOM 开销） */
    function renderPicker() {
        if (!pickWrapEl) { return; }
        pickWrapEl.hidden = (exportScope !== 'selected');
        if (exportScope !== 'selected') { return; }

        pickListEl.innerHTML = '';
        var list = pickerIndices();
        if (!list.length) {
            var empty = document.createElement('li');
            empty.className = 'fe-pick-empty';
            empty.textContent = dataQuery.trim() ? '没有匹配的公式' : '暂无公式';
            pickListEl.appendChild(empty);
            return;
        }

        list.forEach(function (i) {
            var d = workData[i];
            var row = document.createElement('label');
            row.className = 'fe-pick-item' + (isChecked(i) ? ' checked' : '');

            var box = document.createElement('input');
            box.type = 'checkbox';
            box.className = 'fe-pick-box';
            box.checked = isChecked(i);
            box.addEventListener('change', function () {
                toggleCheck(i);                       // 与公式库共用同一份选择
                row.classList.toggle('checked', box.checked);
            });

            var name = document.createElement('span');
            name.className = 'fe-pick-name';
            name.textContent = d.name || '（未命名）';

            var formula = document.createElement('span');
            formula.className = 'fe-pick-formula';
            formula.textContent = d.formula || '';

            row.appendChild(box);
            row.appendChild(name);
            row.appendChild(formula);
            pickListEl.appendChild(row);
        });
    }

    /* 未勾选却要导出时的提示：文字说明 + 勾选栏强调动画，引导用户去勾选 */
    function hintSelectFirst() {
        setDataStatus('还没有勾选公式：在下方「勾选要导出的公式」里勾选，或切到「公式库」勾选后再回来。', 'warn');
        if (pickWrapEl) {
            pickWrapEl.classList.remove('flash');
            void pickWrapEl.offsetWidth;   // 强制重排，使动画可以重复播放
            pickWrapEl.classList.add('flash');
        }
    }

    /* 导出/复制前的空数据判断：区分「一条都没有」与「没勾选」 */
    function guardExportList() {
        if (!workData.length) {
            setDataStatus('当前没有任何公式可导出。', 'warn');
            return false;
        }
        if (exportScope === 'selected' && !checked.length) {
            hintSelectFirst();
            return false;
        }
        return true;
    }

    /* 当前导出列表：全部，或按列表顺序的已勾选条目 */
    function currentExportList() {
        if (exportScope !== 'selected') { return workData.slice(); }
        return checked.slice().sort(function (a, b) { return a - b; })
            .map(function (i) { return workData[i]; })
            .filter(Boolean);
    }

    /* ---------- 导出：下载 JSON / 复制到剪贴板 ---------- */
    function doExport() {
        withDataModules(function () {
            if (!guardExportList()) { return; }
            var list = currentExportList();
            var name = window.ZZKXS.formular.publisher.download(list, exportScope === 'selected' ? 'selected' : 'all');
            setDataStatus('已导出 ' + list.length + ' 条到 ' + name + '。');
        });
    }

    function doCopy() {
        withDataModules(function () {
            if (!guardExportList()) { return; }
            var list = currentExportList();
            window.ZZKXS.formular.publisher.copy(list).then(function (ok) {
                setDataStatus(ok
                    ? ('已复制 ' + list.length + ' 条 JSON 到剪贴板。')
                    : '复制失败：浏览器未授权剪贴板，请改用「下载 JSON」。', !ok);
            });
        });
    }

    /* ---------- 导入：文件 / 拖拽 ---------- */
    function importFile(file) {
        withDataModules(function () {
            window.ZZKXS.formular.loader.readFile(file).then(function (r) {
                importText(r.text, r.name);
            }, function () {
                setDataStatus('文件读取失败，请重试。', true);
            });
        });
    }

    function importText(text, sourceName) {
        var res = window.ZZKXS.formular.loader.parse(text);
        if (!res.ok) { setDataStatus(res.error, true); return; }

        var summary;
        if (importMode === 'replace') {
            workData = res.data;
            checked = [];
            selected = -1;
            summary = '已用 ' + res.count + ' 条替换现有数据';
        } else {
            var merged = window.ZZKXS.formular.loader.merge(workData, res.data);
            workData = merged.data;
            summary = '已追加 ' + merged.added + ' 条'
                + (merged.skippedDup ? '（跳过重复 ' + merged.skippedDup + ' 条）' : '');
        }
        if (res.skipped) { summary += '，忽略 ' + res.skipped + ' 条无效记录'; }

        renderList();
        updateDensityMax();
        if (workData.length) { select(0); } else { setFormEnabled(false); }
        setDataStatus(summary + '。来源：' + sourceName);
        markDirty(summary + '，请点击保存');   // 底部状态栏在所有标签页都可见
        switchTab('library');                  // 切回列表，让用户立刻看到导入结果
    }

    /* ============================================================
       十一、事件绑定
       ============================================================ */
    function bindEvents() {
        overlay.querySelector('.fe-x').addEventListener('click', close);
        backBtn.addEventListener('click', backToSettings);
        closeBtn.addEventListener('click', close);
        overlay.addEventListener('click', function (e) {
            if (e.target === overlay) { close(); }
        });
        document.addEventListener('keydown', function (e) {
            if (overlay.hidden) { return; }
            if (e.key === 'Escape') {
                if (!subEl.hidden) { closeSub(); return; }  // 优先关闭批量弹窗
                close();
            }
            /* Ctrl/Cmd + S：保存（阻止浏览器"保存网页"） */
            if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
                e.preventDefault();
                save();
            }
        });

        /* 标签切换 */
        tabBtns.forEach(function (b) {
            b.addEventListener('click', function () { switchTab(b.getAttribute('data-tab')); });
        });

        /* 搜索与新增 */
        searchEl.addEventListener('input', function () {
            query = searchEl.value;
            renderList();
        });
        addBtn.addEventListener('click', addEntry);

        /* 表单字段：回写工作副本 → 预览 → 标记未保存 */
        [fFormula, fName, fProposer, fField, fYear].forEach(function (el) {
            el.addEventListener('input', function () {
                readForm();
                if (el === fFormula) { preview(); }
                renderList();
                markDirty();
            });
        });

        /* 添加链接行：先回写（保留已填内容）再追加新行 */
        linkAddBtn.addEventListener('click', function () {
            readForm();
            linksBox.appendChild(makeLinkRow({ name: '', url: '' }));
            updateLinksEmpty();
            markDirty();
            var inputs = linksBox.querySelectorAll('.fe-link-name');
            if (inputs.length) { inputs[inputs.length - 1].focus(); }
        });

        /* 批量选择托盘：全选 / 批量添加 NoteLink / 批量删除 */
        trayAllBtn.addEventListener('click', toggleCheckAll);
        trayLinkBtn.addEventListener('click', openSub);
        trayDelBtn.addEventListener('click', batchDelete);

        /* 批量 NoteLink 子弹窗 */
        subOkBtn.addEventListener('click', applyBatchLinks);
        subCancelBtn.addEventListener('click', closeSub);
        subAddRowBtn.addEventListener('click', function () {
            subRowsEl.appendChild(makeDialogLinkRow({ name: '', url: '' }));
            var urls = subRowsEl.querySelectorAll('.fe-link-url');
            if (urls.length) { urls[urls.length - 1].focus(); }
        });
        subEl.addEventListener('click', function (e) {
            if (e.target === subEl) { closeSub(); }   // 点击遮罩空白处关闭
        });

        /* 数据标签：导出范围（含未勾选时的引导提示） / 下载 / 复制 */
        scopeBtns.forEach(function (b) {
            b.addEventListener('click', function () {
                if (b.disabled) { return; }
                exportScope = b.getAttribute('data-scope');
                setDataStatus('');
                renderPicker();
                syncDataUI();
                if (exportScope === 'selected' && !checked.length) {
                    hintSelectFirst();   // 点了「已勾选」但一条都没勾 → 立刻给出引导
                }
            });
        });
        exportBtn.addEventListener('click', doExport);
        copyBtn.addEventListener('click', doCopy);

        /* 数据标签：导出勾选栏（搜索 / 全选 / 清空） */
        pickSearchEl.addEventListener('input', function () {
            dataQuery = pickSearchEl.value;
            renderPicker();
        });
        pickAllBtn.addEventListener('click', function () {
            toggleAllFor(pickerIndices());
            renderPicker();
            updateTray();
        });
        pickNoneBtn.addEventListener('click', function () {
            checked = [];
            renderPicker();
            updateTray();
            setDataStatus('已清空勾选。');
        });

        /* 数据标签：导入方式 / 选择文件 / 拖拽文件 */
        importBtns.forEach(function (b) {
            b.addEventListener('click', function () {
                importMode = b.getAttribute('data-imode');
                syncDataUI();
            });
        });
        pickBtn.addEventListener('click', function () { fileInput.click(); });
        fileInput.addEventListener('change', function () {
            var f = fileInput.files && fileInput.files[0];
            if (f) { importFile(f); }
            fileInput.value = '';   // 清空以便重复选择同一个文件
        });
        ['dragenter', 'dragover'].forEach(function (t) {
            dropEl.addEventListener(t, function (e) {
                e.preventDefault();
                dropEl.classList.add('over');
            });
        });
        ['dragleave', 'drop'].forEach(function (t) {
            dropEl.addEventListener(t, function (e) {
                e.preventDefault();
                dropEl.classList.remove('over');
            });
        });
        dropEl.addEventListener('drop', function (e) {
            var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
            if (f) { importFile(f); }
        });

        /* 底部操作 */
        saveBtn.addEventListener('click', save);
        restoreBtn.addEventListener('click', restoreOfficial);

        /* 显示设置：滑杆 / 模式即时生效 */
        [sSpeed, sSize, sDensity].forEach(function (el) {
            el.addEventListener('input', function () {
                updateSliderLabels();
                applySettings();
            });
        });
        segBtns.forEach(function (b) {
            b.addEventListener('click', function () {
                mode = b.getAttribute('data-mode');
                updateSegUI();
                applySettings();
            });
        });
    }

    /* ---------- 启动 ---------- */
    build();
    API.openEditor = open;
})();
