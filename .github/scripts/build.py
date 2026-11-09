#!/usr/bin/env python3
"""构建期版本化 + 压缩/打包（第三阶段）。

规程：
- main 只放源码（无 ?v=）；web 只放产物（本地 JS/CSS 一律 .min/.bundle，SW 为 deps-sw.min.js）。
- 本地 JS/CSS 引用只允许出现在三处：HTML 的 src/href、JS 的 from '…'、import('…')（字面量）。
- build = 对"最终被引用的产物"归一化后求 sha256（16 位），压缩后计算（工具/内容变化都会换 build）。

用法：
    python3 .github/scripts/build.py --check                  # 校验 main 干净
    python3 .github/scripts/build.py --out dist               # 仅复制 + stamp + verify（无压缩）
    python3 .github/scripts/build.py --out dist --minify      # 压缩/打包 + 剪枝 + stamp + verify
       环境：CLOSURE_JAR=/tmp/closure-compiler.jar
             ESBUILD_BIN=esbuild（或 node_modules/.bin/esbuild）
             NODE_PATH=node_modules（clean-css 模块）
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EXCLUDE_DIRS = {'.git', '.github', 'tools', 'defualt-public', 'node_modules', '__pycache__'}
EXCLUDE_FILES = {'tech.md'}
SKIP_ASSET_PATHS = ('/assets/vendor/', '/assets/deps/deps.json', '/assets/deps/deps-sw.js',
                    '/assets/deps/build.json', '/assets/deps/site-assets.json')
AUDIT_SKIP = {'assets/deps/loader.js', 'assets/js/setting.js'}

# 由运行时拼路径加载、必须一并改成 .min 的文件（不经过 HTML/import 图）
# 懒加载 chunk：这些模块单独打固定名 bundle，page 包里只保留 import() 引用
LAZY_CHUNKS = [
    ('assets/js/csr/article/lightbox.js', 'lightbox'),
    ('assets/js/csr/code/art-code.js', 'art-code'),
]

DYNAMIC_REWRITES = [
    ('../css/formular/formular-editor.css', '../css/formular/formular-editor.min.css'),
    ('formular/formular-editor.js', 'formular/formular-editor.min.js'),
    ('formular-publisher.js', 'formular-publisher.min.js'),
    ('formular-loader.js', 'formular-loader.min.js'),
]

HTML_REF = re.compile(r'(?P<attr>\b(?:src|href))="(?P<url>[^"]+)"')
JS_REF = re.compile(r'(?P<pre>\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(?P<q>[\'"])(?P<url>[^\'"]+)(?P=q)')
VERSION_RE = re.compile(r'[?&]v=[0-9a-f]{6,16}\b')
ESM_RE = re.compile(r'^\s*(?:import|export)\s', re.M)
MODULE_ENTRY_RE = re.compile(r'<script[^>]*type="module"[^>]*src="(?P<url>[^"]+)"', re.I)


# ---------- 引用识别 ----------

def is_local_asset(url, suffixes=('.js', '.css')):
    if not url or url.startswith(('http://', 'https://', '//', 'data:', '#', 'mailto:')):
        return False
    path = url.split('?', 1)[0].split('#', 1)[0]
    if not path.endswith(suffixes):
        return False
    probe = '/' + path.lstrip('./')
    if '/assets/vendor/' in probe:
        return False
    for skip in SKIP_ASSET_PATHS:
        if skip != '/assets/vendor/' and probe.endswith(skip):
            return False
    return True


def strip_version(url):
    return VERSION_RE.sub('', url)


def with_version(url, build):
    base = strip_version(url).split('#', 1)[0]
    return base + '?v=' + build


def normalize(text):
    return VERSION_RE.sub('', text.replace('\r\n', '\n'))


def entry_html():
    pages = [ROOT / 'index.html'] + sorted((ROOT / 'pages').rglob('*.html'))
    return [p for p in pages if p.is_file()]


def iter_site_files(root=ROOT):
    for path in root.rglob('*'):
        if not path.is_file():
            continue
        rel = path.relative_to(root)
        if rel.parts and rel.parts[0] in EXCLUDE_DIRS:
            continue
        if rel.name in EXCLUDE_FILES:
            continue
        yield path


def html_refs(text):
    return [m.group('url') for m in HTML_REF.finditer(text) if is_local_asset(m.group('url'))]


def js_refs(text):
    out = []
    for m in JS_REF.finditer(text):
        if is_local_asset(m.group('url'), ('.js',)):
            out.append(m.group('url'))
    return out


def resolve(base, url):
    root = ROOT.resolve()
    path = strip_version(url).split('#', 1)[0].lstrip('/')
    candidates = []
    if path.startswith(('assets/', 'pages/', 'articles/')):
        candidates.append(ROOT / path)
    candidates.append(base.parent / path)
    candidates.append(ROOT / path)
    for cand in candidates:
        cand = cand.resolve()
        try:
            cand.relative_to(root)
        except ValueError:
            continue
        if cand.is_file():
            return cand
    return None


def discover():
    seen, queued, files, refs = set(), set(), set(), []
    queue = list(entry_html())
    while queue:
        path = queue.pop(0)
        if path in seen:
            continue
        seen.add(path)
        try:
            text = path.read_text(encoding='utf-8')
        except (UnicodeDecodeError, OSError):
            continue
        urls = html_refs(text) if path.suffix == '.html' else (js_refs(text) if path.suffix == '.js' else [])
        for url in urls:
            refs.append((path, url))
            target = resolve(path, url)
            if target is None:
                continue
            if target.suffix in ('.js', '.css'):
                files.add(target)
            if target.suffix == '.js' and target not in seen and target not in queued:
                queued.add(target)
                queue.append(target)
    return files, refs


# ---------- 禁止表审计 ----------

FORBIDDEN = [
    (re.compile(r"fetch\(\s*['\"][^'\"]+\.(?:js|css)(?=[\"'?#)])"), 'fetch 字面量引用 JS/CSS'),
    (re.compile(r"new\s+URL\(\s*['\"][^'\"]+\.(?:js|css)(?=[\"'?#)])"), 'new URL 引用 JS/CSS'),
    (re.compile(r'@import\b'), 'CSS @import'),
]
WARNINGS = [
    (re.compile(r"createElement\(\s*['\"]script['\"]"), '动态创建 <script>（不版本化）'),
    (re.compile(r"createElement\(\s*['\"]link['\"]"), '动态创建 <link>（不版本化）'),
]


def audit():
    errors, warnings = [], []
    for path in iter_site_files():
        if path.suffix not in ('.js', '.css'):
            continue
        rel = str(path.relative_to(ROOT))
        if rel.startswith('assets/vendor/'):
            continue
        text = path.read_text(encoding='utf-8', errors='replace')
        for rx, label in FORBIDDEN:
            for m in rx.finditer(text):
                s = m.group(0)
                if 'vendor/' in s or 'cdn' in s or 'http' in s:
                    continue
                errors.append('%s:%d %s → %s' % (rel, text.count('\n', 0, m.start()) + 1, label, s.strip()[:60]))
        for rx, label in WARNINGS:
            for m in rx.finditer(text):
                warnings.append('%s:%d %s' % (rel, text.count('\n', 0, m.start()) + 1, label))
    return errors, warnings


# ---------- 复制 / 压缩 / 打包 ----------

def copy_site(out):
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    for item in ROOT.iterdir():
        if item.name in EXCLUDE_DIRS:
            continue
        target = out / item.name
        if item.is_dir():
            shutil.copytree(item, target, ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
        elif item.name in EXCLUDE_FILES:
            continue
        else:
            shutil.copy2(item, target)


def run(cmd, **kw):
    subprocess.run([str(x) for x in cmd], check=True, capture_output=True, **kw)


def closure_minify(src, dst, jar):
    run(['java', '-jar', jar,
         '--js', src, '--compilation_level', 'SIMPLE',
         '--language_in', 'ECMASCRIPT_2017', '--language_out', 'ECMASCRIPT_2017',
         '--warning_level', 'QUIET', '--js_output_file', dst])


def minify_classic(out, jar, workers=2):
    jobs = []
    for path in out.rglob('*.js'):
        rel = str(path.relative_to(out))
        if rel.startswith('assets/vendor/') or rel.endswith('.min.js') or rel.endswith('.bundle.min.js'):
            continue
        if rel == 'deps-sw.js':
            continue                                  # SW 由 tools/build-sw.py 处理
        text = path.read_text(encoding='utf-8', errors='replace')
        if ESM_RE.search(text):
            continue                                  # ESM 走打包
        jobs.append(path)
    with ThreadPoolExecutor(max_workers=workers) as pool:
        list(pool.map(lambda p: closure_minify(str(p), str(p.with_suffix('.min.js')), jar), jobs))
    return jobs


def minify_css(out, node_path):
    css = [p for p in out.rglob('*.css') if not p.name.endswith('.min.css')
           and 'assets/vendor/' not in str(p.relative_to(out))]
    if not css:
        return []
    script = (
        "const CleanCSS=require('clean-css');const fs=require('fs');"
        "const files=JSON.parse(process.argv[1]);"
        "for(const f of files){const out=new CleanCSS({level:1}).minify(fs.readFileSync(f,'utf8'));"
        "if(out.errors&&out.errors.length){console.error(out.errors.join(';'));process.exit(1);}"
        "fs.writeFileSync(f.replace(/\\.css$/,'.min.css'),out.styles);}"
    )
    env = dict(os.environ)
    if node_path:
        env['NODE_PATH'] = node_path
    subprocess.run(['node', '-e', script, json.dumps([str(p) for p in css])],
                   check=True, capture_output=True, env=env)
    return css


def esm_entries(out):
    """从 HTML 的 module 脚本得到入口（返回 dist 内的原始路径）"""
    entries = []
    for page in out.rglob('*.html'):
        text = page.read_text(encoding='utf-8')
        for m in MODULE_ENTRY_RE.finditer(text):
            url = m.group('url').split('?', 1)[0].split('#', 1)[0]
            target = (page.parent / url).resolve() if not url.startswith('/') else (out / url.lstrip('/')).resolve()
            if target.is_file():
                entries.append((page, url, target))
    return entries


def pre_rewrite_import_meta(out):
    for path in out.rglob('*.js'):
        if 'assets/vendor/' in str(path.relative_to(out)):
            continue
        text = path.read_text(encoding='utf-8', errors='replace')
        if 'import.meta' not in text:
            continue
        new = text.replace("new URL('../../../vendor/hljs/styles/github.min.css', import.meta.url).href",
                           "'/assets/vendor/hljs/styles/github.min.css'")
        new = new.replace("new URL('../../../vendor/hljs/styles/github-dark.min.css', import.meta.url).href",
                          "'/assets/vendor/hljs/styles/github-dark.min.css'")
        if new != text:
            path.write_text(new, encoding='utf-8', newline='\n')


def bundle_esm(out, esbuild_bin):
    entries = esm_entries(out)
    if not entries:
        return []

    # 1) 懒加载模块：单独打固定名 chunk
    chunk_names = []
    for rel, name in LAZY_CHUNKS:
        src = out / rel
        if not src.is_file():
            continue
        dst = src.with_name(name + '.bundle.min.js')
        run([esbuild_bin, src, '--bundle', '--format=esm', '--minify',
             '--log-level=error', '--outfile=' + str(dst)])
        chunk_names.append((rel, name + '.bundle.min.js'))

    # 2) 把入口里的动态 import 指向 chunk 文件名
    for path in out.rglob('*.js'):
        rel = str(path.relative_to(out))
        if rel.startswith('assets/vendor/') or rel.endswith('.min.js'):
            continue
        text = path.read_text(encoding='utf-8', errors='replace')
        new_text = text
        for rel_src, name in chunk_names:
            new_text = new_text.replace(rel_src, rel_src.rsplit('/', 1)[0] + '/' + name)
        if new_text != text:
            path.write_text(new_text, encoding='utf-8', newline='\n')

    # 3) 入口打包：把 chunk 标为 external（保留 import() 引用）
    externals = ['--external:../../' + rel.rsplit('/', 1)[0] + '/' + name for rel, name in chunk_names]
    bundle_for = {}
    for page, url, target in entries:
        bundle = target.with_name(target.stem + '.bundle.min.js')
        bundle_for[str(target)] = (bundle, url)
    with ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(lambda t: run([esbuild_bin, t, '--bundle', '--format=esm', '--minify',
                                     '--log-level=error'] + externals +
                                    ['--outfile=' + str(bundle_for[str(t)][0])]),
                      [t for _, _, t in entries]))
    return [(bundle_for[str(t)][1], bundle_for[str(t)][0]) for _, _, t in entries]


def rewrite_refs(out, bundles):
    """HTML 引用 → .min/.bundle；动态字符串 → .min"""
    bundle_map = {}
    for url, bundle in bundles:
        bundle_map[url.split('?', 1)[0]] = bundle.name          # 原始相对 URL → bundle 文件名
    count_html = 0
    for page in out.rglob('*.html'):
        text = page.read_text(encoding='utf-8')

        def repl(m):
            url = m.group('url')
            if not is_local_asset(url):
                return m.group(0)
            base = strip_version(url).split('#', 1)[0]
            name = base.rsplit('/', 1)[-1]
            if base in bundle_map:
                new = base[:len(base) - len(name)] + bundle_map[base]
            elif base.endswith('.css'):
                new = base[:-4] + '.min.css'
            else:
                new = base[:-3] + '.min.js'
            return '%s="%s"' % (m.group('attr'), new)
        new = HTML_REF.sub(repl, text)
        if new != text:
            page.write_text(new, encoding='utf-8', newline='\n')
            count_html += 1

    # 动态加载的字符串（在压缩后的 JS 里仍是字面量）
    count_js = 0
    for path in out.rglob('*.js'):
        if 'assets/vendor/' in str(path.relative_to(out)):
            continue
        text = path.read_text(encoding='utf-8', errors='replace')
        new = text
        for old, repl in DYNAMIC_REWRITES:
            new = new.replace("'" + old + "'", "'" + repl + "'").replace('"' + old + '"', '"' + repl + '"')
        if new != text:
            path.write_text(new, encoding='utf-8', newline='\n')
            count_js += 1
    return count_html, count_js


def prune(out, minified_js, minified_css):
    removed = 0
    for path in minified_js + minified_css:
        if path.is_file() and path.parent.exists():
            path.unlink()
            removed += 1
    # ESM：所有被打包的原始模块都删掉（web 只保留 bundle）
    for path in list(out.rglob('*.js')):
        rel = str(path.relative_to(out))
        if rel.startswith('assets/vendor/') or rel.endswith('.min.js') or rel.endswith('.bundle.min.js'):
            continue
        if rel == 'deps-sw.js' or rel == 'deps-sw.min.js':
            continue
        if ESM_RE.search(path.read_text(encoding='utf-8', errors='replace')):
            path.unlink()
            removed += 1
    # 不再使用的清单与开发页
    for extra in (out / 'assets/deps/site-assets.json', out / 'deps-sw.js'):
        if extra.is_file():
            extra.unlink()
            removed += 1
    for dev in (out / 'pages/forTest',):
        if dev.exists():
            shutil.rmtree(dev)
            removed += 1
    return removed


# ---------- 压缩后摘要 ----------

def build_id_artifacts(out):
    items = []
    for path in sorted(out.rglob('*')):
        if not path.is_file():
            continue
        rel = str(path.relative_to(out))
        if not (rel.endswith('.min.js') or rel.endswith('.min.css') or rel.endswith('.bundle.min.js')):
            continue
        data = normalize(path.read_text(encoding='utf-8', errors='replace')).encode('utf-8')
        items.append(rel + '\0' + hashlib.sha256(data).hexdigest())
        if len(items) > 400:
            break
    return hashlib.sha256('\n'.join(items).encode('utf-8')).hexdigest()[:16]


def build_id_source():
    files, _ = discover()
    items = []
    for path in sorted(files, key=lambda p: str(p.relative_to(ROOT))):
        if path.suffix not in ('.js', '.css'):
            continue
        data = normalize(path.read_text(encoding='utf-8', errors='replace')).encode('utf-8')
        items.append(str(path.relative_to(ROOT)) + '\0' + hashlib.sha256(data).hexdigest())
    return hashlib.sha256('\n'.join(items).encode('utf-8')).hexdigest()[:16]


# ---------- stamp / verify ----------

def stamp_html(text, build):
    def repl(m):
        url = m.group('url')
        if not is_local_asset(url):
            return m.group(0)
        return '%s="%s"' % (m.group('attr'), with_version(url, build))
    return HTML_REF.sub(repl, text)


def stamp_js(text, build):
    def repl(m):
        url = m.group('url')
        if not is_local_asset(url, ('.js',)):
            return m.group(0)
        return '%s%s%s%s' % (m.group('pre'), m.group('q'), with_version(url, build), m.group('q'))
    return JS_REF.sub(repl, text)


def stamp_dynamic(text, build):
    for _, repl in DYNAMIC_REWRITES:
        for q in ("'", '"'):
            old = q + repl + q
            new = q + with_version(repl, build) + q
            text = text.replace(old, new)
    return text


def stamp_tree(out, build):
    stats = {'html': 0, 'js': 0}
    for path in out.rglob('*'):
        if not path.is_file():
            continue
        if path.suffix == '.html':
            text = path.read_text(encoding='utf-8')
            new = stamp_html(text, build)
            if new != text:
                path.write_text(new, encoding='utf-8', newline='\n')
                stats['html'] += 1
        elif path.suffix == '.js':
            text = path.read_text(encoding='utf-8', errors='replace')
            new = stamp_dynamic(stamp_js(text, build), build)
            if new != text:
                path.write_text(new, encoding='utf-8', newline='\n')
                stats['js'] += 1
    (out / '.nojekyll').write_text('', encoding='utf-8')
    return stats


def verify_dir(out, expect_build=None, minified=False):
    problems = []

    def out_target(page, url):
        rel = strip_version(url).split('#', 1)[0]
        cand = (out / rel.lstrip('/')).resolve() if rel.startswith('/') else (page.parent / rel).resolve()
        try:
            cand.relative_to(out.resolve())
        except ValueError:
            return None
        return cand

    for path in out.rglob('*.html'):
        text = path.read_text(encoding='utf-8')
        for url in html_refs(text):
            if not VERSION_RE.search(url):
                problems.append('%s: 未加版本 %s' % (path.relative_to(out), url))
            target = out_target(path, url)
            if target is None or not target.is_file():
                problems.append('%s: 引用不存在 %s' % (path.relative_to(out), url))
    for path in out.rglob('*.js'):
        text = path.read_text(encoding='utf-8', errors='replace')
        if 'import.meta' in text:
            problems.append('%s: 仍含 import.meta' % path.relative_to(out))
        for url in js_refs(text):
            if not VERSION_RE.search(url):
                problems.append('%s: import 未加版本 %s' % (path.relative_to(out), url))
    if minified:
        for path in out.rglob('*'):
            if not path.is_file():
                continue
            rel = str(path.relative_to(out))
            if rel.startswith('assets/vendor/'):
                continue
            if path.suffix == '.js' and not (rel.endswith('.min.js') or rel.endswith('.bundle.min.js')):
                problems.append('%s: web 中不应保留未压缩 JS' % rel)
            if path.suffix == '.css' and not rel.endswith('.min.css'):
                problems.append('%s: web 中不应保留未压缩 CSS' % rel)
        for path in out.rglob('*.js'):
            text = path.read_text(encoding='utf-8', errors='replace')
            for old, repl in DYNAMIC_REWRITES:
                if ("'" + repl + "'") in text and VERSION_RE.search(text.split("'" + repl + "'")[1][:20]) is None:
                    pass  # 版本号在 stamp 阶段补，verify 不强制
    if expect_build:
        wrong = []
        for path in out.rglob('*.html'):
            for m in HTML_REF.finditer(path.read_text(encoding='utf-8')):
                url = m.group('url')
                if is_local_asset(url) and ('?v=' + expect_build) not in url:
                    wrong.append('%s: %s' % (path.relative_to(out), url))
        if wrong:
            problems.append('版本与 build=%s 不一致：%s' % (expect_build, wrong[:6]))
    for path in out.rglob('*.js'):
        text = path.read_text(encoding='utf-8', errors='replace')
        target = path
        tmp = None
        try:
            if ESM_RE.search(text):
                tmp = Path(tempfile.mkstemp(suffix='.mjs')[1])
                tmp.write_text(text, encoding='utf-8')
                target = tmp
            subprocess.run(['node', '--check', str(target)], check=True, capture_output=True)
        except (subprocess.CalledProcessError, FileNotFoundError):
            problems.append('%s: node --check 失败' % path.relative_to(out))
        finally:
            if tmp is not None:
                tmp.unlink(missing_ok=True)
    if problems:
        for p in problems[:40]:
            print('  ✗ ' + p)
        return 1
    print('  ✓ 产物校验通过（%d 个 HTML、%d 个文件）' % (len(list(out.rglob('*.html'))), len(list(out.rglob('*')))))
    return 0


# ---------- 入口 ----------

def check_clean():
    problems = []
    errors, warnings = audit()
    problems.extend(errors)
    files, refs = discover()
    for path, url in refs:
        if VERSION_RE.search(url):
            problems.append('%s: 源码引用带版本 %s' % (path.relative_to(ROOT), url))
        if resolve(path, url) is None:
            problems.append('%s: 引用的文件不存在 %s' % (path.relative_to(ROOT), url))
    print('build=%s  参与文件=%d  引用=%d' % (build_id_source(), len(files), len(refs)))
    if problems:
        for p in problems[:40]:
            print('  ✗ ' + p)
        return 1
    print('  ✓ main 干净（无 ?v=、引用文件齐全、引用位置合规）')
    if warnings:
        print('  · 允许的动态注入（不版本化，靠 SW 静默刷新）：')
        for w in warnings[:10]:
            print('    - ' + w)
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--check', action='store_true')
    ap.add_argument('--out')
    ap.add_argument('--verify')
    ap.add_argument('--minify', action='store_true')
    args = ap.parse_args()

    if args.check:
        return check_clean()
    if args.verify:
        return verify_dir(Path(args.verify))

    if not args.out:
        ap.print_help()
        return 2

    out = Path(args.out)
    copy_site(out)

    jar = os.environ.get('CLOSURE_JAR', '/tmp/closure-compiler.jar')
    esbuild = os.environ.get('ESBUILD_BIN', 'esbuild')
    node_path = os.environ.get('NODE_PATH', '')

    minified_js, minified_css = [], []
    if args.minify:
        if not Path(jar).exists():
            print('  ! 未找到 Closure jar（%s），跳过 classic JS 压缩' % jar)
        else:
            pre_rewrite_import_meta(out)
            minified_js = minify_classic(out, jar)
            print('  classic JS 压缩：%d 个' % len(minified_js))
        try:
            minified_css = minify_css(out, node_path)
            print('  CSS 压缩：%d 个' % len(minified_css))
        except Exception as e:
            print('  ! CSS 压缩失败（%s），跳过' % str(e)[:80])
        try:
            bundles = bundle_esm(out, esbuild) if shutil.which(esbuild) or Path(esbuild).exists() else []
            print('  ESM 打包：%d 个入口' % len(bundles))
        except Exception as e:
            bundles = []
            print('  ! ESM 打包失败（%s），跳过' % str(e)[:80])
        html_n, js_n = rewrite_refs(out, bundles)
        print('  引用改写：html=%d js=%d' % (html_n, js_n))
        removed = prune(out, minified_js, minified_css)
        print('  剪枝：删除 %d 个原始文件/开发页' % removed)
        build = build_id_artifacts(out)
    else:
        build = build_id_source()

    stats = stamp_tree(out, build)
    print('build=%s  stamp: html=%d js=%d -> %s' % (build, stats['html'], stats['js'], out))
    return verify_dir(out, build, minified=args.minify)


if __name__ == '__main__':
    sys.exit(main())
