#!/usr/bin/env node
/**
 * CPU 采样探针：对疑似死循环的页面做 Profiler 采样，按自身耗时排出热点函数与文件行号。
 * 用法：node scripts/cpu-probe.mjs <url> [采样毫秒]
 * 前置：chrome --headless=new --remote-debugging-port=9223 about:blank
 */
const BASE = process.env.CDP || 'http://127.0.0.1:9223';
const TARGET_URL = process.argv[2] || 'http://127.0.0.1:8787/';
const SAMPLE_MS = Number(process.argv[3] || 4000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function newTarget() {
  for (let i = 0; i < 20; i += 1) {
    try {
      const res = await fetch(`${BASE}/json/new?${new URLSearchParams({ url: 'about:blank' })}`, { method: 'PUT' });
      if (res.ok) {
        const page = await res.json();
        if (page?.webSocketDebuggerUrl) return page;
      }
    } catch {
      /* 等端口 */
    }
    await sleep(400);
  }
  throw new Error('连不上 CDP，请先启动带 --remote-debugging-port 的 Chrome');
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.addEventListener('open', () => resolve(ws));
    ws.addEventListener('error', () => reject(new Error('WebSocket 连接失败')));
  });
}

function makeClient(ws) {
  let seq = 0;
  const pending = new Map();
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    }
  });
  return {
    send(method, params = {}) {
      const id = (seq += 1);
      ws.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        setTimeout(() => {
          if (pending.has(id)) {
            pending.delete(id);
            reject(new Error(`超时：${method}`));
          }
        }, 20000).unref?.();
      });
    },
  };
}

const run = async () => {
  const target = await newTarget();
  const ws = await connect(target.webSocketDebuggerUrl);
  const cdp = makeClient(ws);

  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
  await cdp.send('Page.enable');
  await cdp.send('Profiler.start');
  await cdp.send('Page.navigate', { url: TARGET_URL });
  await sleep(SAMPLE_MS);
  const { profile } = await cdp.send('Profiler.stop');

  const self = new Map();
  const nodeById = new Map((profile.nodes || []).map((n) => [n.id, n]));
  for (const sample of profile.samples || []) {
    const node = nodeById.get(sample.nodeId);
    if (!node) continue;
    const frame = node.callFrame;
    const key = `${frame.functionName || '(anonymous)'} @ ${(frame.url || '(native)').replace(/^https?:\/\/[^/]+/, '')}:${frame.lineNumber + 1}`;
    self.set(key, (self.get(key) || 0) + 1);
  }

  const total = (profile.samples || []).length;
  console.log(`采样 ${total} 次，URL：${TARGET_URL}`);
  console.log('\n--- 自身耗时 Top 12 ---');
  [...self.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .forEach(([key, count]) => {
      console.log(`  ${String(((count / total) * 100).toFixed(1)).padStart(5)}%  ${count}  ${key}`);
    });

  ws.close();
  await fetch(`${BASE}/json/close/${target.id}`).catch(() => undefined);
};

run().catch((err) => {
  console.error('采样失败：', err.message);
  process.exit(1);
});
