/* ============================================================
   致知科学社 · 物理公式装饰流（全站脚本）
   ------------------------------------------------------------
   【功能概览】
   - 在页面两侧生成漂浮的物理公式装饰流（仅宽屏 ≥1080px 启用）；
   - 悬停暂停动画；按住拖拽可"捕获"公式并弹出介绍卡片；
   - 键盘可操作（Tab 聚焦 + Enter/空格 打开卡片，Esc 关闭）；
   - 尊重 prefers-reduced-motion：减弱动画、公式静止摆放。

   【数据来源（两级）】
   1) 主数据：assets/data/formulas.json —— 共 100 条公式，
      通过 fetch 优先加载，是线上实际展示的完整公式库；
   2) 兜底数据：本文件下方的 FALLBACK_DATA —— 刻意只保留 25 条
      各领域最经典的公式。它只在 fetch 失败时启用（例如用
      file:// 直接打开页面、CDN/网络受限），目的是保证公式流
      "仍然可见"而不是追求完整，因此【不需要】与 formulas.json
      保持同数量——100 与 25 是设计上的有意差异。

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
     大版本升级导致渲染行为变化）；
   - 若 CDN 加载失败（断网 / 被墙 / CSP 限制），自动降级为
     直接显示 LaTeX 源码文本，公式流功能不受影响；
   - KaTeX 字体由其 CSS 相对路径自动加载，无需额外配置；
   - 国内网络若访问 jsDelivr 不稳定，可改为 unpkg 或把
     katex.min.css / katex.min.js 下载到 assets/vendor/katex/
     本地托管后替换下方两个常量。

   【渲染降级策略（三级）】
   1. KaTeX 就绪        → katex.render 渲染为排版级数学公式；
   2. KaTeX 加载失败    → 显示 LaTeX 源码（可读，信息不丢失）；
   3. 单条公式语法错误  → throwOnError:false，仅该条红色报错，
                          不影响其余公式。

   【修改指南】
   - 新增/修改公式：编辑 assets/data/formulas.json；
   - 调整兜底集合：编辑 FALLBACK_DATA（25 条）；
   - 无 HTML 改动需求：样式与容器全部由本脚本自动注入；
   - JSON 文件不支持注释，因此所有维护说明都集中在本文件头部。
   ============================================================ */
