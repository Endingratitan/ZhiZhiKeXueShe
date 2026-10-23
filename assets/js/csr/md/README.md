# CSR-MD（DOM-free markdown 渲染器 · art-* 契约）

文章正文渲染核心：**两阶段 AST（parse → token 树 → HTML 字符串）**，不碰 DOM，可在 Node 单测，也便于以后 SSG 复用。
对齐 `tools/saw/md-csr` 的 **simple 模式 + raw-html=off** 内容语义；不做 strict 模式、不支持原生 HTML。

## 模块

| 文件 | 职责 |
|---|---|
| `renderer.js` | 门面：`renderMarkdown` / `renderInlineMarkdown` / `normalizeInput`；脚注预处理与收尾 |
| `blocks.js` | 块派发：ATX/setext 标题、hr、缩进代码、围栏代码、块数学、引用/callout、列表、表格、段落 |
| `inline.js` | 行内：转义、行内代码、`\(..\)`/`$..$`/`$$..$$` 数学、强调、删除线、`[[kbd]]`、脚注引用、链接/图片、`<http(s)>`、硬换行 |
| `lists.js` | 有序/无序/任务列表；嵌套不限；懒续行 |
| `quotes.js` | 引用块（懒续行）+ callouts（16 内置类型 + kebab 扩展） |
| `callouts.js` | callout 类型表与中文默认标签 |
| `footnotes.js` | 脚注：定义扫描/引用登记/编号分配/end 与 inline 两种显示 |
| `tables.js` | GFM 表格（对齐、转义竖线） |
| `code.js` | 围栏代码 + 缩进代码 + 块数学（`$$`/`\[`） |
| `html.js` | token → HTML（唯一输出层） |
| `scan.js` | 块起点/缩进/hr/setext 判定 |
| `utils.js` | 转义、URL 白名单、标题 id、语言映射、`resolveUrl`、脚注占位符 |

## 用法

```js
import { renderMarkdown } from './md/renderer.js';

const { html, toc, flags, errors, warnings } =
  renderMarkdown(mdText, { baseUrl: new URL('../../articles/<slug>/', location.href).href });
// flags: { math, code, tables, callout, footnotes, task }
```

- `toc`：`[{ level, id, text }]`
- `errors/warnings`：`[{ line, code, message }]`（只收集，不抛）
- 选项：`math`、`tables`、`headingIds`、`idPrefix`、`footnotes`、`footnoteDisplay('end'|'inline')`、`calloutTitle('default'|'none')`、`baseUrl`

## 输出契约（类名统一 `art-*`）

| 内容 | 输出 |
|---|---|
| 行内代码 | `<code class="art-code-inline">` |
| 数学 | `<span class="art-math" data-display="0\|1" data-delim="dollar\|latex">TeX</span>`（页面层用 KaTeX 增强） |
| 代码块 | `<pre class="art-code" data-lang="js"><code class="language-javascript">…</code></pre>`（UI/高亮交给代码渲染器） |
| 表格 | `<table class="art-table">` |
| hr | `<hr class="art-hr art-hr-star\|dash\|plus">`（`***`/`___`→star、`---`→dash、`+++`→plus） |
| 引用 | `<blockquote class="art-quote">` |
| callout | `<blockquote class="art-callout art-callout-<type>" data-callout="<type>">` + `<p class="art-callout-title">` |
| 任务 | `<li class="art-task"><input type="checkbox" disabled [checked]>` |
| 脚注 | `<sup class="art-fn-ref" id="art-fnref-N">` / `<div class="art-footnotes">` / `.art-fn-back` |
| 图片 | `<img class="art-img" … loading="lazy" decoding="async">`；单独成段且带 title → `<figure class="art-figure">` + `<figcaption>` |
| kbd | `<kbd class="art-kbd">` |

## 安全

- **原生 HTML 一律转义**（无 raw-html 开关）；行内 `<` 不会直出
- URL 白名单：`http/https/mailto` 与相对/根相对/锚点；拒绝 `javascript:`/`data:`/`vbscript:`（控制字符先剔除）
- 标题 id 唯一化；代码内容转义；外链 `rel="noopener noreferrer"`；控制字符 U+0000 剔除并告警

## 测试与性能

- Node ESM 夹具 **91 项**（标题/toc/转义/URL/列表/引用/callout/脚注/表格/代码/数学/baseUrl/选项/边界/图注）
- 基准（Node，30 次预热）：典型 20–50KB 文章 **约 1–3 ms**；纯解析不是瓶颈，网络 RTT 才是（后续用 Closure 打包成单文件）
- 改动这些文件后记得 bump 引用处 `?v=`（SWR 可后台更新，但 CF 对 JS 有 3 天浏览器缓存）
