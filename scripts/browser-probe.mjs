#!/usr/bin/env node
/**
 * 无头浏览器探针：用 CDP 直连本机 Chrome，判断主线程是否卡死，
 * 卡死时暂停执行并打印 JS 调用栈（含文件与行号），同时收集控制台输出。
 *
 * 用法：node scripts/browser-probe.mjs <url> [等待毫秒]
 * 前置：另开一个 Chrome —— chrome --headless=new --remote-debugging-port=9223 about:blank
 */
const BASE = process.env.CDP || 'http://127.0.0.1:9223';
const TARGET_URL = process.argv[2] || 'http://127.0.0.1:8787/';
const WAIT = Number(process.argv[3] || 6000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function findPageTarget() {
  // 每次开新标签页，避免复用上一个被卡死/暂停的目标
  for (let i = 0; i < 20; i += 1) {
    try {
      const created = await fetch(`${BASE}/json/new?${new URLSearchParams({ url: 'about:blank' })}`, { method: 'PUT' });
      if (created.ok) {
        const page = await created.json();
        if (page?.webSocketDebuggerUrl) return page;
      }
    } catch {
      /* 等 Chrome 起端口 */
    }
    await sleep(400);
  }
  throw new Error(`连不上 CDP ${BASE}；请先启动 chrome --headless=new --remote-debugging-port=9223 about:blank`);
}

const logs = [];

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.addEventListener('open', () => resolve(ws));
    ws.addEventListener('error', (event) => reject(new Error(`WebSocket 失败：${event.message || event.type}`)));
  });
}

function makeClient(ws) {
  let seq = 0;
  const pending = new Map();
  const handlers = new Map();
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    } else if (msg.method && handlers.has(msg.method)) {
      handlers.get(msg.method)(msg.params);
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
        }, 8000).unref?.();
      });
    },
    on(method, fn) {
      handlers.set(method, fn);
    },
  };
}

const withTimeout = (promise, ms, label) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`阻塞：${label}`)), ms))]);

const run = async () => {
  const target = await findPageTarget();
  const ws = await connect(target.webSocketDebuggerUrl);
  const cdp = makeClient(ws);

  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable').catch(() => undefined);
  await cdp.send('Page.enable');
  await cdp.send('Debugger.enable');

  cdp.on('Runtime.consoleAPICalled', (params) => {
    logs.push(`[console.${params.type}] ${params.args.map((a) => a.value ?? a.description ?? a.type).join(' ')}`);
  });
  cdp.on('Runtime.exceptionThrown', (params) => {
    const d = params.exceptionDetails;
    logs.push(`[exception] ${d.exception?.description || d.text} @ ${d.url || ''}:${d.lineNumber || 0}`);
  });
  cdp.on('Log.entryAdded', (params) => {
    const e = params.entry;
    if (e.source === 'network' && /404|500/.test(String(e.text || ''))) logs.push(`[net] ${e.text} ${e.url || ''}`);
  });

  await cdp.send('Page.navigate', { url: TARGET_URL });
  await sleep(WAIT);

  let blocked = false;
  try {
    const probe = await withTimeout(
      cdp.send('Runtime.evaluate', { expression: '1 + 1', returnByValue: true }),
      4000,
      'Runtime.evaluate 未在 4s 内返回（主线程被占满）'
    );
    console.log(`主线程可用，evaluate=${probe.result.value}`);
  } catch (err) {
    blocked = true;
    console.log(err.message);
  }

  if (blocked) {
    console.log('\n--- 暂停并取调用栈 ---');
    await cdp.send('Debugger.pause');
    const stack = await Promise.race([
      new Promise((resolve) => {
        cdp.on('Debugger.paused', (params) => resolve(params.callFrames));
      }),
      sleep(5000).then(() => null),
    ]);
    if (stack) {
      for (const frame of stack.slice(0, 12)) {
        const file = (frame.url || '').replace(/^https?:\/\/[^/]+/, '');
        console.log(`  ${frame.functionName || '(anonymous)'}  ${file}:${frame.lineNumber + 1}`);
      }
    } else {
      console.log('  未收到 paused 事件');
    }
    await cdp.send('Debugger.resume').catch(() => undefined);
  } else {
    const report = await cdp.send('Runtime.evaluate', {
      expression: `JSON.stringify({
        title: document.title,
        faction: document.documentElement.dataset.terraFaction || '',
        cards: document.querySelectorAll('.post-card').length,
        placed: [...document.querySelectorAll('.waterfall-item')].filter(el => /translate3d\\((?!0, -99999)/.test(el.style.transform)).length,
        slips: document.querySelectorAll('.record-slip').length,
        indexLinks: document.querySelectorAll('.index-link').length,
        licRows: document.querySelectorAll('.lic-table tbody tr').length,
        collation: document.querySelectorAll('.collation-col').length,
        anno: document.querySelectorAll('.anno').length,
        bodyScroll: document.body.scrollHeight,
      })`,
      returnByValue: true,
    });
    console.log('\n--- 页面状态 ---');
    console.log(JSON.stringify(JSON.parse(report.result.value), null, 2));
  }

  if (logs.length) {
    console.log('\n--- 控制台与异常 ---');
    for (const line of logs.slice(0, 25)) console.log(' ', line);
  } else {
    console.log('\n（无控制台异常）');
  }

  ws.close();
  await fetch(`${BASE}/json/close/${target.id}`).catch(() => undefined);
  process.exit(0);
};

run().catch((err) => {
  console.error('探针失败：', err.message);
  process.exit(1);
});
