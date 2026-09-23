/* ============================================================
   致知科学社 · 设置面板（setting）
   ------------------------------------------------------------
   【职责】
   - 在导航栏主题切换按钮旁注入「设置」按钮（齿轮图标）；
   - 呼出设置面板弹窗；目前面板仅含一个入口：「公式编辑器」，
     点击后调起 window.ZZKXS.formular.openEditor()；
   - 面板为后续更多设置项预留结构：往 .settings-body 中追加
     .settings-row（整行可点的条目）即可，无需改动其余逻辑；
   - 面板自身通过 window.ZZKXS.settings 暴露 open/close，
     供公式编辑器面板的「返回设置」按钮回跳。

   【文案约定】
   - 副标题与底部说明保持「笼统」措辞，不点名具体功能；
     这样后续新增设置项（如 Markdown 渲染设置等）无需再改这两句文案，
     只需在 .settings-list 中追加 .settings-row。

   【视觉约定（与公式编辑器面板统一）】
   - 面板尺寸/形状与公式编辑器面板完全一致（min(1000px,96vw) × min(700px,88vh)，
     同一圆角与阴影）；设置项较少时多出的空间留白，底部一行小字说明贴底；
   - 面板顶部为渐变头（--accent-soft → 透明）+ 标题 + 单行副标题；
   - 条目放在圆角浅底列表容器中，整行可点：名称 + 单行说明 + 右侧箭头（›）；
   - 条目之间用 1px 直线分割，悬停整行淡蓝高亮；
   - 不设「关闭」行：右上角 ×、点击遮罩、Esc 均可关闭。

   【注入方式】
   - 按钮与面板全部由本脚本动态创建，HTML 无需改动；
   - 仅当页面存在 #themeToggle（即正式页面的导航栏）时才注入，
     测试页等无导航栏页面自动跳过。
   ============================================================ */
(function () {
    'use strict';

    var themeToggle = document.getElementById('themeToggle');
    if (!themeToggle) { return; } // 无导航栏页面（如 forTest）不注入

    /* ============================================================
       一、设置按钮（插在主题按钮之后，同规格圆形按钮）
       ============================================================ */
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'settings-toggle';
    btn.id = 'settingsToggle';
    btn.setAttribute('aria-label', '打开设置');
    btn.setAttribute('aria-expanded', 'false');
    /* 齿轮图标（lucide settings，与主题按钮同为 stroke 风格） */
    btn.innerHTML = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>';
    themeToggle.insertAdjacentElement('afterend', btn);

    /* ============================================================
       二、设置面板弹窗（目前仅「公式编辑器」一个入口）
       ============================================================ */
    var overlay = document.createElement('div');
    overlay.className = 'settings-modal';
    overlay.hidden = true;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-label', '设置');
    overlay.innerHTML =
        '<div class="settings-panel">' +
            '<div class="settings-head">' +
                '<div class="settings-head-text">' +
                    '<h2 class="settings-title">设置</h2>' +
                    '<p class="settings-subtitle">管理本站各项功能的选项与偏好</p>' +
                '</div>' +
                '<button type="button" class="settings-x" aria-label="关闭">×</button>' +
            '</div>' +
            '<div class="settings-body">' +
                '<div class="settings-list">' +
                    /* 每个设置项一行：整行可点，右侧箭头提示可进入 */
                    '<button type="button" class="settings-row settings-open-editor">' +
                        '<span class="settings-row-text">' +
                            '<span class="settings-row-name">公式编辑器</span>' +
                            '<span class="settings-row-desc">增删改公式、管理 NoteLink 与显示设置</span>' +
                        '</span>' +
                        '<svg class="settings-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>' +
                    '</button>' +
                    '<!-- ↓ 后续更多设置项（.settings-row）照此追加 ↓ -->' +
                '</div>' +
                '<p class="settings-hint">所有改动仅保存在此浏览器中。</p>' +
            '</div>' +
        '</div>';
    document.body.appendChild(overlay);

    var closeX = overlay.querySelector('.settings-x');
    var openEditorBtn = overlay.querySelector('.settings-open-editor');

    /* ============================================================
       三、开关逻辑
       ============================================================ */
    function open() {
        overlay.hidden = false;
        btn.setAttribute('aria-expanded', 'true');
    }

    function close() {
        overlay.hidden = true;
        btn.setAttribute('aria-expanded', 'false');
    }

    /* 对外暴露：公式编辑器面板的「返回设置」按钮通过它重新打开本面板 */
    window.ZZKXS = window.ZZKXS || {};
    window.ZZKXS.settings = { open: open, close: close };

    btn.addEventListener('click', function () {
        if (overlay.hidden) { open(); } else { close(); }
    });
    closeX.addEventListener('click', close);
    overlay.addEventListener('click', function (e) {
        if (e.target === overlay) { close(); } // 点击遮罩空白处关闭
    });
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && !overlay.hidden) { close(); }
    });

    /* ============================================================
       四、唯一功能入口：公式编辑器
       ============================================================ */
    openEditorBtn.addEventListener('click', function () {
        close();
        var openEditor = window.ZZKXS && window.ZZKXS.formular && window.ZZKXS.formular.openEditor;
        if (typeof openEditor === 'function') {
            openEditor();
        } else {
            alert('公式编辑器未就绪，请稍后或刷新页面重试。');
        }
    });
})();