(function () {
    'use strict';

    /* ---------- 窄屏提前退出 ----------
       窄屏两侧没有足够留白放置公式流，直接返回；
       同时也避免移动端产生一次无意义的 KaTeX CDN 请求。 */
    if (!window.matchMedia || !window.matchMedia('(min-width: 1080px)').matches) { return; }

    /* ============================================================
       KaTeX CDN 常量（版本锁定）
       - KATEX_VERSION：锁定 0.16.x 的最新补丁版，防止 CDN 自动升大版本
       - KATEX_JS / KATEX_CSS：jsDelivr 官方分发地址
       ============================================================ */
    var KATEX_VERSION = '0.16.21';
    var KATEX_JS = 'https://cdn.jsdelivr.net/npm/katex@' + KATEX_VERSION + '/dist/katex.min.js';
    var KATEX_CSS = 'https://cdn.jsdelivr.net/npm/katex@' + KATEX_VERSION + '/dist/katex.min.css';

    /* ---------- 兜底数据（25 条 · LaTeX）----------
       仅含各领域最经典公式，用于 fetch 失败时维持公式流可见。
       与 formulas.json（100 条）刻意保持差异，见文件头说明。
       每条字段：formula(LaTeX 源码) / name / proposer / theory */
    var FALLBACK_DATA = [
    {
        "formula": "F = ma",
        "name": "牛顿第二定律",
        "proposer": "艾萨克·牛顿（Isaac Newton）",
        "theory": "经典力学 · 1687"
    },
    {
        "formula": "F = \\frac{G m_1 m_2}{r^2}",
        "name": "万有引力定律",
        "proposer": "艾萨克·牛顿（Isaac Newton）",
        "theory": "经典力学 · 1687"
    },
    {
        "formula": "p = mv",
        "name": "动量定义",
        "proposer": "勒内·笛卡尔（René Descartes）",
        "theory": "经典力学 · 1644"
    },
    {
        "formula": "T = 2\\pi \\sqrt{\\frac{L}{g}}",
        "name": "单摆周期公式",
        "proposer": "克里斯蒂安·惠更斯（Christiaan Huygens）",
        "theory": "经典力学 · 1673"
    },
    {
        "formula": "F = \\frac{k q_1 q_2}{r^2}",
        "name": "库仑定律",
        "proposer": "夏尔·库仑（Charles Coulomb）",
        "theory": "静电学 · 1785"
    },
    {
        "formula": "V = IR",
        "name": "欧姆定律",
        "proposer": "格奥尔格·欧姆（Georg Ohm）",
        "theory": "电路 · 1827"
    },
    {
        "formula": "\\oint \\vec{E}\\cdot d\\vec{A} = \\frac{Q}{\\varepsilon_0}",
        "name": "高斯定律",
        "proposer": "卡尔·弗里德里希·高斯（C. F. Gauss）",
        "theory": "静电学 · 1835"
    },
    {
        "formula": "\\nabla\\times\\vec{E} = -\\frac{\\partial\\vec{B}}{\\partial t}",
        "name": "法拉第电磁感应定律",
        "proposer": "迈克尔·法拉第（Michael Faraday）",
        "theory": "电磁学 · 1831"
    },
    {
        "formula": "PV = nRT",
        "name": "理想气体状态方程",
        "proposer": "埃米尔·克拉珀龙（Émile Clapeyron）",
        "theory": "热力学 · 1834"
    },
    {
        "formula": "\\Delta U = Q - W",
        "name": "热力学第一定律",
        "proposer": "鲁道夫·克劳修斯（Rudolf Clausius）",
        "theory": "热力学 · 1850"
    },
    {
        "formula": "\\Delta S \\geq 0",
        "name": "熵增原理（第二定律）",
        "proposer": "鲁道夫·克劳修斯（Rudolf Clausius）",
        "theory": "热力学 · 1865"
    },
    {
        "formula": "S = k\\ln W",
        "name": "玻尔兹曼熵公式",
        "proposer": "路德维希·玻尔兹曼（Ludwig Boltzmann）",
        "theory": "统计力学 · 1877"
    },
    {
        "formula": "E = h\\nu",
        "name": "普朗克能量子假设",
        "proposer": "马克斯·普朗克（Max Planck）",
        "theory": "量子论 · 1900"
    },
    {
        "formula": "i\\hbar \\frac{\\partial \\psi}{\\partial t} = \\hat{H}\\psi",
        "name": "薛定谔方程",
        "proposer": "埃尔温·薛定谔（Erwin Schrödinger）",
        "theory": "量子力学 · 1926"
    },
    {
        "formula": "\\Delta x\\,\\Delta p \\geq \\frac{\\hbar}{2}",
        "name": "海森堡不确定性原理",
        "proposer": "维尔纳·海森堡（Werner Heisenberg）",
        "theory": "量子力学 · 1927"
    },
    {
        "formula": "E = mc^2",
        "name": "质能方程",
        "proposer": "阿尔伯特·爱因斯坦（Albert Einstein）",
        "theory": "狭义相对论 · 1905"
    },
    {
        "formula": "\\gamma = \\frac{1}{\\sqrt{1 - v^2/c^2}}",
        "name": "洛伦兹因子",
        "proposer": "亨德里克·洛伦兹（Hendrik Lorentz）",
        "theory": "狭义相对论 · 1904"
    },
    {
        "formula": "P + \\tfrac{1}{2}\\rho v^2 + \\rho g h = \\text{const.}",
        "name": "伯努利方程",
        "proposer": "丹尼尔·伯努利（Daniel Bernoulli）",
        "theory": "流体力学 · 1738"
    },
    {
        "formula": "n_1\\sin\\theta_1 = n_2\\sin\\theta_2",
        "name": "斯涅尔折射定律",
        "proposer": "威理博·斯涅尔（Willebrord Snellius）",
        "theory": "光学 · 1621"
    },
    {
        "formula": "e^{i\\pi} + 1 = 0",
        "name": "欧拉恒等式",
        "proposer": "莱昂哈德·欧拉（Leonhard Euler）",
        "theory": "数学 · 1748"
    },
    {
        "formula": "\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}",
        "name": "高斯积分",
        "proposer": "卡尔·弗里德里希·高斯（C. F. Gauss）",
        "theory": "数学 · 1809"
    },
    {
        "formula": "\\lambda_{max} T = b",
        "name": "维恩位移定律",
        "proposer": "威廉·维恩（Wilhelm Wien）",
        "theory": "热辐射 · 1893"
    },
    {
        "formula": "j = \\sigma T^4",
        "name": "斯特藩-玻尔兹曼定律",
        "proposer": "斯特藩（Stefan）/ 玻尔兹曼（Boltzmann）",
        "theory": "热辐射 · 1879/1884"
    },
    {
        "formula": "v = f\\lambda",
        "name": "波速公式",
        "proposer": "通用波动学基本关系",
        "theory": "波动学 · 基础关系"
    },
    {
        "formula": "\\eta = 1 - \\frac{T_c}{T_h}",
        "name": "卡诺热机效率",
        "proposer": "萨迪·卡诺（Sadi Carnot）",
        "theory": "热力学 · 1824"
    }
    ];

    /* ============================================================
       懒加载 KaTeX（返回 Promise<boolean>）
       - 已加载过（window.katex 存在）→ 立即 resolve(true) 复用；
       - 未加载 → 注入 CSS link + 动态创建 <script> 拉取 JS；
       - 加载失败 → resolve(false)，【永不 reject】：
         公式流应能在 KaTeX 缺席时照常工作（降级为源码文本），
         不能让 CDN 故障拖垮整个装饰功能。
       ============================================================ */
    function loadKatex() {
        if (window.katex && typeof window.katex.render === 'function') {
            return Promise.resolve(true); // 同一页面重复加载时直接复用
        }
        // CSS 失败无碍：样式缺失时公式仍以源码文本显示
        var css = document.createElement('link');
        css.rel = 'stylesheet';
        css.href = KATEX_CSS;
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

    /* ============================================================
       渲染一条 LaTeX 公式到容器 el（会清空 el 原有内容）
       @param el           目标容器（漂浮项 <span> 或介绍卡 <p>）
       @param tex          LaTeX 源码
       @param displayMode  true=独立成行（详情卡），false=行内（漂浮项）
       降级链：
       KaTeX 可用且语法正确 → 排版渲染；
       KaTeX 不可用 / 单条出错 → textContent 显示 LaTeX 源码，
       保证信息不丢失。
       ============================================================ */
    function renderLatex(el, tex, displayMode) {
        if (window.katex && typeof window.katex.render === 'function') {
            try {
                window.katex.render(tex, el, {
                    displayMode: !!displayMode,
                    throwOnError: false, // 单条公式出错 → 红色提示而非抛异常中断整页
                    strict: false        // 关闭非标准写法的控制台告警
                });
                return;
            } catch (err) {
                /* 渲染异常 → 落入下方文本兜底 */
            }
        }
        el.textContent = tex; // KaTeX 缺席时显示源码，功能不中断
    }

    /* ---------- 依据脚本自身位置推导 data 目录，兼容任意页面深度 ---------- */
    var script = document.currentScript;
    var base = script && script.src ? script.src.replace(/[^/]*$/, '') : '';
    var dataUrl = base + '../data/formulas.json';

    /* ---------- 漂浮容器由脚本自建，所有页面通用 ---------- */
    var field = document.createElement('div');
    field.className = 'formula-field';
    field.id = 'formulaField';
    document.body.appendChild(field);

    /* ---------- 数据校验：必须是含元素的数组 ---------- */
    function start(data) {
        if (Object.prototype.toString.call(data) !== '[object Array]' || !data.length) { return; }
        init(field, data);
    }

    /* ============================================================
       并行加载「公式数据」与「KaTeX 引擎」，二者就绪后统一渲染。
       - 数据失败 → 兜底 FALLBACK_DATA（25 条）；
       - KaTeX 失败 → loadKatex resolve(false)，渲染自动降级，
         因此 Promise.all 不会因 CDN 故障而中断。
       ============================================================ */
    var dataPromise = fetch(dataUrl)
        .then(function (resp) {
            if (!resp.ok) { throw new Error('HTTP ' + resp.status); }
            return resp.json();
        })
        .catch(function () {
            // fetch 失败（file:// 或网络问题）时使用内嵌兜底数据
            return FALLBACK_DATA;
        });

    Promise.all([dataPromise, loadKatex()])
        .then(function (results) { start(results[0]); });

    /* ============================================================
       初始化公式流：创建介绍卡 + 逐条创建漂浮项并绑定交互
       @param field  漂浮容器
       @param data   公式数组（formulas.json 或 FALLBACK_DATA）
       ============================================================ */
    function init(field, data) {
        /* prefers-reduced-motion：减弱动画用户 → 公式静止半透明摆放 */
        var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        /* ---------- 介绍卡（点击/拖拽公式后弹出） ---------- */
        var card = document.createElement('div');
        card.className = 'formula-card';
        card.hidden = true;
        card.setAttribute('role', 'dialog');
        card.setAttribute('aria-label', '公式介绍');
        card.innerHTML =
            '<button type="button" class="fc-close" aria-label="关闭">×</button>' +
            '<p class="fc-formula"></p>' +   // 公式本体（KaTeX 行间渲染）
            '<p class="fc-name"></p>' +      // 公式名称
            '<p class="fc-meta"></p>';       // 提出者 · 领域年份
        document.body.appendChild(card);

        var cardFormula = card.querySelector('.fc-formula');
        var cardName = card.querySelector('.fc-name');
        var cardMeta = card.querySelector('.fc-meta');
        var activeItem = null; // 当前"被捕获"的漂浮项

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
            cardName.textContent = d.name;
            cardMeta.textContent = d.proposer + ' · ' + d.theory;
            renderLatex(cardFormula, d.formula, true); // 行间模式渲染，更醒目
            card.hidden = false;                       // 先显示再测量，尺寸才准确
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

        /* ---------- 逐条创建漂浮公式项 ---------- */
        data.forEach(function (d, idx) {
            var item = document.createElement('span');
            item.className = 'formula-item';
            renderLatex(item, d.formula, false); // 行内渲染：漂浮项保持小字号
            item.tabIndex = 0;                   // 键盘可聚焦
            item.setAttribute('role', 'button');
            // KaTeX 渲染出的 DOM 对读屏器不友好，用 aria-label 提供可读描述
            item.setAttribute('aria-label', d.name + '：' + d.proposer);

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
                /* 随机动画时长/延迟/字号，错落有致 */
                item.style.animationDuration = (14 + Math.random() * 14) + 's';
                item.style.animationDelay = (-Math.random() * 20) + 's';
                item.style.fontSize = (12.5 + Math.random() * 3) + 'px';
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
        });

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
})();
