#!/usr/bin/env node
/* 站点回归（本地、离线、<90s）：起静态服务器 + 无头浏览器跑关键场景。
   用法：node .github/scripts/check-site.js --dist dist [--port 0] [--browser <path>] */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const args = process.argv.slice(2);
function arg(name, def) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; }
const DIST = path.resolve(arg('--dist', 'dist'));
const PORT = Number(arg('--port', 0));
const BROWSER = arg('--browser', process.env.BROWSER || '');

/* Windows 版浏览器需要 Windows 风格路径（WSL 下 /mnt/d/... → D:\...） */
function toBrowserPath(p, browserPath) {
  const m = /^\/mnt\/([a-z])\/(.*)$/.exec(p);
  const isWin = /^\/mnt\/[a-z]\//i.test(browserPath || '');
  return (m && isWin) ? m[1].toUpperCase() + ':\\' + m[2].replace(/\//g, '\\') : p;
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.md': 'text/markdown; charset=utf-8', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.ico': 'image/x-icon', '.txt': '' };

function serve(cb) {
  const srv = http.createServer((req, res) => {
    const p = decodeURIComponent(req.url.split('?')[0]);
    let file = path.join(DIST, p === '/' ? 'index.html' : p);
    if (!file.startsWith(DIST)) { res.writeHead(403); res.end(); return; }
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
  });
  srv.listen(PORT, '127.0.0.1', () => cb(srv.address().port));
}

function findBrowser() {
  const cands = [BROWSER, '/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/mnt/c/Program Files/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/microsoft-edge'].filter(Boolean);
  for (const c of cands) { try { fs.accessSync(c, fs.constants.X_OK); return c; } catch (e) {} }
  return '';
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  const browser = findBrowser();
  if (!browser) { console.error('找不到浏览器，请用 --browser 指定'); process.exit(2); }
  const port = await new Promise((res) => serve(res));
  const base = 'http://127.0.0.1:' + port;
  const devPort = 9400 + (process.pid % 400);
  const profileDir = path.resolve(arg('--profile', '.checkprofile-' + process.pid));
  const profile = toBrowserPath(profileDir, browser);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  const edge = spawn(browser, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--disable-extensions', '--remote-debugging-port=' + devPort, '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore' });
  console.log('  浏览器: ' + browser + '\n  调试端口: ' + devPort + '\n  profile: ' + profile);
  let ws = null;
  const results = [];
  const t0 = Date.now();
  try {
    let targets;
    for (let i = 0; i < 60; i++) { try { const r = await fetch('http://127.0.0.1:' + devPort + '/json/list'); if (r.ok) { targets = await r.json(); break; } } catch (e) {} await sleep(300); }
    if (!targets) { throw new Error('浏览器启动超时（端口 ' + devPort + '）'); }
    try { fs.rmSync(path.resolve(arg('--profile', '.checkprofile')), { recursive: true, force: true }); } catch (e) {}
    ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
    let id = 0; const pending = new Map(); const errors = [];
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.method === 'Runtime.exceptionThrown') errors.push((m.params.exceptionDetails.text || '') + ' ' + ((m.params.exceptionDetails.exception || {}).description || '').slice(0, 120));
      if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
    });
    const send = (method, params) => new Promise((resolve, reject) => { const i = ++id; pending.set(i, { resolve, reject }); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
    await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable'); await send('ServiceWorker.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    const ev = async (expr) => { for (let k = 0; k < 8; k++) { try { const r = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression: expr }); if (r && r.result) return r.result.value; } catch (e) { await sleep(150); } } return null; };
    const go = async (p, wait) => { await send('Page.navigate', { url: base + p }); await sleep(wait); };
    const scenario = (name, ok, detail) => { results.push({ name, ok, detail }); console.log((ok ? '  PASS ' : '  FAIL ') + name + (detail ? '  (' + detail + ')' : '')); };

    // 1 首页
    await go('/index.html', 5000);
    scenario('首页 KaTeX', await ev('!!(window.katex && window.katex.render)'));
    scenario('首页 100 条公式', (await ev('document.querySelectorAll(".formula-item").length')) === 100);
    scenario('首页引用压缩产物', await ev('!!document.querySelector("script[src*=\\"loader.min.js\\"]")'));
    // 2 热加载 / SW
    await go('/index.html', 3500);
    scenario('SW 注册 deps-sw.min.js', await ev('navigator.serviceWorker.controller ? /deps-sw\\.min\\.js/.test(navigator.serviceWorker.controller.scriptURL) : false'));
    const cache = JSON.parse(await ev(`caches.open('zzkxs-cache-v4').then(async function(c){var u=(await c.keys()).map(function(k){return k.url;});return JSON.stringify({bundle:u.filter(function(x){return /bundle\\.min\\.js\\?v=/.test(x);}).length,html:u.filter(function(x){return /\\.html$/i.test(new URL(x).pathname);}).length});})`));
    scenario('SW 缓存带版本 bundle', cache.bundle >= 1);
    scenario('缓存无 HTML', cache.html === 0);
    // 3 文章页
    await go('/pages/article-ar/article.html?gate=off#2025-cupt', 6000);
    scenario('文章页渲染', (await ev('document.documentElement.getAttribute("data-article-rendered")')) === '1');
    // 4 懒加载 lightbox
    const clicked = await ev(`(function(){var img=document.querySelector('#artBody img.art-img');if(!img)return 'no-img';img.dispatchEvent(new MouseEvent('click',{bubbles:true}));return 'ok';})()`);
    await sleep(2500);
    scenario('Lightbox 懒加载 chunk', clicked === 'ok' && await ev('!!document.querySelector("[class*=lightbox], .lb-overlay")'));
    // 5 新闻列表
    await go('/pages/news/index.html', 5000);
    scenario('新闻列表卡片', (await ev('document.querySelectorAll(".post-card").length')) > 0);
    // 6 编辑器链路
    await go('/index.html', 5000);
    const btn = await ev(`(function(){var b=document.querySelector('.settings-open-editor');if(!b)return 'no-btn';b.click();return 'ok';})()`);
    await sleep(3500);
    scenario('编辑器懒加载', btn === 'ok' && await ev('!!document.querySelector("[class*=fe-], .formula-editor")'));
    scenario('无页面异常', errors.length === 0, errors.slice(0, 2).join(' | '));
    // 7 离线缓存
    await go('/index.html', 3000);
    await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
    scenario('离线命中 bundle', (await ev(`fetch('/assets/js/home/list.bundle.min.js').then(r=>r.status).catch(()=>'ERR')`)) === 200);
    await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  } catch (e) {
    console.error('  ✗ 运行失败: ' + e.message);
    results.push({ ok: false });
  } finally {
    try { if (ws) ws.close(); } catch (e) {}
    try { edge.kill(); } catch (e) {}
    await sleep(1200);
    try { fs.rmSync(profileDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 }); } catch (e) {}
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    const failed = results.filter(r => !r.ok).length;
    console.log('\n  结果: ' + (results.length - failed) + '/' + results.length + ' 通过，用时 ' + secs + ' s');
    setTimeout(() => process.exit(failed ? 1 : 0), 300);
  }
}
main();
