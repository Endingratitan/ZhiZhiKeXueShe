# assets/vendor — 第三方库本地副本

本站的第三方库一律**自托管**（不进 CDN），由 `assets/deps/loader.js` 统一加载/预热。

| 库 | 版本 | 用途 | 许可证 |
|---|---|---|---|
| KaTeX | **0.19.0** | 数学公式排版 | MIT（见 `katex/LICENSE`） |
| highlight.js | **11.12.0** | 代码高亮（common 构建，含常用语言） | BSD-3-Clause（见 `hljs/LICENSE`） |

## 目录

```
assets/vendor/
├── katex/
│   ├── katex.min.js      (~267 KB)
│   ├── katex.min.css     (~24 KB，字体走相对路径 fonts/)
│   ├── fonts/            (60 个 woff2/woff/ttf，合计 ~1.03 MB)
│   └── LICENSE           (MIT)
└── hljs/
    ├── highlight.min.js  (~126 KB，common 语言集)
    ├── styles/
    │   ├── github.min.css
    │   └── github-dark.min.css
    └── LICENSE           (BSD-3-Clause)
```

## 来源与校验

- KaTeX：`https://registry.npmjs.org/katex/-/katex-0.19.0.tgz`（解包 `dist/` 与 `LICENSE`）
- highlight.js：`https://registry.npmjs.org/@highlightjs/cdn-assets/-/cdn-assets-11.12.0.tgz`（解包 `highlight.min.js`、`styles/github*.min.css`、`LICENSE`）
- 不做任何源码修改，升级时整包替换；文件版本号写在 `assets/deps/loader.js` 的 `DEPS` 常量里（升级需同步，`?v=` 查询串用于破缓存）。

## 缓存策略（重要）

1. **Service Worker（v4 单缓存）**
   - 源文件是仓库根 `deps-sw.js`；构建时由 `tools/build-sw.py` 用 Closure SIMPLE 压缩为 **`deps-sw.min.js`**（web 分支只发布它），`assets/deps/loader.js` 注册 `deps-sw.min.js?v=<vendor 版本@来源>`。
   - 只有一个 Cache Storage：**`zzkxs-cache-v4`**；**HTML 不拦截**（始终走网络，交给发布体系），其余非 HTML 全部缓存：
     - URL 带 `?v=`（版本化）→ 视为不可变：命中即返回，不再后台刷新；
     - 其它（图片/字体/JSON/MD、loader、deps.json）→ 缓存优先 + **30 分钟静默刷新**；
     - 超过 **12 个月**的条目在节流清理中删除。
   - install 只按 `deps.json` 的 `serviceWorker.precache` 预缓存（当前只有 **katex.js / katex.css**）；
     **hljs 不进预缓存**（省首装 ~126 KB），由 loader 在进入站点后空闲时补缓存：
     用 `caches.match()` 检查"缓存里是否已有"，缺了才下载；失败则退避 1 小时（`zzkxs.deps.hljs.retry`）。
   - 旧缓存（`zzkxs-vendor-*` / `zzkxs-assets-*` / `zzkxs-site-*`）**不会在 activate 时直接删除**：
     等新缓存里预缓存清单全部到位（verify 通过）才删；期间旧缓存只读，命中即“提升”进新缓存。
   - 依赖清单读取失败时 loader 用内置 `DEFAULT_MANIFEST` 兜底；SW 没有清单则不预缓存，页面按需加载不受影响。
2. **loader 侧标记**
   - `localStorage['zzkxs.deps.vendor.v2']`：`{schema, source, versions, at, exp}`（9 个月），用于决定是否重新预热/刷新；
   - `localStorage['zzkxs.deps.hljs.retry']`：hljs **失败退避**标记（1 小时；成功即清除）。
   - 加载 URL 一律带 `?v=<依赖版本>`；loader 自身的站点版本由构建统一写成 `loader.min.js?v=<build>`（见构建管线文档）。
3. **HTTP / Cloudflare（可选加固）**
   - 版本化 URL 本身已不可变；如需给"不使用 SW 的浏览器"兜底，可继续用 Cloudflare Transform Rule 给
     `/assets/vendor/` 设 `Cache-Control: public, max-age=23328000, immutable`。
   - 字体文件名没有版本串：靠 SW 的 30 分钟静默刷新 + 12 个月清理；升级 KaTeX 若字体有变，建议 purge `/assets/vendor/`。

## 清单与来源切换（assets/deps/deps.json）

vendor 的**版本、来源、预缓存清单**集中在 `assets/deps/deps.json`（loader 与 SW 都读它）：

```json
{
  "browserCacheSeconds": 23328000,
  "serviceWorker": { "enabled": true, "cacheSeconds": 23328000,
                     "precache": ["katex.js", "katex.css"] },
  "source": "local",
  "sources": {
    "local": { "base": "../vendor/", "swCache": true },
    "oss":   { "base": "https://bucket.hunnucupt.top/webAssets/vendor/",
               "swCache": true, "cors": true }
  },
  "deps": {
    "katex": { "version": "0.19.0", "js": "katex/katex.min.js", "css": ["katex/katex.min.css"] },
    "hljs":  { "version": "11.12.0", "js": "hljs/highlight.min.js",
               "css": ["hljs/styles/github.min.css", "hljs/styles/github-dark.min.css"] }
  }
}
```

- `serviceWorker.precache` 使用 `库.字段` 记号（`katex.js` → `deps.katex.js`，`katex.css` → `deps.katex.css[0]`）。
- `deps.hljs.css` 是 hljs 的明暗主题（与 `deps.katex.css` 同构），供 loader 预热/补缓存与 `art-code.js` 运行时使用。
- 文件校验（sha256/字节数）在 **`assets/vendor/CHECKSUMS.txt`**；许可证在 `katex/LICENSE`、`hljs/LICENSE`。
- 升级 vendor：改 `deps.json` 的版本号即可（`?v=` 破缓存；SW URL 里的版本串随之变化）；不需要手动改缓存名。

### 以后把 vendor 搬到 bucket（OSS）的步骤

1. 把 `assets/vendor/` **整树**上传到 bucket 前缀（保持相对结构，含 `katex/fonts/`）；用 `CHECKSUMS.txt` 核对。
2. 桶开 **CORS**（`Access-Control-Allow-Origin` 站点域名）——跨域缓存必需。
3. 把 `deps.json` 的 `source` 改成 `"oss"`。
4. **在 `deps-sw.js` 把 `CROSS.corsFetch` 置为 `true`**（跨域改用 CORS 拉取；opaque 响应默认不入缓存）。
5. 重新构建（`tools/build-sw.py`）生成 `deps-sw.min.js`；loader 的 base 自动跟随 `deps.json`，标记含 source 自动失效。
6. 验证：DevTools → Application → Service Workers / Cache Storage（应只有一个 `zzkxs-cache-v4`）。
