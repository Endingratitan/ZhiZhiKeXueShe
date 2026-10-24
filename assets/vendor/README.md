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

1. **真正 9 个月：Service Worker（已实现，前端可控）**
   - `deps-sw.js`（站点根）由 `assets/deps/loader.js` 注册；install 时预缓存 KaTeX js/css + hljs js，并把 `/assets/vendor/*` 的后续请求全部接管；
   - 缓存写在 **Cache Storage**，有效期由 SW 自己判断（`x-zzkxs-stored-at` 时间戳 + 9 个月），**不受 GitHub Pages / Cloudflare 的 Cache-Control 限制**；
   - 版本号进 SW URL（`/deps-sw.js?v=0.19.0-11.12.0`）：升级 vendor 自动换缓存、旧缓存清掉；
   - 代价：首次访问仍要下载一次（约 427 KB，不含字体）；`file://` 或不能注册 SW 的环境自动回退普通预热。
2. **loader 侧**：`localStorage['zzkxs.deps.vendor.v1']` 记录"已预热/9 个月"；到期或版本变化重新检查。加载 URL 带 `?v=<版本>`。
3. **HTTP 侧（可选加固，给不支持 SW 的浏览器/首次请求）**：GitHub Pages 不能自定义响应头，需要 Cloudflare 规则。当前实测 CF 会把本站静态资源的浏览器 TTL 改写成 **3 天**；要更长，加一条 Cloudflare **Transform Rule（Modify Response Header）**：

   - 条件：`http.request.uri.path` **starts with** `/assets/vendor/`
   - 动作：Set static header `Cache-Control` = `public, max-age=23328000, immutable`

   可选再加一条 Cache Rules：路径 `/assets/vendor/*` → Edge TTL 覆盖为 1 年（Browser TTL 保持 "Respect existing headers"）。
   升级 vendor 时：JS/CSS 的 `?v=` 变化即可自然换新；`fonts/` 无版本串，若字体有变需 purge `/assets/vendor/`。
3. 没有 CF 规则时，loader 仍然工作（按浏览器实际 TTL 缓存；每 9 个月才重新预热一次标记）。

## 清单与来源切换（assets/deps/deps.json）

vendor 的**版本、来源、缓存时长**集中在 `assets/deps/deps.json`（loader 与 SW 都读它），字段刻意精简：

```json
{
  "browserCacheSeconds": 23328000,          // 默认 9 个月
  "serviceWorker": { "enabled": true, "cacheSeconds": 23328000,
                     "precache": ["katex.js", "katex.css", "hljs.js"] },
  "source": "local",                         // 当前来源
  "sources": {
    "local": { "base": "../vendor/", "swCache": true },
    "oss":   { "base": "https://bucket.hunnucupt.top/webAssets/vendor/",
               "swCache": true, "cors": true }
  },
  "deps": {
    "katex": { "version": "0.19.0", "js": "katex/katex.min.js", "css": ["katex/katex.min.css"] },
    "hljs":  { "version": "11.12.0", "js": "hljs/highlight.min.js" }
  }
}
```

- 可选字段：`sources.<名>.browserCacheSeconds`、`deps.<库>.styles`（hljs 明暗主题，等 md 渲染器上线再加）。
- 文件校验（sha256/字节数）在 **`assets/vendor/CHECKSUMS.txt`**；许可证在 `katex/LICENSE`、`hljs/LICENSE`。
- 清单读取失败时 loader 用内置 `DEFAULT_MANIFEST` 兜底（SW 无配置则不预缓存，页面按需加载不受影响）。

### 以后把 vendor 搬到 bucket（OSS）的步骤

1. 把 `assets/vendor/` **整树**上传到 bucket 前缀（保持相对结构一致，含 `katex/fonts/`）；用 `CHECKSUMS.txt` 核对文件。
2. 桶开 **CORS**（`Access-Control-Allow-Origin` 站点域名）——SW 跨域缓存必需；没有 CORS 就把 `sources.oss.swCache` 设 `false`，靠桶/CF 响应头缓存。
3. 可选：桶元数据或 Cloudflare 规则设 `Cache-Control: public, max-age=23328000, immutable`（给不支持 SW 的浏览器兜底）。
4. 把 `deps.json` 的 `source` 改成 `"oss"`。
5. 无需改代码：loader 换 base；SW 版本号含来源自动换缓存；localStorage 标记含 source 自动失效。
6. 验证：DevTools → Application → Service Workers / Cache Storage。
