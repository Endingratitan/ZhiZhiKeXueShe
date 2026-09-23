/* ============================================================
   致知科学社 · 公式导入（formular-loader）
   ------------------------------------------------------------
   【职责】
   - 读取用户提供的 JSON（文件选择 / 拖拽 / 文本），校验并归一化为公式数组；
   - 提供「追加」与「替换」两种合并方式，追加时自动跳过重复条目。

   【可识别的输入结构（两种，兼顾兼容性）】
   1) 裸数组（与官方 assets/data/formulas.json 一致）：
        [{ "formula": "...", "name": "...", "proposer": "...",
           "theory": "...", "note_link": [{ "name": "...", "url": "..." }] }]
   2) 包装对象：{ "formulas": [...] } 或 { "data": [...] }

   【校验规则】
   - 条目必须是对象，且 formula / name 至少有一个非空，否则计入「忽略」；
   - 缺失字段自动补空字符串；note_link 兼容缺失或非数组；
   - note_link 中的链接只保留 http(s)，无协议的自动补 https://。

   【对外接口】window.ZZKXS.formular.loader
   - parse(text)            → { ok, data, count, skipped, error }
   - readFile(file)         → Promise<{ name, text }>
   - merge(base, incoming)  → { data, added, skippedDup }
   - entryKey(entry)        → 去重键（formula + name）

   【说明】
   - 文件选择框由调用方（编辑器）自行创建，本模块只接受 File 对象，
     避免「用户取消选择」时留下悬空的 Promise；
   - 本模块不写 localStorage、不改动页面结构。
   ============================================================ */
(function () {
    'use strict';

    /* ---------- 归一化单条（与编辑器内部结构保持一致） ---------- */
    function normalizeEntry(e) {
        var src = (e && typeof e === 'object') ? e : {};
        var links = Array.isArray(src.note_link) ? src.note_link : [];
        var outLinks = [];
        links.forEach(function (l) {
            if (!l || typeof l.url !== 'string') { return; }
            var url = l.url.trim();
            if (!url) { return; }
            if (!/^https?:\/\//i.test(url)) { url = 'https://' + url; }
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

    function entryKey(entry) {
        return String((entry && entry.formula) || '').trim() + '|' + String((entry && entry.name) || '').trim();
    }

    /* ---------- 解析文本 → 公式数组 ---------- */
    function parse(text) {
        var raw;
        try {
            raw = JSON.parse(String(text == null ? '' : text));
        } catch (err) {
            return { ok: false, error: 'JSON 解析失败：' + (err && err.message ? err.message : err) };
        }

        var list = null;
        if (Array.isArray(raw)) { list = raw; }
        else if (raw && Array.isArray(raw.formulas)) { list = raw.formulas; }
        else if (raw && Array.isArray(raw.data)) { list = raw.data; }

        if (!list) {
            return { ok: false, error: '未识别到公式数组：应为数组，或含 formulas / data 数组的对象。' };
        }

        var data = [];
        var skipped = 0;
        list.forEach(function (item) {
            if (!item || typeof item !== 'object' || Array.isArray(item)) { skipped++; return; }
            var entry = normalizeEntry(item);
            if (!entry.formula && !entry.name) { skipped++; return; }  // 完全空白的条目视为无效
            data.push(entry);
        });

        if (!data.length) {
            return { ok: false, error: '文件里没有可用公式（共 ' + list.length + ' 条，全部无效）。', skipped: skipped };
        }
        return { ok: true, data: data, count: data.length, skipped: skipped };
    }

    /* ---------- 合并：追加（按 formula+name 去重） ---------- */
    function merge(base, incoming) {
        var data = Array.isArray(base) ? base.slice() : [];
        var seen = {};
        data.forEach(function (e) { seen[entryKey(e)] = true; });

        var added = 0;
        var skippedDup = 0;
        (Array.isArray(incoming) ? incoming : []).forEach(function (e) {
            var k = entryKey(e);
            if (seen[k]) { skippedDup++; return; }
            seen[k] = true;
            data.push(e);
            added++;
        });
        return { data: data, added: added, skippedDup: skippedDup };
    }

    /* ---------- 读取用户选择的文件（UTF-8 文本） ---------- */
    function readFile(file) {
        return new Promise(function (resolve, reject) {
            if (!file) { reject(new Error('未选择文件')); return; }
            var reader = new FileReader();
            reader.onload = function () {
                resolve({ name: file.name || 'formulas.json', text: String(reader.result || '') });
            };
            reader.onerror = function () { reject(new Error('文件读取失败')); };
            reader.readAsText(file, 'utf-8');
        });
    }

    /* ---------- 注册到统一命名空间 ---------- */
    window.ZZKXS = window.ZZKXS || {};
    window.ZZKXS.formular = window.ZZKXS.formular || {};
    window.ZZKXS.formular.loader = {
        parse: parse,
        merge: merge,
        readFile: readFile,
        entryKey: entryKey
    };
})();
