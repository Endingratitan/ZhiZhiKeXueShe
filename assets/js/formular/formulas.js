/* ============================================================
   致知科学社 · 物理公式装饰流（全站脚本）
   ------------------------------------------------------------
   【功能概览】
   - 在页面两侧生成漂浮的物理公式装饰流（仅宽屏 ≥1080px 启用）；
   - 悬停暂停动画；按住拖拽可"捕获"公式并弹出介绍卡片；
   - 介绍卡片展示：公式（KaTeX）、名称、提出者·领域，以及
     该公式的笔记链接 note_link 列表；
   - 键盘可操作（Tab 聚焦 + Enter/空格 打开卡片，Esc 关闭）；
   - 尊重 prefers-reduced-motion：减弱动画、公式静止摆放。

   【数据来源（两级）】
   1) 主数据：assets/data/formulas.json —— 共 100 条公式，
      通过 fetch 加载，是线上实际展示的完整公式库；
   2) 兜底数据：本文件下方的 FALLBACK_DATA —— 刻意只保留 25 条
      各领域最经典的公式。它只在 fetch 失败且无任何缓存时启用
      （例如用 file:// 直接打开页面、CDN/网络受限），目的是保证
      公式流"仍然可见"而不是追求完整，因此【不需要】与
      formulas.json 保持同数量——100 与 25 是设计上的有意差异。

   【持久化缓存（三层 localStorage，跨会话生效）】
   - zzkxs.formulas.official  { v, ts, hash, data }
       官方 formulas.json 的缓存副本。策略为"缓存优先 + 后台刷新"
       （stale-while-revalidate）：页面先用缓存立即渲染，随后
       fetch 官方数据，若哈希变化则更新缓存并重渲染。断网时
       页面仍可用缓存展示。
   - zzkxs.formulas.custom    { v, baseHash, ts, data }
       用户在公式编辑器中的本地覆盖（增删改后的完整数据）。
       存在时【永远优先】于官方数据；baseHash 记录覆盖时官方
       数据的哈希，后台发现官方更新后置 officialChanged 标志，
       编辑器面板提示"官方数据已更新，可恢复"。
   - zzkxs.formulas.settings  { speedMode, speed, size, density }
       显示设置键值对：
         speedMode: 'uniform'（统一流速）| 'random'（各自随机）
         speed    : 基准时长（秒），uniform 时为每条时长，
                    random 时为基准 ±40% 随机
         size     : 字号（px），KaTeX 行内渲染跟随 CSS font-size
         density  : 展示条数，0 = 隐藏公式流
   - 隐私模式下 localStorage 读写可能抛异常，全部 try/catch 静默降级。

   【编辑器对接（formular-editor.js）】
   - 本文件对外暴露 window.ZZKXS.formular API，编辑器通过它：
       getData()         读取当前生效数据
       setCustomData(arr) 提交用户编辑（写 custom 缓存 + 重渲染）
       resetToOfficial()  清除覆盖，回到官方数据
       getSettings() / setSettings(patch)
       isOfficialChanged() 官方数据是否在用户覆盖后更新过
       katexReady()        KaTeX 就绪 Promise（懒加载入口）
       renderLatex(el, tex, displayMode)  同步渲染（无 KaTeX 降级源码）
       openEditor()        由 formular-editor.js 注册，供设置面板调用
   - 所有 localStorage 读写都集中在本文件，编辑器不直接碰存储。

   【公式格式：LaTeX】
   - 两处数据中的 "formula" 字段均为 LaTeX 源码字符串，
     例如 "F = \\frac{G m_1 m_2}{r^2}"；
   - ⚠ 转义规则（非常容易踩坑）：
       在 JS 字符串与 JSON 文件里，LaTeX 的反斜杠必须写成
       双反斜杠 "\\"。否则 \f、\t、\n、\b 等会被解析为控制字符，
       导致公式渲染失败。JSON 中同理：
       JSON 文件写  "F = \\frac{a}{b}"  → 实际得到  F = \frac{a}{b}

   【KaTeX 渲染】
   - 本脚本在运行时按需（懒加载）注入 KaTeX 的 CSS 与 JS，
     CDN 使用 jsDelivr，版本锁定为 KATEX_VERSION（避免 CDN
     大版本升级导致渲染行为变化）。窄屏不会触发 CDN 请求，
     只有宽屏渲染或编辑器预览时才加载；
   - 若 CDN 加载失败（断网 / 被墙 / CSP 限制），自动降级为
     直接显示 LaTeX 源码文本，公式流功能不受影响；
   - 国内网络若访问 jsDelivr 不稳定，可改为 unpkg 或把
     katex.min.css / katex.min.js 下载到 assets/vendor/katex/
     本地托管后替换下方两个常量。

   【渲染降级策略（三级）】
   1. KaTeX 就绪        → katex.render 渲染为排版级数学公式；
   2. KaTeX 加载失败    → 显示 LaTeX 源码（可读，信息不丢失）；
   3. 单条公式语法错误  → throwOnError:false，仅该条红色报错，
                          不影响其余公式。

   【修改指南】
   - 新增/修改官方公式：编辑 assets/data/formulas.json；
   - 调整兜底集合：编辑 FALLBACK_DATA（25 条）；
   - 无 HTML 改动需求：样式与容器全部由本脚本自动注入；
   - JSON 文件不支持注释，因此所有维护说明都集中在本文件头部。
   ============================================================ */
