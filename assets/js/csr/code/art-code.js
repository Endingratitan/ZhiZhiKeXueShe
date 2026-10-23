/* ============================================================
   CSR · 代码渲染器（assets/js/csr/code/art-code.js）
   职责：把 CSR-MD 输出的 <pre class="art-code" data-lang> 增强为
     - .art-code-block 外壳（直角边框 + 语言标签 + 复制按钮）
     - hljs 语法高亮（通过 assets/deps/loader.js 的 ZZKXS.deps.hljs()，失败则保持纯文本）
     - 明暗主题切换（vendor/hljs/styles/github*.min.css，跟随 data-theme）
   依赖：window.ZZKXS.deps（loader.js）；不依赖站点其它 JS。
   ============================================================ */

const HLJS_CSS = {
    light: new URL('../../../vendor/hljs/styles/github.min.css', import.meta.url).href,
    dark: new URL('../../../vendor/hljs/styles/github-dark.min.css', import.meta.url).href
};

const LANG_LABEL = {
    javascript: 'JavaScript', typescript: 'TypeScript', python: 'Python',
    bash: 'Bash', shell: 'Shell', cpp: 'C++', csharp: 'C#', c: 'C',
    json: 'JSON', html: 'HTML', xml: 'XML', css: 'CSS', sql: 'SQL',
    java: 'Java', go: 'Go', rust: 'Rust', kotlin: 'Kotlin', swift: 'Swift',
    latex: 'LaTeX', markdown: 'Markdown', yaml: 'YAML', toml: 'TOML',
    diff: 'Diff', plaintext: 'Text', text: 'Text', ini: 'INI', dockerfile: 'Dockerfile'
};

function langLabel(lang) {
    if (!lang) { return 'TEXT'; }
    return LANG_LABEL[lang] || String(lang).toUpperCase();
}

function ensureThemeCss() {
    const wantDark = document.documentElement.getAttribute('data-theme') === 'dark';
    let link = document.getElementById('art-hljs-theme');
    if (!link) {
        link = document.createElement('link');
        link.id = 'art-hljs-theme';
        link.rel = 'stylesheet';
        document.head.appendChild(link);
    }
    const href = wantDark ? HLJS_CSS.dark : HLJS_CSS.light;
    if (link.getAttribute('href') !== href) { link.setAttribute('href', href); }
}

let themeObserver = null;
function watchTheme() {
    if (themeObserver) { return; }
    themeObserver = new MutationObserver(() => ensureThemeCss());
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}

function buildBar(pre) {
    const lang = (pre.getAttribute('data-lang') || '').trim();
    const bar = document.createElement('div');
    bar.className = 'art-code-bar';

    const label = document.createElement('span');
    label.className = 'art-code-lang';
    label.textContent = langLabel(lang);
    bar.appendChild(label);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'art-code-copy';
    btn.textContent = '复制';
    btn.setAttribute('aria-label', '复制代码');
    btn.addEventListener('click', () => copyCode(pre, btn));
    bar.appendChild(btn);
    return bar;
}

async function copyCode(pre, btn) {
    const codeEl = pre.querySelector('code');
    const text = codeEl ? codeEl.textContent : pre.textContent;
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
        } else {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            ta.remove();
        }
        btn.textContent = '已复制';
        btn.classList.add('is-done');
        setTimeout(() => { btn.textContent = '复制'; btn.classList.remove('is-done'); }, 1500);
    } catch (e) {
        btn.textContent = '复制失败';
        setTimeout(() => { btn.textContent = '复制'; }, 1500);
    }
}

async function highlightAll(codes) {
    try {
        const deps = window.ZZKXS && window.ZZKXS.deps;
        if (!deps || typeof deps.hljs !== 'function') { return; }
        const ok = await deps.hljs();
        if (!ok || !window.hljs || typeof window.hljs.highlightElement !== 'function') { return; }
        codes.forEach((code) => {
            if (code.getAttribute('data-art-hljs') === '1') { return; }
            const m = /language-([a-z0-9_+-]+)/i.exec(code.className);
            const lang = m ? m[1].toLowerCase() : '';
            if (lang && window.hljs.getLanguage && !window.hljs.getLanguage(lang)) { return; }
            try {
                window.hljs.highlightElement(code);
                code.setAttribute('data-art-hljs', '1');
            } catch (e) { /* 单块失败不影响其它 */ }
        });
    } catch (e) { /* 高亮失败保持纯文本 */ }
}

/**
 * 增强容器内所有代码块（幂等，可多次调用）。
 * @param {HTMLElement} container 文章正文容器
 */
export async function enhanceCode(container) {
    if (!container) { return; }
    ensureThemeCss();
    watchTheme();

    const pres = Array.from(container.querySelectorAll('pre.art-code'));
    if (!pres.length) { return; }

    const codes = [];
    pres.forEach((pre) => {
        let block = pre.closest('.art-code-block');
        if (!block) {
            block = document.createElement('div');
            block.className = 'art-code-block';
            pre.parentNode.insertBefore(block, pre);
            block.appendChild(pre);
            block.insertBefore(buildBar(pre), pre);
        }
        pre.classList.add('is-enhanced');
        const code = pre.querySelector('code');
        if (code) { codes.push(code); }
    });

    await highlightAll(codes);
}

export default enhanceCode;
