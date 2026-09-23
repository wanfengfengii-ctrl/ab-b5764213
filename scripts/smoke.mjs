// 一次性静态 HTTP 冒烟：启动 vite preview 提供 dist/，校验首页、健康检查与
// 构建产物均可访问且内容合理。全部通过则退出码 0，否则非零。
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

// vite 的 bin 未列入 package exports，这里从包目录自行定位，避免依赖 npx 联网。
const require = createRequire(import.meta.url);
const vitePkgDir = path.dirname(require.resolve('vite/package.json'));
const viteBin = path.join(vitePkgDir, 'bin', 'vite.js');

const PORT = process.env.SMOKE_PORT || '4173';
const BASE = `http://127.0.0.1:${PORT}`;

const server = spawn(process.execPath, [viteBin, 'preview', '--host', '127.0.0.1', '--port', PORT], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', (d) => process.stdout.write(`[preview] ${d}`));
server.stderr.on('data', (d) => process.stderr.write(`[preview] ${d}`));

let failed = false;
const fail = (msg) => {
  console.error(`冒烟失败：${msg}`);
  failed = true;
};

const shutdown = async (code) => {
  server.kill('SIGTERM');
  await sleep(300);
  process.exit(code);
};

try {
  // 等待服务就绪
  let ready = false;
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`${BASE}/healthz`);
      if (r.ok) { ready = true; break; }
    } catch { /* 尚未就绪 */ }
    await sleep(250);
  }
  if (!ready) fail('preview 服务在 10s 内未就绪');

  if (ready) {
    // 首页
    const idxRes = await fetch(`${BASE}/`);
    if (idxRes.status !== 200) fail(`首页 HTTP 状态 ${idxRes.status}`);
    const html = await idxRes.text();
    if (!html.includes('<div id="root">')) fail('首页缺少 #root 挂载点');
    if (!html.includes('尾咬合')) fail('首页标题内容不符');

    // 健康检查
    const hz = await fetch(`${BASE}/healthz`);
    const hzText = (await hz.text()).trim();
    if (hz.status !== 200 || hzText !== 'ok') fail(`/healthz 异常：${hz.status} "${hzText}"`);

    // 构建出的 JS 资源真实可下载
    const m = html.match(/src="(\/assets\/[^"]+\.js)"/);
    if (!m) {
      fail('首页未引用构建后的 JS 资源');
    } else {
      const js = await fetch(`${BASE}${m[1]}`);
      const body = await js.text();
      if (js.status !== 200 || body.length < 1000) fail(`JS 资源异常：${js.status} 长度 ${body.length}`);
    }

    // 未知路径：静态服务器返回 404（nginx 行为）或 SPA 回退到首页 HTML
    // （vite preview 行为）均可接受；返回 5xx 才算故障。
    const missing = await fetch(`${BASE}/definitely-not-exist-${Date.now()}`);
    if (missing.status >= 500) fail(`不存在的路径触发服务器错误：${missing.status}`);
  }

  if (failed) {
    console.error('静态 HTTP 冒烟未通过。');
    await shutdown(1);
  } else {
    console.log('静态 HTTP 冒烟全部通过：首页 / /healthz / JS 资源 / 404 行为正常。');
    await shutdown(0);
  }
} catch (e) {
  fail(`异常：${e.stack || e}`);
  await shutdown(1);
}