(function () {
    'use strict';

    /* ============================================================
       一、常量
       ============================================================ */

    /* KaTeX CDN（版本锁定，防止 CDN 自动升大版本导致行为变化） */
    var KATEX_VERSION = '0.16.21';
    var KATEX_JS = 'https://cdn.jsdelivr.net/npm/katex@' + KATEX_VERSION + '/dist/katex.min.js';
    var KATEX_CSS = 'https://cdn.jsdelivr.net/npm/katex@' + KATEX_VERSION + '/dist/katex.min.css';

    /* localStorage 键名（跨会话持久，同源多页面共享） */
    var SETTINGS_KEY = 'zzkxs.formulas.settings';
    var CUSTOM_KEY = 'zzkxs.formulas.custom';
    var OFFICIAL_KEY = 'zzkxs.formulas.official';

    /* 显示设置结构版本：版本不符的旧数据一律作废并回落默认值，
       避免历史 bug 写入的设置（如 density=0）长期隐藏公式流 */
    var SETTINGS_VERSION = 2;

    /* 显示设置默认值与合法区间
       ⚠ 关键约定：字段缺失/非法时必须回落到 DEFAULT_SETTINGS，
       绝不能回落到区间最小值——density 的最小值是 0（隐藏公式流），
       曾因此导致首次访问时公式流完全不可见。 */
    var DEFAULT_SETTINGS = { speedMode: 'random', speed: 21, size: 14, density: 100 };
    var LIMIT_SPEED = [8, 40];      // 基准流速（秒）
    var LIMIT_SIZE = [10, 26];      // 字号（px）
    var LIMIT_DENSITY = [0, 500];   // 展示条数（0 = 隐藏）

    /* ============================================================
       二、localStorage 工具（全部 try/catch，隐私模式静默降级）
       ============================================================ */

    function readJSON(key) {
        try {
            var s = localStorage.getItem(key);
            return s ? JSON.parse(s) : null;
        } catch (e) { return null; }
    }

    function writeJSON(key, value) {
        try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* 配额/隐私模式：忽略 */ }
    }

    function removeJSON(key) {
        try { localStorage.removeItem(key); } catch (e) { /* 忽略 */ }
    }

    /* FNV-1a 字符串哈希（36 进制短签名），用于官方数据变更比对 */
    function hash(str) {
        var h = 2166136261;
        for (var i = 0; i < str.length; i++) {
            h ^= str.charCodeAt(i);
            h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
        }
        return (h >>> 0).toString(36);
    }

    /* ============================================================
       三、KaTeX 懒加载
       - ensureKatex()：惰性创建加载 Promise（首次调用才发请求，
         窄屏访问完全不产生 CDN 流量）；
       - 加载失败 resolve(false)，【永不 reject】：渲染降级为
         源码文本，不让 CDN 故障拖垮整个装饰功能。
       ============================================================ */
    var katexReady = null;   // Promise<boolean>，惰性创建
    var katexOk = false;     // KaTeX 是否已就绪

    function loadKatex() {
        if (window.katex && typeof window.katex.render === 'function') {
            return Promise.resolve(true); // 同页其他脚本已加载过 → 复用
        }
        var css = document.createElement('link');
        css.rel = 'stylesheet';
        css.href = KATEX_CSS; // 样式失败无碍：公式仍以源码文本显示
        document.head.appendChild(css);

        return new Promise(function (resolve) {
            var s = document.createElement('script');
            s.src = KATEX_JS;
            s.async = true;
            s.onload = function () { resolve(true);  }; // 就绪，可用 katex.render
            s.onerror = function () { resolve(false); }; // 失败，调用方走文本兜底
            document.head.appendChild(s);
        });
    }

    function ensureKatex() {
        if (!katexReady) {
            katexReady = loadKatex();
            katexReady.then(function (ok) {
                katexOk = ok;
                /* 等待期间积压的渲染请求在引擎就绪后补做 */
                if (pendingRender) {
                    pendingRender = false;
                    if (isWide()) { renderNow(); }
                }
            });
        }
        return katexReady;
    }

    /* ============================================================
       渲染一条 LaTeX 公式到容器 el（会清空 el 原有内容）
       @param el           目标容器（漂浮项 <span> 或介绍卡 <p>）
       @param tex          LaTeX 源码
       @param displayMode  true=独立成行（详情卡），false=行内（漂浮项）
       降级链：KaTeX 可用且语法正确 → 排版渲染；
              KaTeX 不可用 / 单条出错 → textContent 显示源码。
       ============================================================ */
    function renderLatex(el, tex, displayMode) {
        if (window.katex && typeof window.katex.render === 'function') {
            try {
                window.katex.render(tex, el, {
                    displayMode: !!displayMode,
                    throwOnError: false, // 单条出错 → 红色提示而非抛异常中断整页
                    strict: false        // 关闭非标准写法的控制台告警
                });
                return;
            } catch (err) {
                /* 渲染异常 → 落入下方文本兜底 */
            }
        }
        el.textContent = tex; // KaTeX 缺席时显示源码，功能不中断
    }

    /* ============================================================
       四、显示设置（读取 / 归一化 / 合并）
       ============================================================ */
    /* 数值归一化：
       - 缺失 / 空 / 非数字 → 回落 def（默认值）；
       - 合法数字 → 夹取到 [min, max] 区间内。 */
    function clampOr(value, def, range) {
        if (value === undefined || value === null || value === '') { return def; }
        var n = Number(value);
        if (isNaN(n)) { return def; }
        return Math.min(range[1], Math.max(range[0], n));
    }

    function normalizeSettings(raw) {
        var src = (raw && typeof raw === 'object') ? raw : {};
        return {
            /* 模式白名单：仅接受 uniform / random，其余回落默认 */
            speedMode: (src.speedMode === 'uniform' || src.speedMode === 'random')
                ? src.speedMode
                : DEFAULT_SETTINGS.speedMode,
            /* 数值一律以 DEFAULT_SETTINGS 为缺省（关键修复点） */
            speed: clampOr(src.speed, DEFAULT_SETTINGS.speed, LIMIT_SPEED),
            size: clampOr(src.size, DEFAULT_SETTINGS.size, LIMIT_SIZE),
            density: clampOr(src.density, DEFAULT_SETTINGS.density, LIMIT_DENSITY)
        };
    }

    /* 读取已保存设置：带结构版本校验。
       版本不符（或从未保存过）→ 返回 null → 回落 DEFAULT_SETTINGS。
       这一步同时能自愈历史 bug 写坏的设置数据。 */
    function readStoredSettings() {
        var raw = readJSON(SETTINGS_KEY);
        if (!raw || raw.v !== SETTINGS_VERSION) { return null; }
        return raw;
    }

    var settings = normalizeSettings(readStoredSettings());

    function mergeSettings(target, patch) {
        for (var k in patch) {
            if (Object.prototype.hasOwnProperty.call(patch, k)) { target[k] = patch[k]; }
        }
        return target;
    }

    /* ============================================================
       五、数据地址与兜底数据
       ============================================================ */

    /* 依据脚本自身位置推导 data 目录，兼容任意页面深度：
       脚本位于 assets/js/formular/ 下，需向上两级（../../）才能
       回到 assets/data/formulas.json，切勿改回一级的 "../"。 */
    var script = document.currentScript;
    var base = script && script.src ? script.src.replace(/[^/]*$/, '') : '';
    var dataUrl = base + '../../data/formulas.json';

    /* ---------- 兜底数据（25 条 · LaTeX）----------
       仅含各领域最经典公式，fetch 失败且无缓存时启用。
       与 formulas.json（100 条）刻意保持差异，见文件头说明。
       每条字段：formula / name / proposer / theory / note_link */
    var FALLBACK_DATA = [
    {
        "formula": "F = ma",
        "name": "牛顿第二定律",
        "proposer": "艾萨克·牛顿（Isaac Newton）",
        "theory": "经典力学 · 1687",
        "note_link": []
    },
    {
        "formula": "F = \\frac{G m_1 m_2}{r^2}",
        "name": "万有引力定律",
        "proposer": "艾萨克·牛顿（Isaac Newton）",
        "theory": "经典力学 · 1687",
        "note_link": []
    },
    {
        "formula": "p = mv",
        "name": "动量定义",
        "proposer": "勒内·笛卡尔（René Descartes）",
        "theory": "经典力学 · 1644",
        "note_link": []
    },
    {
        "formula": "T = 2\\pi \\sqrt{\\frac{L}{g}}",
        "name": "单摆周期公式",
        "proposer": "克里斯蒂安·惠更斯（Christiaan Huygens）",
        "theory": "经典力学 · 1673",
        "note_link": []
    },
    {
        "formula": "F = \\frac{k q_1 q_2}{r^2}",
        "name": "库仑定律",
        "proposer": "夏尔·库仑（Charles Coulomb）",
        "theory": "静电学 · 1785",
        "note_link": []
    },
    {
        "formula": "V = IR",
        "name": "欧姆定律",
        "proposer": "格奥尔格·欧姆（Georg Ohm）",
        "theory": "电路 · 1827",
        "note_link": []
    },
    {
        "formula": "\\oint \\vec{E}\\cdot d\\vec{A} = \\frac{Q}{\\varepsilon_0}",
        "name": "高斯定律",
        "proposer": "卡尔·弗里德里希·高斯（C. F. Gauss）",
        "theory": "静电学 · 1835",
        "note_link": []
    },
    {
        "formula": "\\nabla\\times\\vec{E} = -\\frac{\\partial\\vec{B}}{\\partial t}",
        "name": "法拉第电磁感应定律",
        "proposer": "迈克尔·法拉第（Michael Faraday）",
        "theory": "电磁学 · 1831",
        "note_link": []
    },
    {
        "formula": "PV = nRT",
        "name": "理想气体状态方程",
        "proposer": "埃米尔·克拉珀龙（Émile Clapeyron）",
        "theory": "热力学 · 1834",
        "note_link": []
    },
    {
        "formula": "\\Delta U = Q - W",
        "name": "热力学第一定律",
        "proposer": "鲁道夫·克劳修斯（Rudolf Clausius）",
        "theory": "热力学 · 1850",
        "note_link": []
    },
    {
        "formula": "\\Delta S \\geq 0",
        "name": "熵增原理（第二定律）",
        "proposer": "鲁道夫·克劳修斯（Rudolf Clausius）",
        "theory": "热力学 · 1865",
        "note_link": []
    },
    {
        "formula": "S = k\\ln W",
        "name": "玻尔兹曼熵公式",
        "proposer": "路德维希·玻尔兹曼（Ludwig Boltzmann）",
        "theory": "统计力学 · 1877",
        "note_link": []
    },
    {
        "formula": "E = h\\nu",
        "name": "普朗克能量子假设",
        "proposer": "马克斯·普朗克（Max Planck）",
        "theory": "量子论 · 1900",
        "note_link": []
    },
    {
        "formula": "i\\hbar \\frac{\\partial \\psi}{\\partial t} = \\hat{H}\\psi",
        "name": "薛定谔方程",
        "proposer": "埃尔温·薛定谔（Erwin Schrödinger）",
        "theory": "量子力学 · 1926",
        "note_link": []
    },
    {
        "formula": "\\Delta x\\,\\Delta p \\geq \\frac{\\hbar}{2}",
        "name": "海森堡不确定性原理",
        "proposer": "维尔纳·海森堡（Werner Heisenberg）",
        "theory": "量子力学 · 1927",
        "note_link": []
    },
    {
        "formula": "E = mc^2",
        "name": "质能方程",
        "proposer": "阿尔伯特·爱因斯坦（Albert Einstein）",
        "theory": "狭义相对论 · 1905",
        "note_link": []
    },
    {
        "formula": "\\gamma = \\frac{1}{\\sqrt{1 - v^2/c^2}}",
        "name": "洛伦兹因子",
        "proposer": "亨德里克·洛伦兹（Hendrik Lorentz）",
        "theory": "狭义相对论 · 1904",
        "note_link": []
    },
    {
        "formula": "P + \\tfrac{1}{2}\\rho v^2 + \\rho g h = \\text{const.}",
        "name": "伯努利方程",
        "proposer": "丹尼尔·伯努利（Daniel Bernoulli）",
        "theory": "流体力学 · 1738",
        "note_link": []
    },
    {
        "formula": "n_1\\sin\\theta_1 = n_2\\sin\\theta_2",
        "name": "斯涅尔折射定律",
        "proposer": "威理博·斯涅尔（Willebrord Snellius）",
        "theory": "光学 · 1621",
        "note_link": []
    },
    {
        "formula": "e^{i\\pi} + 1 = 0",
        "name": "欧拉恒等式",
        "proposer": "莱昂哈德·欧拉（Leonhard Euler）",
        "theory": "数学 · 1748",
        "note_link": []
    },
    {
        "formula": "\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}",
        "name": "高斯积分",
        "proposer": "卡尔·弗里德里希·高斯（C. F. Gauss）",
        "theory": "数学 · 1809",
        "note_link": []
    },
    {
        "formula": "\\lambda_{max} T = b",
        "name": "维恩位移定律",
        "proposer": "威廉·维恩（Wilhelm Wien）",
        "theory": "热辐射 · 1893",
        "note_link": []
    },
    {
        "formula": "j = \\sigma T^4",
        "name": "斯特藩-玻尔兹曼定律",
        "proposer": "斯特藩（Stefan）/ 玻尔兹曼（Boltzmann）",
        "theory": "热辐射 · 1879/1884",
        "note_link": []
    },
    {
        "formula": "v = f\\lambda",
        "name": "波速公式",
        "proposer": "通用波动学基本关系",
        "theory": "波动学 · 基础关系",
        "note_link": []
    },
    {
        "formula": "\\eta = 1 - \\frac{T_c}{T_h}",
        "name": "卡诺热机效率",
        "proposer": "萨迪·卡诺（Sadi Carnot）",
        "theory": "热力学 · 1824",
        "note_link": []
    }
    ];

    /* ============================================================
       六、状态与宽屏检测
       ============================================================ */
    var currentData = null;      // 当前生效的公式数据（custom > official > fallback）
    var officialHash = null;     // 最近一次获取的官方数据哈希
    var officialChanged = false; // 官方更新但用户存在本地覆盖
    var pendingRender = false;   // KaTeX 未就绪时积压的渲染请求
    var renderedOnce = false;    // 是否已渲染过（用于跨宽屏阈值检测）

    var field = null;            // 漂浮容器
    var card = null;             // 介绍卡
    var cardFormulaBox = null, cardFormula = null, cardName = null, cardProposer = null, cardTheory = null;
    var cardRowProposer = null, cardRowTheory = null, cardLinks = null, cardLinksWrap = null;
    var activeItem = null;       // 当前"被捕获"的漂浮项

    var wideMedia = window.matchMedia ? window.matchMedia('(min-width: 1080px)') : null;

    function isWide() {
        return !wideMedia || wideMedia.matches;
    }

    /* ============================================================
       七、渲染（壳 + 漂浮项）
       ============================================================ */

    /* ---------- 壳：漂浮容器 + 介绍卡（整个生命周期只建一次） ---------- */
    function ensureShell() {
        if (field) { return; }

        field = document.createElement('div');
        field.className = 'formula-field';
        field.id = 'formulaField';
        document.body.appendChild(field);

        card = document.createElement('div');
        card.className = 'formula-card';
        card.hidden = true;
        card.setAttribute('role', 'dialog');
        card.setAttribute('aria-label', '公式介绍');
        card.innerHTML =
            '<button type="button" class="fc-close" aria-label="关闭">×</button>' +
            '<div class="fc-body">' +
                '<div class="fc-formula-box"><p class="fc-formula"></p></div>' +  // 公式本体（KaTeX 行间渲染）
                '<h3 class="fc-name"></h3>' +                                      // 公式名称
                '<div class="fc-info">' +                                          // 提出者 / 领域（两行；fc-row-* 仅作脚本切换 hidden 的钩子，样式走 fc-info-row）
                    '<p class="fc-info-row fc-row-proposer"><span class="fc-info-label">提出者</span><span class="fc-proposer"></span></p>' +
                    '<p class="fc-info-row fc-row-theory"><span class="fc-info-label">领域</span><span class="fc-theory"></span></p>' +
                '</div>' +
                '<div class="fc-links-wrap">' +                                    // NoteLink 参考链接区
                    '<p class="fc-links-title">NoteLink</p>' +
                    '<ul class="fc-links"></ul>' +
                '</div>' +
            '</div>';
        document.body.appendChild(card);

        cardFormulaBox = card.querySelector('.fc-formula-box');
        cardFormula = card.querySelector('.fc-formula');
        cardName = card.querySelector('.fc-name');
        cardProposer = card.querySelector('.fc-proposer');
        cardTheory = card.querySelector('.fc-theory');
        cardRowProposer = card.querySelector('.fc-row-proposer');
        cardRowTheory = card.querySelector('.fc-row-theory');
        cardLinks = card.querySelector('.fc-links');
        cardLinksWrap = card.querySelector('.fc-links-wrap');

        /* ---------- 全局关闭：×按钮 / Esc / 点击卡片外部 ---------- */
        card.querySelector('.fc-close').addEventListener('click', closeCard);
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && !card.hidden) { closeCard(); }
        });
        document.addEventListener('pointerdown', function (e) {
            if (card.hidden) { return; }
            if (card.contains(e.target)) { return; }
            var onItem = false;
            field.querySelectorAll('.formula-item').forEach(function (it) {
                if (it === e.target) { onItem = true; }
            });
            if (!onItem) { closeCard(); }
        });
    }

    /* ---------- 关闭介绍卡并释放被捕获的公式 ---------- */
    function closeCard() {
        card.hidden = true;
        if (activeItem) {
            activeItem.classList.remove('captured');
            // 清空拖拽期间写入的内联样式，恢复 CSS 动画
            activeItem.style.left = '';
            activeItem.style.top = '';
            activeItem.style.bottom = '';
            activeItem.style.animation = '';
            activeItem = null;
        }
    }

    /* ---------- 打开介绍卡（就近定位，防止超出视口） ---------- */
    function openCard(item, d) {
        cardName.textContent = d.name || '';
        /* 提出者与领域分两行展示；空值整行隐藏，保持卡片干净 */
        var proposer = String(d.proposer || '').trim();
        var theory = String(d.theory || '').trim();
        cardProposer.textContent = proposer;
        cardTheory.textContent = theory;
        cardRowProposer.hidden = !proposer;
        cardRowTheory.hidden = !theory;
        renderLatex(cardFormula, d.formula || '', true); // 行间模式渲染，更醒目

        /* NoteLink 链接列表：只接受 http(s)://，名称缺省时显示 URL，
           全程 textContent 写入，杜绝 XSS；无有效链接时整块隐藏 */
        cardLinks.innerHTML = '';
        var links = Array.isArray(d.note_link) ? d.note_link : [];
        var shown = 0;
        links.forEach(function (l) {
            if (!l || typeof l.url !== 'string') { return; }
            var url = l.url.trim();
            if (!/^https?:\/\//i.test(url)) { return; }
            var li = document.createElement('li');
            var a = document.createElement('a');
            a.href = url;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            a.textContent = (l.name && String(l.name).trim()) || url;
            li.appendChild(a);
            cardLinks.appendChild(li);
            shown++;
        });
        cardLinksWrap.style.display = shown ? '' : 'none';

        card.hidden = false; // 先显示再测量，尺寸才准确
        /* 公式过宽时把卡片加宽一档（380 → 480px），尽量完整展示；
           仍放不下则由公式框横向滚动，不撑破卡片 */
        card.classList.toggle('fc-wide', cardFormulaBox.scrollWidth > cardFormulaBox.clientWidth + 4);
        var r = item.getBoundingClientRect();
        var cw = card.offsetWidth;
        var ch = card.offsetHeight;
        // 优先显示在公式右侧；放不下则翻转到左侧；再不行贴边
        var left = r.right + 14;
        if (left + cw > window.innerWidth - 14) { left = r.left - cw - 14; }
        left = Math.max(14, left);
        var top = Math.max(14, Math.min(r.top - 30, window.innerHeight - ch - 14));
        card.style.left = left + 'px';
        card.style.top = top + 'px';
        activeItem = item;
    }

    /* ---------- 点击同一公式 → 关闭；点击其他 → 切换 ---------- */
    function toggleCard(item, d) {
        if (card.hidden) { openCard(item, d); }
        else if (activeItem === item) { closeCard(); }
        else { openCard(item, d); }
    }

    /* ---------- 等距抽样：密度小于总条数时均匀取 n 条，保证各领域都有代表 ---------- */
    function sample(arr, n) {
        if (n >= arr.length) { return arr.slice(); }
        var out = [];
        for (var i = 0; i < n; i++) {
            out.push(arr[Math.floor(i * arr.length / n)]);
        }
        return out;
    }

    /* ---------- 清空漂浮项（重渲染前调用） ---------- */
    function clearItems() {
        if (!field) { return; }
        closeCard();
        var items = field.querySelectorAll('.formula-item');
        for (var i = 0; i < items.length; i++) {
            if (items[i].parentNode) { items[i].parentNode.removeChild(items[i]); }
        }
    }

    /* ---------- 按当前设置创建一条漂浮项 ---------- */
    function buildItem(d, idx, reduced) {
        var item = document.createElement('span');
        item.className = 'formula-item';
        renderLatex(item, d.formula || '', false); // 行内渲染：漂浮项保持小字号
        item.tabIndex = 0;                         // 键盘可聚焦
        item.setAttribute('role', 'button');
        // KaTeX 渲染出的 DOM 对读屏器不友好，用 aria-label 提供可读描述
        item.setAttribute('aria-label', (d.name || '公式') + '：' + (d.proposer || ''));

        /* 左右两侧交替分布：偶数在左，奇数在右，位置随机 */
        var side = idx % 2 === 0;
        var gutterW = Math.min(window.innerWidth * 0.14, 220);
        var left = side
            ? Math.random() * (gutterW - 60)
            : window.innerWidth - gutterW + Math.random() * (gutterW - 80);
        item.style.left = left + 'px';

        if (reduced) {
            /* 减弱动画：固定位置 + 降低透明度，不播放浮动动画 */
            item.style.bottom = 'auto';
            item.style.top = (6 + Math.random() * 82) + '%';
            item.style.animation = 'none';
            item.style.opacity = '0.2';
        } else {
            /* 按设置生成动画时长：
               - uniform：每条时长相同（=speed），负延迟错开相位；
               - random ：以 speed 为基准 ±40% 随机，各条互不相同。 */
            var dur, delay;
            if (settings.speedMode === 'uniform') {
                dur = settings.speed;
                delay = -Math.random() * settings.speed;
            } else {
                dur = settings.speed * (0.6 + Math.random() * 0.8);
                delay = -Math.random() * settings.speed;
            }
            item.style.animationDuration = dur + 's';
            item.style.animationDelay = delay + 's';
            item.style.fontSize = settings.size + 'px'; // KaTeX 行内渲染跟随 font-size
        }
        field.appendChild(item);

        /* ---------- 悬停暂停动画（被捕获时不再响应悬停） ---------- */
        item.addEventListener('pointerenter', function () {
            if (!item.classList.contains('captured')) { item.classList.add('hovered'); }
        });
        item.addEventListener('pointerleave', function () {
            item.classList.remove('hovered');
        });

        /* ---------- 拖拽捕获：拖动 >6px 视为"抓住"，松手即弹出介绍 ---------- */
        var dragging = false;
        var moved = false;
        var startX = 0;
        var startY = 0;

        item.addEventListener('pointerdown', function (e) {
            dragging = true;
            moved = false;
            startX = e.clientX;
            startY = e.clientY;
            item.classList.add('held');
            try { item.setPointerCapture(e.pointerId); } catch (err) {}
            e.preventDefault();
        });
        item.addEventListener('pointermove', function (e) {
            if (!dragging) { return; }
            var dx = e.clientX - startX;
            var dy = e.clientY - startY;
            if (!moved && Math.sqrt(dx * dx + dy * dy) > 6) {
                /* 位移超过阈值：进入拖拽态，停掉动画并跟随指针 */
                moved = true;
                item.style.animation = 'none';
                item.style.bottom = 'auto';
                item.style.transform = 'none';
            }
            if (moved) {
                item.style.left = (e.clientX - 40) + 'px';
                item.style.top = (e.clientY - 10) + 'px';
            }
        });
        var endDrag = function () {
            if (!dragging) { return; }
            dragging = false;
            item.classList.remove('held');
            if (moved) {
                /* 拖拽松手：捕获该公式并立即弹出介绍卡 */
                item.classList.add('captured');
                openCard(item, d);
            } else {
                /* 未发生位移：视为点击 → 切换介绍卡 */
                toggleCard(item, d);
            }
        };
        item.addEventListener('pointerup', endDrag);
        item.addEventListener('pointercancel', function () {
            /* 指针事件被系统中断：直接复位，不弹卡 */
            dragging = false;
            moved = false;
            item.classList.remove('held');
        });

        /* ---------- 键盘操作：Enter / 空格 切换介绍卡 ---------- */
        item.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggleCard(item, d);
            }
        });
    }

    /* ---------- 全量重渲染（数据或设置变化后调用） ---------- */
    function renderNow() {
        ensureShell();
        clearItems();
        renderedOnce = true;
        if (!currentData || !currentData.length) { return; }

        /* 密度：取 设置值 与 总条数 的较小值；0 = 隐藏公式流 */
        var n = Math.min(Math.floor(settings.density), currentData.length);
        if (n <= 0) { return; }

        var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        var items = sample(currentData, n);
        items.forEach(function (d, idx) { buildItem(d, idx, reduced); });
    }

    /* ---------- 渲染请求入口：
       KaTeX 已就绪 → 宽屏直接渲染；
       未就绪     → 挂起请求并触发懒加载（加载完成回调中补渲染） ---------- */
    function requestRender() {
        if (katexOk) {
            if (isWide()) { renderNow(); }
        } else {
            pendingRender = true;
            if (isWide()) { ensureKatex(); } // 窄屏不产生 CDN 请求
        }
    }

    /* ---------- 跨宽屏阈值：从窄屏拉宽后补渲染 ---------- */
    if (wideMedia) {
        if (wideMedia.addEventListener) {
            wideMedia.addEventListener('change', function (e) {
                if (e.matches) { requestRender(); }
            });
        } else if (wideMedia.addListener) {
            wideMedia.addListener(function (mql) {
                if (mql.matches) { requestRender(); }
            });
        }
    }

    /* ============================================================
       八、官方数据获取与三层缓存编排
       ============================================================ */

    function fetchOfficial() {
        return fetch(dataUrl)
            .then(function (resp) {
                if (!resp.ok) { throw new Error('HTTP ' + resp.status); }
                return resp.json();
            })
            .then(function (data) {
                if (!Array.isArray(data) || !data.length) { throw new Error('empty data'); }
                return data;
            });
    }

    function storeOfficial(data) {
        var h = hash(JSON.stringify(data));
        officialHash = h;
        writeJSON(OFFICIAL_KEY, { v: 1, ts: Date.now(), hash: h, data: data });
    }

    /* 恢复官方数据（编辑器「恢复官方数据」调用）：
       清除用户覆盖 → 优先用缓存立即渲染 → 后台拉取最新官方并二次渲染 */
    function renderOfficial() {
        removeJSON(CUSTOM_KEY);
        officialChanged = false;
        var cached = readJSON(OFFICIAL_KEY);
        if (cached && Array.isArray(cached.data) && cached.data.length) {
            officialHash = cached.hash || null;
            currentData = cached.data;
            requestRender();
        }
        fetchOfficial().then(function (d) {
            storeOfficial(d);
            currentData = d;
            requestRender();
        }).catch(function () {
            if (!currentData) { currentData = FALLBACK_DATA; requestRender(); }
        });
    }

    /* 启动：数据来源优先级 custom > official 缓存 > fetch > fallback */
    function boot() {
        var custom = readJSON(CUSTOM_KEY);
        var cached = readJSON(OFFICIAL_KEY);

        if (custom && Array.isArray(custom.data) && custom.data.length) {
            /* 用户有本地覆盖：永远优先，官方数据只在后台刷新用于比对 */
            currentData = custom.data;
            requestRender();
            fetchOfficial().then(function (d) {
                storeOfficial(d);
                if (custom.baseHash !== officialHash) { officialChanged = true; }
            }).catch(function () { /* 后台刷新失败：保持用户数据 */ });
        } else if (cached && Array.isArray(cached.data) && cached.data.length) {
            /* 缓存优先（stale-while-revalidate）：立即渲染缓存，后台比对官方 */
            officialHash = cached.hash || null;
            currentData = cached.data;
            requestRender();
            fetchOfficial().then(function (d) {
                var h = hash(JSON.stringify(d));
                if (h !== officialHash) {
                    storeOfficial(d);
                    currentData = d;
                    requestRender(); // 官方更新 → 重渲染
                }
            }).catch(function () { /* 断网：缓存继续生效 */ });
        } else {
            /* 无任何缓存：等 fetch；失败才用 25 条兜底 */
            fetchOfficial().then(function (d) {
                storeOfficial(d);
                currentData = d;
                requestRender();
            }).catch(function () {
                currentData = FALLBACK_DATA;
                requestRender();
            });
        }
    }

    /* ============================================================
       九、对外 API（formular-editor.js / setting.js 使用）
       ============================================================ */
    var api = {
        /* 当前生效数据（用户覆盖优先）。编辑器应自行深拷贝再编辑 */
        getData: function () { return currentData || []; },

        /* 提交用户编辑：写 custom 缓存（含 baseHash）+ 立即重渲染 */
        setCustomData: function (arr) {
            if (!Array.isArray(arr)) { return; }
            currentData = arr;
            writeJSON(CUSTOM_KEY, { v: 1, baseHash: officialHash, ts: Date.now(), data: arr });
            requestRender();
        },

        /* 清除用户覆盖，回到官方数据（缓存优先 + 后台刷新） */
        resetToOfficial: function () { renderOfficial(); },

        /* 读取 / 写入显示设置（键值对 localStorage） */
        getSettings: function () {
            return { speedMode: settings.speedMode, speed: settings.speed, size: settings.size, density: settings.density };
        },
        setSettings: function (patch) {
            if (!patch || typeof patch !== 'object') { return; }
            settings = normalizeSettings(mergeSettings({
                speedMode: settings.speedMode,
                speed: settings.speed,
                size: settings.size,
                density: settings.density
            }, patch));
            /* 写入时带上结构版本号，供下次读取校验 */
            writeJSON(SETTINGS_KEY, {
                v: SETTINGS_VERSION,
                speedMode: settings.speedMode,
                speed: settings.speed,
                size: settings.size,
                density: settings.density
            });
            requestRender();
        },

        /* 官方数据是否在用户覆盖后发生过更新（编辑器显示恢复提示用） */
        isOfficialChanged: function () { return officialChanged; },

        /* KaTeX 就绪 Promise（惰性加载入口；编辑器预览前调用） */
        katexReady: function () { return ensureKatex(); },

        /* 同步渲染助手（KaTeX 缺席时降级为源码文本） */
        renderLatex: renderLatex,

        /* 由 formular-editor.js 注册的编辑器打开函数（设置面板调用） */
        openEditor: null
    };

    window.ZZKXS = window.ZZKXS || {};
    window.ZZKXS.formular = api;

    /* ---------- 启动 ---------- */
    boot();
})();
