#!/usr/bin/env node
/**
 * 静态 HTTP 冒烟检查（零依赖）：
 *  1. 在 dist/ 上临时启动一个静态服务器（含 SPA 回退）；
 *  2. 请求 / 必须返回 200 且包含挂载点 <div id="root">；
 *  3. 请求 index.html 中引用的全部 JS/CSS 资源必须 200 且非空；
 *  4. 请求任意前端路由必须回退到 index.html；
 *  5. 全部通过则进程退出码 0，否则 1。
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const PORT = 4173;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

const server = createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let filePath = normalize(join(root, urlPath));
    if (!filePath.startsWith(root)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    if (!(await exists(filePath)) || (await stat(filePath)).isDirectory()) {
      // SPA 回退
      filePath = join(root, 'index.html');
    }
    const data = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream' });
    res.end(data);
  } catch (e) {
    res.writeHead(500).end(String(e));
  }
});

const failures = [];
async function check(path, test) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`);
  const body = await res.text();
  const ok = res.status === 200 && test(body);
  console.log(`${ok ? 'PASS' : 'FAIL'}  GET ${path}  (${res.status}, ${body.length} bytes)`);
  if (!ok) failures.push(path);
}

await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));

try {
  let indexHtml = '';
  await check('/', (b) => {
    indexHtml = b;
    return b.includes('<div id="root"></div>') && b.includes('/src/main.tsx') === false;
  });

  // 抽取构建产物引用（vite build 后为 /assets/....js / .css）
  const refs = [...indexHtml.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
  if (refs.length === 0) failures.push('(no hashed assets found in index.html)');
  for (const r of refs) {
    await check(r, (b) => b.trim().length > 0);
  }

  // SPA 路由回退
  await check('/some/client/route', (b) => b.includes('<div id="root"></div>'));

  // 健康检查端点仅存在于 nginx 配置，这里确认配置文件里有
  const nginxConf = await readFile(join(root, '..', 'nginx.conf'), 'utf8').catch(() => '');
  if (!nginxConf.includes('location = /healthz')) failures.push('(nginx /healthz missing)');
} finally {
  server.close();
}

if (failures.length) {
  console.error(`\nSMOKE FAILED: ${failures.join(', ')}`);
  process.exit(1);
}
console.log('\nSMOKE OK');
