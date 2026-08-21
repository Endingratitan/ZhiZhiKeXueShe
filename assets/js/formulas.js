/* ============================================================
   致知科学社 · 物理公式装饰流（全站）
   数据来源：assets/data/formulas.json（优先 fetch 获取）
   兜底：当 fetch 不可用（如 file:// 本地直接打开）时，
   使用下方 FALLBACK_DATA 内嵌数据，保证公式流始终显示。
   更新数据时请同步 formulas.json 与 FALLBACK_DATA。
   功能：两侧漂浮 / 悬停暂停 / 拖拽拦截查看介绍 / 键盘可操作
   ============================================================ */
(function () {
    'use strict';

    // 窄屏（两侧留白不足）不启用
    if (!window.matchMedia || !window.matchMedia('(min-width: 1080px)').matches) { return; }

    // 内嵌兜底数据（与 assets/data/formulas.json 保持一致）
    var FALLBACK_DATA = [
    {
        "formula": "F = ma",
        "name": "牛顿第二定律",
        "proposer": "艾萨克·牛顿（Isaac Newton）",
        "theory": "经典力学 · 1687"
    },
    {
        "formula": "F = Gm₁m₂/r²",
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
        "formula": "L = Iω",
        "name": "角动量公式",
        "proposer": "莱昂哈德·欧拉（Leonhard Euler）",
        "theory": "刚体力学 · 1765"
    },
    {
        "formula": "τ = Iα",
        "name": "刚体转动定律",
        "proposer": "莱昂哈德·欧拉（Leonhard Euler）",
        "theory": "刚体力学 · 1765"
    },
    {
        "formula": "W = F·d·cosθ",
        "name": "功的定义",
        "proposer": "加斯帕尔-古斯塔夫·科里奥利（G.-G. Coriolis）",
        "theory": "经典力学 · 1829"
    },
    {
        "formula": "K = ½mv²",
        "name": "动能公式",
        "proposer": "戈特弗里德·莱布尼茨（G. W. Leibniz）",
        "theory": "经典力学 · 1686"
    },
    {
        "formula": "F = −kx",
        "name": "胡克定律",
        "proposer": "罗伯特·胡克（Robert Hooke）",
        "theory": "弹性力学 · 1660"
    },
    {
        "formula": "T = 2π√(L/g)",
        "name": "单摆周期公式",
        "proposer": "克里斯蒂安·惠更斯（Christiaan Huygens）",
        "theory": "经典力学 · 1673"
    },
    {
        "formula": "F = mv²/r",
        "name": "向心力公式",
        "proposer": "克里斯蒂安·惠更斯（Christiaan Huygens）",
        "theory": "圆周运动 · 1659"
    },
    {
        "formula": "F = kq₁q₂/r²",
        "name": "库仑定律",
        "proposer": "夏尔·库仑（Charles Coulomb）",
        "theory": "静电学 · 1785"
    },
    {
        "formula": "E = F/q",
        "name": "电场强度定义",
        "proposer": "迈克尔·法拉第（Michael Faraday）",
        "theory": "电磁学 · 1837"
    },
    {
        "formula": "∮E·dA = Q/ε₀",
        "name": "高斯定律",
        "proposer": "卡尔·弗里德里希·高斯（C. F. Gauss）",
        "theory": "静电学 · 1835"
    },
    {
        "formula": "V = IR",
        "name": "欧姆定律",
        "proposer": "格奥尔格·欧姆（Georg Ohm）",
        "theory": "电路 · 1827"
    },
    {
        "formula": "P = IV",
        "name": "电功率公式",
        "proposer": "詹姆斯·焦耳（James Joule）",
        "theory": "电路 · 1841"
    },
    {
        "formula": "F = qv×B",
        "name": "磁场中的洛伦兹力",
        "proposer": "亨德里克·洛伦兹（Hendrik Lorentz）",
        "theory": "电磁学 · 1895"
    },
    {
        "formula": "∇×E = −∂B/∂t",
        "name": "法拉第电磁感应定律",
        "proposer": "迈克尔·法拉第（Michael Faraday）",
        "theory": "电磁学 · 1831"
    },
    {
        "formula": "∮B·dl = μ₀I",
        "name": "安培环路定理",
        "proposer": "安德烈-玛丽·安培（A.-M. Ampère）",
        "theory": "电磁学 · 1826"
    },
    {
        "formula": "∇·E = ρ/ε₀",
        "name": "高斯定律（微分形式）",
        "proposer": "卡尔·弗里德里希·高斯 / 麦克斯韦",
        "theory": "电磁学 · 1861"
    },
    {
        "formula": "∇·B = 0",
        "name": "磁通连续性（无磁单极）",
        "proposer": "卡尔·弗里德里希·高斯（C. F. Gauss）",
        "theory": "电磁学 · 1861"
    },
    {
        "formula": "F = q(E + v×B)",
        "name": "洛伦兹力完整公式",
        "proposer": "亨德里克·洛伦兹（Hendrik Lorentz）",
        "theory": "电磁学 · 1895"
    },
    {
        "formula": "PV = nRT",
        "name": "理想气体状态方程",
        "proposer": "埃米尔·克拉珀龙（Émile Clapeyron）",
        "theory": "热力学 · 1834"
    },
    {
        "formula": "ΔU = Q − W",
        "name": "热力学第一定律",
        "proposer": "鲁道夫·克劳修斯（Rudolf Clausius）",
        "theory": "热力学 · 1850"
    },
    {
        "formula": "ΔS ≥ 0",
        "name": "熵增原理（第二定律）",
        "proposer": "鲁道夫·克劳修斯（Rudolf Clausius）",
        "theory": "热力学 · 1865"
    },
    {
        "formula": "S = k ln W",
        "name": "玻尔兹曼熵公式",
        "proposer": "路德维希·玻尔兹曼（Ludwig Boltzmann）",
        "theory": "统计力学 · 1877"
    },
    {
        "formula": "η = 1 − T_c/T_h",
        "name": "卡诺热机效率",
        "proposer": "萨迪·卡诺（Sadi Carnot）",
        "theory": "热力学 · 1824"
    },
    {
        "formula": "q = −k∇T",
        "name": "傅里叶导热定律",
        "proposer": "约瑟夫·傅里叶（Joseph Fourier）",
        "theory": "热传导 · 1822"
    },
    {
        "formula": "P = ⅓nmv̄²",
        "name": "理想气体压强（动理论）",
        "proposer": "丹尼尔·伯努利（Daniel Bernoulli）",
        "theory": "气体动理论 · 1738"
    },
    {
        "formula": "C = Q/ΔT",
        "name": "热容定义",
        "proposer": "约瑟夫·布莱克（Joseph Black）",
        "theory": "热学 · 1760"
    },
    {
        "formula": "Q = mL",
        "name": "相变潜热公式",
        "proposer": "约瑟夫·布莱克（Joseph Black）",
        "theory": "热学 · 1761"
    },
    {
        "formula": "E = hν",
        "name": "普朗克能量子假设",
        "proposer": "马克斯·普朗克（Max Planck）",
        "theory": "量子论 · 1900"
    },
    {
        "formula": "iħ∂ψ/∂t = Ĥψ",
        "name": "薛定谔方程",
        "proposer": "埃尔温·薛定谔（Erwin Schrödinger）",
        "theory": "量子力学 · 1926"
    },
    {
        "formula": "ΔxΔp ≥ ħ/2",
        "name": "海森堡不确定性原理",
        "proposer": "维尔纳·海森堡（Werner Heisenberg）",
        "theory": "量子力学 · 1927"
    },
    {
        "formula": "λ = h/p",
        "name": "德布罗意物质波关系",
        "proposer": "路易·德布罗意（Louis de Broglie）",
        "theory": "量子力学 · 1924"
    },
    {
        "formula": "E_k = hν − W₀",
        "name": "光电效应方程",
        "proposer": "阿尔伯特·爱因斯坦（Albert Einstein）",
        "theory": "量子论 · 1905"
    },
    {
        "formula": "ψ(x,t) = Ae^{i(kx−ωt)}",
        "name": "自由粒子平面波",
        "proposer": "埃尔温·薛定谔（Erwin Schrödinger）",
        "theory": "量子力学 · 1926"
    },
    {
        "formula": "E_n = −13.6/n² eV",
        "name": "氢原子能级公式",
        "proposer": "尼尔斯·玻尔（Niels Bohr）",
        "theory": "原子物理 · 1913"
    },
    {
        "formula": "r_n = n²a₀",
        "name": "玻尔轨道半径",
        "proposer": "尼尔斯·玻尔（Niels Bohr）",
        "theory": "原子物理 · 1913"
    },
    {
        "formula": "E = −μ·B",
        "name": "磁矩在磁场中的能量",
        "proposer": "沃尔夫冈·泡利（Wolfgang Pauli）",
        "theory": "量子力学 · 1925"
    },
    {
        "formula": "ψ = Σcₙψₙ",
        "name": "态叠加原理",
        "proposer": "保罗·狄拉克（Paul Dirac）",
        "theory": "量子力学 · 1930"
    },
    {
        "formula": "E = mc²",
        "name": "质能方程",
        "proposer": "阿尔伯特·爱因斯坦（Albert Einstein）",
        "theory": "狭义相对论 · 1905"
    },
    {
        "formula": "E² = (pc)² + (m₀c²)²",
        "name": "相对论能量动量关系",
        "proposer": "阿尔伯特·爱因斯坦（Albert Einstein）",
        "theory": "狭义相对论 · 1905"
    },
    {
        "formula": "γ = 1/√(1−v²/c²)",
        "name": "洛伦兹因子",
        "proposer": "亨德里克·洛伦兹（Hendrik Lorentz）",
        "theory": "狭义相对论 · 1904"
    },
    {
        "formula": "G_μν = (8πG/c⁴)T_μν",
        "name": "爱因斯坦场方程",
        "proposer": "阿尔伯特·爱因斯坦（Albert Einstein）",
        "theory": "广义相对论 · 1915"
    },
    {
        "formula": "R_μν − ½Rg_μν = κT_μν",
        "name": "场方程（曲率形式）",
        "proposer": "爱因斯坦 / 大卫·希尔伯特",
        "theory": "广义相对论 · 1915"
    },
    {
        "formula": "ds² = −c²dt² + dx² + dy² + dz²",
        "name": "闵可夫斯基度规",
        "proposer": "赫尔曼·闵可夫斯基（Hermann Minkowski）",
        "theory": "狭义相对论 · 1908"
    },
    {
        "formula": "Δt = γΔt₀",
        "name": "时间膨胀效应",
        "proposer": "阿尔伯特·爱因斯坦（Albert Einstein）",
        "theory": "狭义相对论 · 1905"
    },
    {
        "formula": "f' = f√((1−v/c)/(1+v/c))",
        "name": "相对论多普勒效应",
        "proposer": "阿尔伯特·爱因斯坦（Albert Einstein）",
        "theory": "狭义相对论 · 1905"
    },
    {
        "formula": "ρ(∂v/∂t + v·∇v) = −∇p + μ∇²v + f",
        "name": "纳维-斯托克斯方程",
        "proposer": "纳维（Navier）/ 斯托克斯（Stokes）",
        "theory": "流体力学 · 1845"
    },
    {
        "formula": "∂ρ/∂t + ∇·(ρv) = 0",
        "name": "连续性方程",
        "proposer": "莱昂哈德·欧拉（Leonhard Euler）",
        "theory": "流体力学 · 1757"
    },
    {
        "formula": "P + ½ρv² + ρgh = const",
        "name": "伯努利方程",
        "proposer": "丹尼尔·伯努利（Daniel Bernoulli）",
        "theory": "流体力学 · 1738"
    },
    {
        "formula": "F_b = ρgV",
        "name": "阿基米德浮力定律",
        "proposer": "阿基米德（Archimedes）",
        "theory": "流体静力学 · 公元前250年"
    },
    {
        "formula": "Re = ρvL/μ",
        "name": "雷诺数",
        "proposer": "奥斯本·雷诺（Osborne Reynolds）",
        "theory": "流体力学 · 1883"
    },
    {
        "formula": "Q = πr⁴ΔP/(8μL)",
        "name": "泊肃叶定律",
        "proposer": "让·泊肃叶（Jean Poiseuille）",
        "theory": "流体力学 · 1838"
    },
    {
        "formula": "v = √(2gh)",
        "name": "托里拆利定律",
        "proposer": "埃万杰利斯塔·托里拆利（E. Torricelli）",
        "theory": "流体力学 · 1643"
    },
    {
        "formula": "Ra = gβΔTL³/(να)",
        "name": "瑞利数",
        "proposer": "瑞利勋爵（Lord Rayleigh）",
        "theory": "对流换热 · 1916"
    },
    {
        "formula": "v = fλ",
        "name": "波速公式",
        "proposer": "通用波动学基本关系",
        "theory": "波动学 · 基础关系"
    },
    {
        "formula": "n₁sinθ₁ = n₂sinθ₂",
        "name": "斯涅尔折射定律",
        "proposer": "威理博·斯涅尔（Willebrord Snellius）",
        "theory": "光学 · 1621"
    },
    {
        "formula": "1/f = 1/dₒ + 1/dᵢ",
        "name": "薄透镜成像公式",
        "proposer": "卡尔·弗里德里希·高斯（C. F. Gauss）",
        "theory": "几何光学 · 1841"
    },
    {
        "formula": "d·sinθ = mλ",
        "name": "光栅衍射方程",
        "proposer": "约瑟夫·夫琅禾费（J. von Fraunhofer）",
        "theory": "波动光学 · 1821"
    },
    {
        "formula": "E = hc/λ",
        "name": "光子能量公式",
        "proposer": "爱因斯坦 / 普朗克",
        "theory": "量子光学 · 1905"
    },
    {
        "formula": "I = I₀cos²θ",
        "name": "马吕斯定律",
        "proposer": "艾蒂安-路易·马吕斯（É.-L. Malus）",
        "theory": "偏振光学 · 1809"
    },
    {
        "formula": "n = c/v",
        "name": "折射率定义",
        "proposer": "斯涅尔 / 勒内·笛卡尔",
        "theory": "光学 · 1621"
    },
    {
        "formula": "θ = 1.22λ/D",
        "name": "瑞利判据",
        "proposer": "瑞利勋爵（Lord Rayleigh）",
        "theory": "光学 · 1879"
    },
    {
        "formula": "e^{iπ} + 1 = 0",
        "name": "欧拉恒等式",
        "proposer": "莱昂哈德·欧拉（Leonhard Euler）",
        "theory": "数学 · 1748"
    },
    {
        "formula": "∫₋∞^∞ e^{−x²}dx = √π",
        "name": "高斯积分",
        "proposer": "卡尔·弗里德里希·高斯（C. F. Gauss）",
        "theory": "数学 · 1809"
    },
    {
        "formula": "ζ(s) = Σ 1/n^s",
        "name": "黎曼ζ函数",
        "proposer": "伯恩哈德·黎曼（Bernhard Riemann）",
        "theory": "数学 · 1859"
    },
    {
        "formula": "∇²φ = 0",
        "name": "拉普拉斯方程",
        "proposer": "皮埃尔-西蒙·拉普拉斯（P.-S. Laplace）",
        "theory": "数学物理 · 1782"
    },
    {
        "formula": "δS = 0",
        "name": "最小作用量原理",
        "proposer": "皮埃尔·莫佩尔蒂（P.-L. Maupertuis）",
        "theory": "分析力学 · 1744"
    },
    {
        "formula": "dL/dt = τ",
        "name": "角动量定理",
        "proposer": "莱昂哈德·欧拉（Leonhard Euler）",
        "theory": "刚体力学 · 1765"
    },
    {
        "formula": "P(A∪B) = P(A) + P(B)",
        "name": "概率加法法则",
        "proposer": "布莱兹·帕斯卡（Blaise Pascal）",
        "theory": "概率论 · 1654"
    },
    {
        "formula": "σ = √(Σ(x−μ)²/N)",
        "name": "标准差",
        "proposer": "卡尔·皮尔逊（Karl Pearson）",
        "theory": "统计学 · 1893"
    },
    {
        "formula": "x = x₀ + v₀t + ½at²",
        "name": "匀变速直线运动",
        "proposer": "伽利略·伽利莱（Galileo Galilei）",
        "theory": "运动学 · 1638"
    },
    {
        "formula": "v = v₀ + at",
        "name": "匀变速速度公式",
        "proposer": "伽利略·伽利莱（Galileo Galilei）",
        "theory": "运动学 · 1638"
    },
    {
        "formula": "m₁v₁ + m₂v₂ = m₁v₁′ + m₂v₂′",
        "name": "动量守恒定律",
        "proposer": "笛卡尔 / 艾萨克·牛顿",
        "theory": "经典力学 · 1687"
    },
    {
        "formula": "E = K + U",
        "name": "机械能守恒",
        "proposer": "尤利乌斯·冯·迈尔（Julius von Mayer）",
        "theory": "能量守恒 · 1842"
    },
    {
        "formula": "F_d = ½C_dρAv²",
        "name": "空气阻力公式",
        "proposer": "瑞利勋爵（Lord Rayleigh）",
        "theory": "流体力学 · 1904"
    },
    {
        "formula": "P = W/t",
        "name": "功率定义",
        "proposer": "詹姆斯·瓦特（James Watt）",
        "theory": "经典力学 · 1782"
    },
    {
        "formula": "λ_max T = b",
        "name": "维恩位移定律",
        "proposer": "威廉·维恩（Wilhelm Wien）",
        "theory": "热辐射 · 1893"
    },
    {
        "formula": "j = σT⁴",
        "name": "斯特藩-玻尔兹曼定律",
        "proposer": "斯特藩（Stefan）/ 玻尔兹曼（Boltzmann）",
        "theory": "热辐射 · 1879/1884"
    }
];

    // 依据脚本自身位置推导 data 目录，兼容任意页面深度
    var script = document.currentScript;
    var base = script && script.src ? script.src.replace(/[^/]*$/, '') : '';
    var dataUrl = base + '../data/formulas.json';

    // 容器由脚本自建，所有页面通用
    var field = document.createElement('div');
    field.className = 'formula-field';
    field.id = 'formulaField';
    document.body.appendChild(field);

    function start(data) {
        if (Object.prototype.toString.call(data) !== '[object Array]' || !data.length) { return; }
        init(field, data);
    }

    fetch(dataUrl)
        .then(function (resp) {
            if (!resp.ok) { throw new Error('HTTP ' + resp.status); }
            return resp.json();
        })
        .then(start)
        .catch(function () {
            // fetch 失败（file:// 或网络问题）时使用内嵌数据兜底
            start(FALLBACK_DATA);
        });

    function init(field, data) {
        var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        var card = document.createElement('div');
        card.className = 'formula-card';
        card.hidden = true;
        card.setAttribute('role', 'dialog');
        card.setAttribute('aria-label', '公式介绍');
        card.innerHTML =
            '<button type="button" class="fc-close" aria-label="关闭">×</button>' +
            '<p class="fc-formula"></p>' +
            '<p class="fc-name"></p>' +
            '<p class="fc-meta"></p>';
        document.body.appendChild(card);

        var cardFormula = card.querySelector('.fc-formula');
        var cardName = card.querySelector('.fc-name');
        var cardMeta = card.querySelector('.fc-meta');
        var activeItem = null;

        function closeCard() {
            card.hidden = true;
            if (activeItem) {
                activeItem.classList.remove('captured');
                activeItem.style.left = '';
                activeItem.style.top = '';
                activeItem.style.bottom = '';
                activeItem.style.animation = '';
                activeItem = null;
            }
        }

        function openCard(item, d) {
            cardFormula.textContent = d.formula;
            cardName.textContent = d.name;
            cardMeta.textContent = d.proposer + ' · ' + d.theory;
            card.hidden = false;
            var r = item.getBoundingClientRect();
            var cw = card.offsetWidth;
            var ch = card.offsetHeight;
            var left = r.right + 14;
            if (left + cw > window.innerWidth - 14) { left = r.left - cw - 14; }
            left = Math.max(14, left);
            var top = Math.max(14, Math.min(r.top - 30, window.innerHeight - ch - 14));
            card.style.left = left + 'px';
            card.style.top = top + 'px';
            activeItem = item;
        }

        function toggleCard(item, d) {
            if (card.hidden) { openCard(item, d); }
            else if (activeItem === item) { closeCard(); }
            else { openCard(item, d); }
        }

        data.forEach(function (d, idx) {
            var item = document.createElement('span');
            item.className = 'formula-item';
            item.textContent = d.formula;
            item.tabIndex = 0;
            item.setAttribute('role', 'button');
            item.setAttribute('aria-label', d.name + '：' + d.proposer);

            var side = idx % 2 === 0;
            var gutterW = Math.min(window.innerWidth * 0.14, 220);
            var left = side
                ? Math.random() * (gutterW - 60)
                : window.innerWidth - gutterW + Math.random() * (gutterW - 80);
            item.style.left = left + 'px';

            if (reduced) {
                item.style.bottom = 'auto';
                item.style.top = (6 + Math.random() * 82) + '%';
                item.style.animation = 'none';
                item.style.opacity = '0.2';
            } else {
                item.style.animationDuration = (14 + Math.random() * 14) + 's';
                item.style.animationDelay = (-Math.random() * 20) + 's';
                item.style.fontSize = (12.5 + Math.random() * 3) + 'px';
            }
            field.appendChild(item);

            item.addEventListener('pointerenter', function () {
                if (!item.classList.contains('captured')) { item.classList.add('hovered'); }
            });
            item.addEventListener('pointerleave', function () {
                item.classList.remove('hovered');
            });

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
                    item.classList.add('captured');
                    openCard(item, d);
                } else {
                    toggleCard(item, d);
                }
            };
            item.addEventListener('pointerup', endDrag);
            item.addEventListener('pointercancel', function () {
                dragging = false;
                moved = false;
                item.classList.remove('held');
            });
            item.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggleCard(item, d);
                }
            });
        });

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
