/* ============================================================
   news-ar · info.json 解析与文章头注入
   职责：取 info.json + author-uids.json，归一化作者/编辑/栏目/封面/许可，
         把标题、摘要、日期、作者、编辑、标签、封面、许可、来源写进模板。
   （页面逻辑与 page.js 分开；两栏目各自一份，后续可有差异）
   ============================================================ */

const AUTHOR_UIDS_URL = new URL('../../assets/data/author-uids.json', location.href).href;

/* 栏目 → 列表页（占位：等各栏目列表页就绪后调整） */
const COLUMN_LINKS = {
    '社团动态': '../news/index.html',
    '科研科普': '../news/index.html',
    'HNPT 专栏': '../news/index.html',
    '技术文章': '../news/index.html',
    '博客': '../news/index.html'
};

async function fetchJson(url) {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) { throw new Error(url + ' HTTP ' + res.status); }
    return res.json();
}

function normalizePeople(list, registry) {
    if (!Array.isArray(list)) { return []; }
    return list.map((item) => {
        if (typeof item === 'number') {
            const row = registry && registry[String(item)];
            return { uid: item, name: (row && row.name) || ('uid:' + item), link: (row && row.link) || null };
        }
        return { uid: null, name: String(item), link: null };
    }).filter((p) => p.name);
}

function normalizeSource(src) {
    if (!src) { return null; }
    if (typeof src === 'string') { return { name: src, url: null }; }
    const url = typeof src.url === 'string' && /^(https?:\/\/|\/)/i.test(src.url) ? src.url : null;
    return { name: String(src.name || ''), url };
}

export function formatDate(iso) {
    if (!iso || typeof iso !== 'string') { return ''; }
    return iso.replace(/-/g, '.');
}

export async function loadInfo(bundleUrl) {
    const [info, registry] = await Promise.all([
        fetchJson(new URL('info.json', bundleUrl).href),
        fetchJson(AUTHOR_UIDS_URL).catch(() => ({}))
    ]);
    const coverUrl = info.cover ? new URL(info.cover, bundleUrl).href : null;
    return {
        raw: info,
        title: String(info.title || '未命名文章'),
        summary: String(info.summary || ''),
        date: info.date || '',
        updated: info.updated || '',
        authors: normalizePeople(info.authors, registry),
        editors: normalizePeople(info.editors, registry),
        column: String(info.column || '文章'),
        columnUrl: COLUMN_LINKS[info.column] || '',
        tags: Array.isArray(info.tags) ? info.tags.map(String) : [],
        license: typeof info.license === 'string' ? info.license : '',
        source: normalizeSource(info.source),
        coverUrl,
        draft: !!info.draft
    };
}

function el(id) { return document.getElementById(id); }

function metaItem(label, value) {
    const span = document.createElement('span');
    span.appendChild(document.createTextNode(label + ' '));
    const b = document.createElement('b');
    b.textContent = value;
    span.appendChild(b);
    return span;
}

function linkItem(label, name, href) {
    const span = document.createElement('span');
    span.appendChild(document.createTextNode(label + ' '));
    const b = document.createElement('b');
    if (href) {
        const a = document.createElement('a');
        a.href = href;
        a.textContent = name;
        b.appendChild(a);
    } else {
        b.textContent = name;
    }
    span.appendChild(b);
    return span;
}

function clear(node) { while (node.firstChild) { node.removeChild(node.firstChild); } }

/** 把归一化后的 info 注入模板 */
export function applyInfo(info, refs) {
    const kicker = el('artKicker');
    clear(kicker);
    if (info.columnUrl) {
        const a = document.createElement('a');
        a.href = info.columnUrl;
        a.textContent = info.column;
        kicker.appendChild(a);
    } else {
        kicker.appendChild(document.createTextNode(info.column));
    }
    if (info.draft) {
        const badge = document.createElement('span');
        badge.className = 'art-draft-badge';
        badge.textContent = 'DRAFT';
        kicker.appendChild(badge);
        document.documentElement.setAttribute('data-article-draft', '1');
        if (!document.querySelector('meta[name="robots"]')) {
            const meta = document.createElement('meta');
            meta.name = 'robots';
            meta.content = 'noindex';
            document.head.appendChild(meta);
        }
    }

    const title = `${info.title} · 致知科学社`;
    document.title = title;
    const desc = document.querySelector('meta[name="description"]');
    if (desc) { desc.setAttribute('content', info.summary || '致知科学社 · 文章'); }

    el('artTitle').textContent = info.title;
    const summary = el('artSummary');
    summary.textContent = info.summary;
    summary.hidden = !info.summary;

    const meta = el('artMeta');
    clear(meta);
    if (info.date) { meta.appendChild(metaItem('刊发', formatDate(info.date))); }
    if (info.updated && info.updated !== info.date) { meta.appendChild(metaItem('更新', formatDate(info.updated))); }
    if (info.authors.length) { meta.appendChild(metaItem('作者', info.authors.map((p) => p.name).join('、'))); }
    if (info.editors.length) { meta.appendChild(metaItem('编辑', info.editors.map((p) => p.name).join('、'))); }

    const tags = el('artTags');
    clear(tags);
    info.tags.forEach((t) => {
        const span = document.createElement('span');
        span.className = 'art-tag';
        span.textContent = t;
        tags.appendChild(span);
    });

    const cover = el('artCover');
    const coverImg = el('artCoverImg');
    if (info.coverUrl) {
        coverImg.src = info.coverUrl;
        coverImg.alt = info.title;
        coverImg.fetchPriority = 'high';
        coverImg.decoding = 'async';
        cover.hidden = false;
    } else {
        coverImg.removeAttribute('src');
        cover.hidden = true;
    }

    const footMeta = el('artFootMeta');
    clear(footMeta);
    const foot = el('artFoot');
    let hasFoot = false;
    if (info.license) { footMeta.appendChild(metaItem('许可', info.license)); hasFoot = true; }
    if (info.source) {
        footMeta.appendChild(linkItem('来源', info.source.name, info.source.url));
        hasFoot = true;
    }
    foot.hidden = !hasFoot;

    if (refs && refs.backHref) { el('artBack').href = refs.backHref; }
    if (refs && refs.backLabel) { el('artBack').textContent = refs.backLabel; }
    return info;
}
