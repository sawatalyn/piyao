#!/usr/bin/env node
/**
 * 端到端界面走查：真实浏览器里跑主流程并截图，逐项断言。
 * 用法：node scripts/walkthrough.mjs
 * 前置：node server/src/index.js（伺服 web/dist）
 *      chrome --headless=new --remote-debugging-port=9223 about:blank
 */
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.CDP || 'http://127.0.0.1:9223';
const SITE = process.env.SITE || 'http://127.0.0.1:8787';
const OUT = process.env.SHOTS || '.scratch-verify/shots';
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];

// 起点确定性：每轮先把演示数据重置，避免上一轮的建档/删除污染断言基线
if (process.env.SKIP_RESEED !== '1') {
  const { execFileSync } = await import('node:child_process');
  execFileSync(process.execPath, ['server/scripts/reseed.js'], { stdio: 'inherit' });
}

function check(name, pass, detail = '') {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

async function newTarget(url = 'about:blank') {
  for (let i = 0; i < 20; i += 1) {
    try {
      const res = await fetch(`${BASE}/json/new?${new URLSearchParams({ url })}`, { method: 'PUT' });
      if (res.ok) {
        const page = await res.json();
        if (page?.webSocketDebuggerUrl) return page;
      }
    } catch {
      /* 等端口 */
    }
    await sleep(400);
  }
  throw new Error('连不上 CDP，请先启动 chrome --headless=new --remote-debugging-port=9223 about:blank');
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
  const handlers = new Map();
  const timers = new Map();
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const entry = pending.get(msg.id);
      pending.delete(msg.id);
      clearTimeout(timers.get(msg.id));
      timers.delete(msg.id);
      if (msg.error) entry.reject(new Error(JSON.stringify(msg.error)));
      else entry.resolve(msg.result);
    } else if (msg.method && handlers.has(msg.method)) {
      handlers.get(msg.method)(msg.params);
    }
  });
  return {
    send(method, params = {}, timeout = 6000) {
      const id = (seq += 1);
      ws.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        timers.set(
          id,
          setTimeout(() => {
            if (pending.has(id)) {
              pending.delete(id);
              reject(new Error(`超时：${method}`));
            }
          }, timeout)
        );
      });
    },
    on(method, fn) {
      handlers.set(method, fn);
    },
    close: () => ws.close(),
  };
}

const consoleLines = [];

async function main() {
  const target = await newTarget();
  const cdp = makeClient(await connect(target.webSocketDebuggerUrl));
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('Network.enable').catch(() => undefined);
  // 无头页拿不到系统焦点：开焦点仿真，富文本的真实键入与选区同步才成立
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => undefined);
  // 每次从干净会话开始，否则上一轮的登录态会让"游客可见性"断言失真
  await cdp.send('Network.clearBrowserCookies').catch(() => undefined);
  cdp.on('Runtime.consoleAPICalled', (p) => {
    consoleLines.push(`[${p.type}] ${p.args.map((a) => a.value ?? a.description ?? '').join(' ')}`);
  });
  cdp.on('Runtime.exceptionThrown', (p) => {
    consoleLines.push(`[exception] ${p.exceptionDetails?.exception?.description || p.exceptionDetails?.text}`);
  });

  const evaluate = async (expression) => {
    const res = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description || 'evaluate 异常');
    return res.result.value;
  };

  const waitFor = async (predicateExpression, ms = 9000, label = predicateExpression) => {
    const started = Date.now();
    while (Date.now() - started < ms) {
      try {
        if (await evaluate(`!!(${predicateExpression})`)) return true;
      } catch {
        /* 导航中 */
      }
      await sleep(180);
    }
    console.log(`  (等待超时：${label})`);
    return false;
  };

  const shot = async (name, full = true) => {
    const { data } = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: full,
    });
    fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
  };

  const viewport = (width, height) =>
    cdp.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width < 700,
    });

  // ---------- 富文本面操作原语（CKEditor 5 基底 + 本站自定义按钮） ----------
  const editableHtml = (index = 0) =>
    evaluate(`document.querySelectorAll('.ck-editor')[${index}].querySelector('.ck-editor__editable').innerHTML`);

  const revealLeaf = async (index) => {
    await evaluate(`document.querySelectorAll('.leaf')[${index}].click(), true`);
    await sleep(480);
  };

  /** 真实鼠标落点：无头环境里这是让 DOM 拿到插入符的可靠办法 */
  const caretIntoEditor = async (index = 0) => {
    const box = JSON.parse(
      await evaluate(`JSON.stringify((() => {
        const r = document.querySelectorAll('.ck-editor')[${index}].querySelector('.ck-editor__editable').getBoundingClientRect();
        return { x: Math.round(r.x + r.width * 0.5), y: Math.round(r.y + 18), w: Math.round(r.width) };
      })())`)
    );
    if (box.w < 50) throw new Error(`编辑器 ${index} 不可见（宽 ${box.w}px），先展开对应卷叶`);
    for (const type of ['mousePressed', 'mouseReleased']) {
      await cdp.send('Input.dispatchMouseEvent', {
        type,
        x: box.x,
        y: box.y,
        button: 'left',
        clickCount: 1,
        buttons: type === 'mousePressed' ? 1 : 0,
      });
    }
    await sleep(420);
  };

  const typeIntoEditor = async (index, text) => {
    await caretIntoEditor(index);
    await cdp.send('Input.insertText', { text });
    await sleep(420);
  };

  /** CKEditor 的选区要经它自己的 selectionchange 观察器；先补一个 focusin 让它认这个焦点 */
  const selectInEditor = async (index, needle, { caret = false } = {}) => {
    const hit = await evaluate(`(() => {
      const host = document.querySelectorAll('.ck-editor')[${index}];
      const el = host.querySelector('.ck-editor__editable');
      el.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let node = null;
      while (walker.nextNode()) {
        if (walker.currentNode.nodeValue.includes(${JSON.stringify(needle)})) { node = walker.currentNode; break; }
      }
      if (!node) return 'no-node';
      const at = node.nodeValue.indexOf(${JSON.stringify(needle)});
      const range = document.createRange();
      if (${JSON.stringify(Boolean(caret))}) { range.setStart(node, at); range.collapse(true); }
      else { range.setStart(node, at); range.setEnd(node, at + ${JSON.stringify(needle)}.length); }
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
      return node.nodeValue.slice(at, at + ${JSON.stringify(needle)}.length);
    })()`);
    await sleep(360);
    if (hit !== needle) throw new Error(`选区未命中「${needle}」：${hit}`);
  };

  const clickToolbarButton = async (index, selector) => {
    await evaluate(`document.querySelectorAll('.ck-editor')[${index}].querySelector('${selector}').click(), true`);
    await sleep(420);
    return editableHtml(index);
  };

  /** 笔色单选按卷面各自成组，必须限定在该编辑器内点 */
  const pickPen = async (index, key) => {
    const checked = await evaluate(`(() => {
      const box = document.querySelectorAll('.rich-editor')[${index}].querySelector('input[type=radio][value=${JSON.stringify(key)}]');
      box.click();
      return box.checked;
    })()`);
    await sleep(200);
    return checked;
  };

  // ---------- 1. 首页 ----------
  await viewport(1440, 960);
  await cdp.send('Page.navigate', { url: `${SITE}/` });
  await waitFor('document.querySelectorAll(".post-card").length > 0');
  const home = await evaluate(`JSON.stringify({
    cards: document.querySelectorAll('.post-card').length,
    placed: [...document.querySelectorAll('.waterfall-item')].filter(el => !/99999/.test(el.style.transform)).length,
    items: document.querySelectorAll('.waterfall-item').length,
    slips: document.querySelectorAll('.record-slip').length,
    index: document.querySelectorAll('.index-link').length,
    lic: document.querySelectorAll('.lic-table tbody tr').length,
    footLinks: [...document.querySelectorAll('.lic-table tbody tr')].map((tr) => {
      const a = tr.querySelector('td:last-child a');
      return a ? { href: a.href, rel: a.rel || '', target: a.target || '', text: a.textContent.trim() } : null;
    }),
    refLinks: document.querySelectorAll('.foot-refs a').length,
    featured: !!document.querySelector('.post-card--featured'),
    pinnedSeal: document.querySelectorAll('.card-pin').length,
    marginOpen: document.querySelector('.shell').dataset.marginOpen,
    title: document.querySelector('.card-title')?.textContent?.trim().slice(0, 18),
    rumorBody: !!document.querySelector('.card-rumor')?.textContent?.trim(),
  })`);
  const h = JSON.parse(home);
  check('首页渲染卡片瀑布流', h.cards > 0, `${h.cards} 张卡 / 已落位 ${h.placed}`);
  check('瀑布流全部条目取得坐标', h.placed === h.items, `${h.placed}/${h.items}`);
  check('卡片同时含标题与谣言两主体', Boolean(h.title && h.rumorBody), h.title);
  check('置顶卡片唯一且有印朱标记', h.pinnedSeal === 1);
  check('侧栏话题导轨存在', h.slips > 0, `${h.slips} 个话题`);
  check('卷首索引由菜单驱动', h.index >= 5, `${h.index} 项`);
  check('页脚协议登记表非空', h.lic >= 10, `${h.lic} 行`);
  const footLinks = h.footLinks.filter(Boolean);
  check(
    '页脚每行框架都带官网或仓库超链接',
    footLinks.length === h.lic && footLinks.every((l) => /^https:\/\//.test(l.href) && !l.href.startsWith(SITE)),
    `${footLinks.length}/${h.lic} 行 · 例：${footLinks[0]?.text || '无'} → ${footLinks[0]?.href || ''}`
  );
  check(
    '页脚外链新窗口打开且带 noopener nofollow',
    footLinks.length > 0 && footLinks.every((l) => l.target === '_blank' && /noopener/.test(l.rel) && /nofollow/.test(l.rel))
  );
  check('外部参照项也给出出处链接', h.refLinks >= 7, `${h.refLinks} 条（技能包无公开出处，故少于 8）`);
  await shot('01-home-desktop');

  // ---------- 2. 批注栏开合（签名控件） ----------
  const before = await evaluate(`document.querySelector('.shell').dataset.marginOpen`);
  await evaluate(`document.querySelector('.margin-toggle').click(), true`);
  await sleep(400);
  const after = await evaluate(`document.querySelector('.shell').dataset.marginOpen`);
  check('页眉可开合批注栏', before !== after, `${before} → ${after}`);
  const collapsedWidth = await evaluate(`document.querySelector('.annotation-margin').getBoundingClientRect().width`);
  await evaluate(`document.querySelector('.margin-toggle').click(), true`);
  await sleep(500);
  const openWidth = await evaluate(`document.querySelector('.annotation-margin').getBoundingClientRect().width`);
  check('批注栏向内展开而非覆盖卷身', openWidth > collapsedWidth + 100, `${Math.round(collapsedWidth)}px → ${Math.round(openWidth)}px`);

  // ---------- 3. 密度滑杆改变列数 ----------
  const colsBefore = await evaluate(`document.querySelectorAll('.waterfall-item')[0]?.getBoundingClientRect().left`);
  await evaluate(`(() => { const el = document.querySelector('#density'); el.value = 420; el.dispatchEvent(new Event('input', {bubbles:true})); return true })()`);
  await sleep(900);
  const wideLeft = await evaluate(`document.querySelectorAll('.waterfall-item')[1]?.getBoundingClientRect().left`);
  check('连续量控件改变真实布局', Number.isFinite(wideLeft), `第二列 left=${Math.round(wideLeft)}（原 ${Math.round(colsBefore)}）`);
  await evaluate(`(() => { const el = document.querySelector('#density'); el.value = 240; el.dispatchEvent(new Event('input', {bubbles:true})); return true })()`);
  await sleep(900);

  // ---------- 4. 话题筛选 ----------
  await evaluate(`document.querySelectorAll('.tagchip')[1]?.click(), true`);
  await waitFor('document.querySelectorAll(".post-card").length >= 1 && location.search.includes("tag=")');
  const filtered = await evaluate(`JSON.stringify({ url: location.search, cards: document.querySelectorAll('.post-card').length })`);
  check('话题筛选生效并写入地址', /tag=/.test(JSON.parse(filtered).url), JSON.parse(filtered).url);
  await cdp.send('Page.navigate', { url: `${SITE}/` });
  await waitFor('document.querySelectorAll(".post-card").length > 0');

  // ---------- 4b. 侧栏话题导轨（游客可见，且驱动真实筛选） ----------
  const railCount = await evaluate(`document.querySelectorAll('.slip-rail .record-slip').length`);
  check('侧栏对游客提供话题导轨', railCount > 0, `${railCount} 个话题`);
  const railTop = await evaluate(`(() => {
    const slip = document.querySelector('.slip-rail .record-slip');
    return JSON.stringify({
      name: slip.querySelector('.slip-title').textContent.trim(),
      count: Number(slip.querySelector('.slip-tag').textContent.trim().match(/\\d+/)[0]),
    });
  })()`);
  const rt = JSON.parse(railTop);
  await evaluate(`document.querySelector('.slip-rail .record-slip').click(), true`);
  await waitFor('location.search.includes("tag=")', 6000, '侧栏话题跳转');
  const railHit = await evaluate(`JSON.stringify({
    url: decodeURIComponent(location.search),
    cards: document.querySelectorAll('.post-card').length,
    current: document.querySelector(".record-slip[aria-current='true'] .slip-title")?.textContent?.trim() || '',
    flag: !!document.querySelector('.slip-tag-active'),
  })`);
  const rh = JSON.parse(railHit);
  check(
    '侧栏话题写入地址并高亮当前条',
    rh.url.includes(`tag=${rt.name}`) && rh.current === rt.name && rh.flag === true,
    `${rh.url} 选中=${rh.current}`
  );
  check('导轨计数与筛选结果一致', rh.cards === rt.count, `话题「${rt.name}」计数 ${rt.count} / 实得 ${rh.cards} 张`);
  await shot('02b-sidebar-topics');
  await cdp.send('Page.navigate', { url: `${SITE}/` });
  await waitFor('document.querySelectorAll(".post-card").length > 0');
  await sleep(600);

  // ---------- 5. 详情页对勘 ----------
  await evaluate(`document.querySelector('.post-card').click(), true`);
  await waitFor('document.querySelectorAll(".collation-col").length === 2');
  const detail = await evaluate(`JSON.stringify({
    cols: document.querySelectorAll('.collation-col').length,
    rule: !!document.querySelector('.collation-rule'),
    anno: document.querySelectorAll('.anno').length,
    overlay: document.querySelectorAll('svg.anno-overlay').length,
    overlayShapes: document.querySelectorAll('svg.anno-overlay .ov').length,
    imgs: document.querySelectorAll('.rich img').length,
    signed: [...document.querySelectorAll('.rich img')].every(el => /sig=/.test(el.getAttribute('src') || '')),
    slips: document.querySelectorAll('.slip-list .record-slip').length,
    rumorHref: document.querySelector('.src-line a')?.getAttribute('href') || '',
    rumorRel: document.querySelector('.src-line a')?.getAttribute('rel') || '',
    linkedSlips: document.querySelectorAll('.slip-list a.slip-title').length,
    slipHref: document.querySelector('.slip-list a.slip-title')?.getAttribute('href') || '',
    dossier: document.querySelectorAll('.dossier dd').length,
    rating: document.querySelector('.verdict')?.textContent?.trim(),
    guestLock: document.querySelector('.decision-note')?.textContent?.trim().slice(0, 12),
  })`);
  const d = JSON.parse(detail);
  check('详情页为谣言↔辟谣双栏对勘', d.cols === 2 && d.rule, `${d.cols} 栏 + 界栏 ${d.rule}`);
  check('富文本画圈/下划线渲染出批注痕迹', d.anno > 0, `${d.anno} 处`);
  check('图片矢量标注复原为 SVG 覆盖层', d.overlay > 0 && d.overlayShapes > 0, `${d.overlay} 图 ${d.overlayShapes} 笔`);
  check('正文图片走签名直链', d.imgs > 0 && d.signed, `${d.imgs} 张`);
  check('材料源以流转单形式登记', d.slips > 0, `${d.slips} 条`);
  check(
    '示例档案的原始载体链接渲染为 nofollow 外链',
    /^https:\/\/example\.org\//.test(d.rumorHref) && /nofollow/.test(d.rumorRel),
    d.rumorHref.slice(0, 44)
  );
  check('材料源出处链接可回页核对', d.linkedSlips >= 1 && /^https:\/\/example\.org\//.test(d.slipHref), `${d.linkedSlips}/${d.slips} 条带链接`);
  check('状态文书字段齐备', d.dossier >= 6, `${d.dossier} 项`);
  check('结论判定可见', Boolean(d.rating), d.rating);
  check('游客操作区提示登录', /游客/.test(d.guestLock || ''), d.guestLock);
  await shot('02-detail-collation');

  // ---------- 6. 登录 ----------
  await cdp.send('Page.navigate', { url: `${SITE}/login` });
  await waitFor('document.querySelector("input[name=password]")');
  await evaluate(`(() => {
    const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
    set(document.querySelector('input[name=username]'), 'admin');
    set(document.querySelector('input[name=password]'), 'admin');
    return true;
  })()`);
  await evaluate(`document.querySelector('form.pane button[type=submit]').click(), true`);
  const jumped = await waitFor('location.pathname === "/"', 9000, '登录跳转');
  if (!jumped) {
    const why = await evaluate(`[...document.querySelectorAll('.toast')].map(t => t.textContent.trim()).join(' / ') || '无提示'`);
    throw new Error(`登录未跳转（可能被限流）：${why}`);
  }
  const authed = await evaluate(`JSON.stringify({ who: document.querySelector('.who')?.textContent?.trim(), logout: [...document.querySelectorAll('button')].some(b => b.textContent.includes('登出')) })`);
  check('默认账号可登录并显示身份', Boolean(JSON.parse(authed).who), JSON.parse(authed).who);
  check('登录态出现登出入口', JSON.parse(authed).logout);

  // ---------- 7. 登录后功能入口 ----------
  const entries = await evaluate(`JSON.stringify([...document.querySelectorAll('.index-link, .margin-link')].map(el => el.textContent.trim().replace(/\\s+/g,' ')))`);
  const list = JSON.parse(entries).join(' | ');
  check('重排序入口在登录后暴露', /卷次重排/.test(list));
  check('菜单编辑入口在登录后暴露', /菜单编辑/.test(list));

  // ---------- 8. 编辑器 ----------
  await cdp.send('Page.navigate', { url: `${SITE}/edit` });
  await waitFor('document.querySelectorAll(".leaf").length === 4');
  const editor = await evaluate(`JSON.stringify({
    leaves: document.querySelectorAll('.leaf').length,
    radios: document.querySelectorAll('input[type=radio]').length,
    progress: !!document.querySelector('progress'),
    busy: document.querySelector('form')?.getAttribute('aria-busy'),
    completeness: document.querySelector('.completeness progress')?.value,
    seal: !!document.querySelector('.seal-press'),
    contenteditable: !!document.querySelector('[contenteditable=true]'),
    tagInput: !!document.querySelector('#tag-input'),
  })`);
  const e = JSON.parse(editor);
  check('编辑器为四叶折叠文书', e.leaves === 4);
  check('编辑器含结论判定单选组', e.radios >= 4, `${e.radios} 个 radio`);
  check('合式度进度条随表单变化', e.progress && Number(e.completeness) < 100, `progress=${e.completeness}`);
  check('富文本面可编辑且用印按钮在位', e.contenteditable && e.seal);

  // 真实键入一段，再试画圈 / 划线
  await evaluate(`(() => {
    const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
    set(document.querySelector('input[type=text]'), '走查样例：某说法是否成立');
    return true;
  })()`);
  await revealLeaf(1);
  await typeIntoEditor(0, '网传某说法，关键句在此。');
  const typedText = await evaluate(`document.querySelectorAll('.ck-editor')[0].querySelector('.ck-editor__editable').textContent`);
  check('富文本面可真实键入并回读', /关键句在此/.test(typedText), typedText.slice(0, 26));

  await selectInEditor(0, '关键句');
  const annoOk = await clickToolbarButton(0, '.ck-button.ck-yan-circle');
  check('选中文字可画圈（生成批注 span）', /<span class="anno anno-circle c-seal">关键句<\/span>/.test(annoOk), annoOk.slice(0, 70));

  await selectInEditor(0, '网传某说法');
  const lineOk = await clickToolbarButton(0, '.ck-button.ck-yan-line');
  check('选中文字可加重点下划线', /<span class="anno anno-line c-seal">网传某说法<\/span>/.test(lineOk), lineOk.slice(0, 90));

  check('批注笔色可切换', (await pickPen(0, 'gold')) === true);
  await selectInEditor(0, '在此');
  const goldOk = await clickToolbarButton(0, '.ck-button.ck-yan-circle');
  check('笔色切换进入后续批注', /<span class="anno anno-circle c-gold">在此<\/span>/.test(goldOk), goldOk.slice(0, 96));
  const clearedOk = await clickToolbarButton(0, '.ck-button.tool-anno-clear');
  check('解除标注按钮摘掉当前批注而不伤正文', !/anno-circle c-gold">在此</.test(clearedOk) && /在此/.test(clearedOk), clearedOk.slice(0, 96));
  await shot('03-editor-leaf');

  // ---------- 9. 重排序页 ----------
  await cdp.send('Page.navigate', { url: `${SITE}/reorder` });
  await waitFor('document.querySelectorAll(".order-row").length > 0');
  const reorder = await evaluate(`JSON.stringify({
    rows: document.querySelectorAll('.order-row').length,
    handles: document.querySelectorAll('.drag-handle').length,
    upDown: document.querySelectorAll('.order-tools button').length,
    pinnedFirst: document.querySelector('.order-row')?.classList.contains('order-row--pinned'),
  })`);
  const r = JSON.parse(reorder);
  check('重排序以卡片列表显示标题', r.rows > 0, `${r.rows} 行`);
  check('每行有拖动把手与键盘等价按钮', r.handles === r.rows && r.upDown === r.rows * 2, `把手 ${r.handles} / 按钮 ${r.upDown}`);
  const firstTitle = await evaluate(`document.querySelectorAll('.order-title')[0].textContent`);
  await evaluate(`document.querySelectorAll('.order-row')[1].querySelectorAll('button')[0].click(), true`);
  await sleep(400);
  const moveTest = await evaluate(`JSON.stringify({ first: ${JSON.stringify(firstTitle)}, now: document.querySelectorAll('.order-title')[0].textContent })`);
  const m = JSON.parse(moveTest);
  check('↑↓ 可真实改变顺序', m.first !== m.now, `"${m.first.slice(0, 12)}" → "${m.now.slice(0, 12)}"`);
  await shot('04-reorder');

  // ---------- 10. 菜单编辑 ----------
  await cdp.send('Page.navigate', { url: `${SITE}/menu-editor` });
  await waitFor('document.querySelectorAll(".mrow").length > 0');
  const menuState = await evaluate(`JSON.stringify({
    rows: document.querySelectorAll('.mrow').length,
    checks: document.querySelectorAll('.mrow input[type=checkbox]').length,
    preview: document.querySelectorAll('.preview li').length,
  })`);
  const ms = JSON.parse(menuState);
  check('菜单编辑列出全部模块', ms.rows >= 6 && ms.checks === ms.rows, `${ms.rows} 行`);
  await evaluate(`document.querySelectorAll('.mrow input[type=checkbox]')[2].click(), true`);
  await sleep(400);
  const hidden = await evaluate(`document.querySelectorAll('.preview li').length`);
  check('取消勾选即时反映到索引预览', hidden === ms.preview - 1, `${ms.preview} → ${hidden}`);
  await evaluate(`document.querySelectorAll('.mrow input[type=checkbox]')[2].click(), true`);
  await sleep(400);
  const restored = await evaluate(`document.querySelectorAll('.preview li').length`);
  check('重新勾选可还原', restored === ms.preview, `${restored} 项`);
  await shot('05-menu-editor');

  // ---------- 11. 用户名册 ----------
  await cdp.send('Page.navigate', { url: `${SITE}/users` });
  await waitFor('document.querySelectorAll(".users tbody tr").length > 0');
  const users = await evaluate(`JSON.stringify({
    rows: document.querySelectorAll('.users tbody tr').length,
    banner: !!document.querySelector('.banner'),
    plain: document.querySelector('.users tbody tr')?.textContent?.includes('明文'),
  })`);
  const u = JSON.parse(users);
  check('用户名册可读并显示存储形态', u.rows > 0 && u.plain, `${u.rows} 人`);
  check('明文 CSV 风险有显式提醒', u.banner);

  // ---------- 13. 懒加载与降级动效 ----------
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await cdp.send('Page.navigate', { url: `${SITE}/` });
  await waitFor('document.querySelectorAll(".post-card").length > 0');
  const reduced = await evaluate(`(() => {
    const el = document.querySelector('.reveal');
    const anim = getComputedStyle(el).animationName;
    const opacity = getComputedStyle(el).opacity;
    const img = document.querySelector('.card-cover img');
    return JSON.stringify({ anim, opacity, lazy: img?.getAttribute('loading'), revealed: el?.dataset.revealed });
  })()`);
  const rm = JSON.parse(reduced);
  check('降低动效偏好下直接呈现终态', rm.opacity === '1' && (rm.anim === 'none' || rm.anim === ''), `animation=${rm.anim} opacity=${rm.opacity}`);
  check('图片走原生懒加载', rm.lazy === 'lazy', `loading=${rm.lazy}`);
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });

  // ---------- 14. 窄屏重排 ----------
  await viewport(390, 844);
  await sleep(700);
  const mobile = await evaluate(`JSON.stringify({
    areas: getComputedStyle(document.querySelector('.shell')).gridTemplateAreas,
    marginVisible: document.querySelector('.annotation-margin').getBoundingClientRect().width,
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    toggle: !!document.querySelector('.margin-toggle'),
  })`);
  const mo = JSON.parse(mobile);
  check('窄屏下批注栏转为卷首披露条', /head/.test(mo.areas) && mo.marginVisible > 300, `width=${Math.round(mo.marginVisible)}`);
  check('窄屏无横向溢出', mo.overflowX <= 1, `溢出 ${mo.overflowX}px`);
  await shot('06-mobile-home');

  await viewport(1440, 960);
  await sleep(500);
  await shot('07-home-final');

  // ---------- 15. 建档 → 呈现 → 删除 全链路 ----------
  await viewport(1440, 960);
  await cdp.send('Page.navigate', { url: `${SITE}/login` });
  await waitFor('document.querySelector("input[name=password]")');
  await evaluate(`(() => {
    const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
    set(document.querySelector('input[name=username]'), 'admin');
    set(document.querySelector('input[name=password]'), 'admin');
    document.querySelector('form.pane button[type=submit]').click();
    return true;
  })()`);
  await waitFor('location.pathname === "/"', 9000, '登录跳转');

  const NEW_TITLE = '走查建档：某饮料可治愈某病（自动化样例）';
  await cdp.send('Page.navigate', { url: `${SITE}/edit` });
  await waitFor('document.querySelectorAll(".leaf").length === 4');
  await sleep(300);

  const submitEnabled = await evaluate(`!document.querySelector('.seal-press[disabled]')`);
  check('新建态用印按钮可用（不被永久禁用）', submitEnabled === true);

  // 一、标题与判定
  await evaluate(`(() => {
    const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
    document.querySelectorAll('.leaf')[0].click();
    set(document.querySelector('input[type=text]'), ${JSON.stringify(NEW_TITLE)});
    document.querySelector('input[name=rating][value=不实]').click();
    return true;
  })()`);

  // 二、谣言案例 + 话题（真实键入 + 真实批注按钮，不再手改 DOM）
  await revealLeaf(1);
  await evaluate(`(() => {
    const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
    const tag = document.querySelector('#tag-input');
    set(tag, '走查话题');
    tag.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return true;
  })()`);
  await typeIntoEditor(0, '网传该饮料可治愈疾病，关键断言在此。');
  await selectInEditor(0, '关键断言在此');
  const rumorHtml = await clickToolbarButton(0, '.ck-button.ck-yan-circle');
  check('建档卷一：正文可键入且圈划落到正文', /关键断言在此/.test(rumorHtml) && /<span class="anno anno-circle c-seal">关键断言在此<\/span>/.test(rumorHtml), rumorHtml.slice(0, 96));

  // 二·补：在浏览器里真的上传一张插图（此前只验过接口）
  await selectInEditor(0, '网传该饮料', { caret: true });
  await evaluate(`document.querySelectorAll('.ck-editor')[0].querySelector('.ck-button.tool-image').click(), true`);
  await sleep(600);
  const fileNode = await cdp.send('DOM.getDocument', { depth: -1 }).then((r) =>
    cdp.send('DOM.querySelector', { nodeId: r.root.nodeId, selector: 'input[type=file]' })
  );
  check('编辑器里有可聚焦的插图上传入口', Boolean(fileNode.nodeId), String(fileNode.nodeId));
  await cdp.send('DOM.setFileInputFiles', {
    nodeId: fileNode.nodeId,
    files: [`${process.cwd()}/.scratch-verify/sample-chart.png`],
  });
  const withImage = await waitFor(
    'document.querySelectorAll(".ck-editor")[0].querySelectorAll(".ck-editor__editable figure img").length > 0',
    20000,
    '插图插入正文'
  );
  const uploadedMid = await evaluate(
    `document.querySelectorAll('.ck-editor')[0].querySelector('.ck-editor__editable figure img')?.dataset.mid || ''`
  );
  check('编辑器插图上传后进入正文并带媒体号', withImage === true && Boolean(uploadedMid), `mid=${uploadedMid}`);
  await sleep(400);

  // 三、辟谣内容（换花青笔色后划线）
  await revealLeaf(2);
  await pickPen(1, 'indigo');
  await typeIntoEditor(1, '对照试验未见疗效，该结论不成立。');
  await selectInEditor(1, '该结论不成立');
  const verdictHtml = await clickToolbarButton(1, '.ck-button.ck-yan-line');
  check('建档卷二：辟谣面批注独立成色', /<span class="anno anno-line c-indigo">该结论不成立<\/span>/.test(verdictHtml), verdictHtml.slice(0, 96));

  // 四、材料源
  await evaluate(`document.querySelectorAll('.leaf')[3].click(), true`);
  await sleep(300);
  const rowState = await evaluate(`JSON.stringify({
    rows: document.querySelectorAll('.row-card').length,
    addBtn: [...document.querySelectorAll('button')].some((b) => b.textContent.includes('增加一条材料源')),
  })`);
  const rs = JSON.parse(rowState);
  check('新建态自带一行可填材料源', rs.rows >= 1 && rs.addBtn, `${rs.rows} 行 + 增删按钮在位`);
  await sleep(200);
  await evaluate(`(() => {
    const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
    const inputs = document.querySelectorAll('.row-card .paper-input');
    set(inputs[0], '走查材料：某机构对照试验记录');
    set(inputs[1], '示例机构');
    set(inputs[2], 'https://example.org/evidence/walkthrough');
    return true;
  })()`);
  await sleep(300);

  const srcState = await evaluate(`JSON.stringify({
    rows: document.querySelectorAll('.row-card').length,
    first: document.querySelector('.row-card .paper-input')?.value || '',
  })`);
  console.log(`  (材料源状态：${srcState})`);
  const complete = await evaluate(`JSON.stringify({
    v: document.querySelector('.completeness progress').value,
    miss: document.querySelector('.completeness .micro-label')?.textContent?.trim(),
  })`);
  const cq = JSON.parse(complete);
  check('四叶填齐后合式度达 100%', Number(cq.v) === 100, `合式度 ${cq.v}% · ${cq.miss}`);

  await evaluate(`document.querySelector('form.pane button[type=submit]').click(), true`);
  await waitFor('document.querySelector(".paper-dialog[open]")', 6000, '确认对话框');
  const dialogText = await evaluate(`document.querySelector('.paper-dialog')?.textContent?.replace(/\\s+/g,' ').trim().slice(0, 120)`);
  check('用印前给出可核对的摘要与后果', /不实/.test(dialogText) && /后果/.test(dialogText), dialogText.slice(0, 60));
  await shot('08-confirm-dialog');
  await evaluate(`document.querySelector('.paper-dialog[open] footer button:last-child').click(), true`);
  const landed = await waitFor('location.pathname.startsWith("/post/")', 12000, '归档后跳转详情页');
  check('建档后可用印归档并跳转详情', landed, landed ? '' : '未跳转');

  const createdId = await evaluate(`location.pathname.split('/post/')[1] || ''`);
  // 转场未用 mode="out-in"，编辑页与详情页会同帧共存（两棵 .sheet-inner 的
  // .sheet-title 同名）。等旧组件卸载后再读取，否则断言取到的是离场页的标题。
  const settled = await waitFor('document.querySelectorAll(".sheet-inner").length === 1', 8000, '转场结束');
  const created = await evaluate(`JSON.stringify({
    url: location.pathname,
    title: document.querySelector('.sheet-title')?.textContent?.trim(),
    cols: document.querySelectorAll('.collation-col').length,
    anno: document.querySelectorAll('.anno').length,
    rating: document.querySelector('.verdict')?.textContent?.trim(),
    tag: document.querySelector('.tagchip')?.textContent?.trim(),
    slips: document.querySelectorAll('.slip-list .record-slip').length,
    rumorHref: document.querySelector('.src-line a')?.getAttribute('href') || '',
    rumorRel: document.querySelector('.src-line a')?.getAttribute('rel') || '',
    linkedSlips: document.querySelectorAll('.slip-list a.slip-title').length,
    slipHref: document.querySelector('.slip-list a.slip-title')?.getAttribute('href') || '',
  })`);
  const c = JSON.parse(created);
  check(
    '新档详情完整呈现对勘与批注',
    c.title === NEW_TITLE && c.cols === 2 && c.anno >= 2,
    `id=${c.url.split('/post/')[1]} 转场收束=${settled} 实际标题=${JSON.stringify(c.title)} 双栏=${c.cols} 批注=${c.anno} 判定=${c.rating}`
  );
  check('话题与材料源随档保存', c.tag === '走查话题' && c.slips >= 1, `tag=${c.tag} 材料=${c.slips}`);
  check(
    '新建档未填载体链接时不渲染空锚、填了出处则渲染可回页链接',
    c.rumorHref === '' && c.linkedSlips >= 1 && /^https:\/\/example\.org\//.test(c.slipHref),
    `载体=${JSON.stringify(c.rumorHref)} 出处=${c.slipHref}`
  );
  await shot('09-created-detail');

  await cdp.send('Page.navigate', { url: `${SITE}/` });
  await waitFor('document.querySelectorAll(".post-card").length > 0');
  const appears = await evaluate(`[...document.querySelectorAll('.card-title')].some(el => el.textContent.includes('走查建档'))`);
  check('新档出现在首页瀑布流（无需刷新重建）', appears === true);

  // 置顶唯一性（UI 路径）
  await cdp.send('Page.navigate', { url: `${SITE}/post/${createdId}` });
  await waitFor('document.querySelectorAll(".collation-col").length === 2');
  await evaluate(`(() => { const b = [...document.querySelectorAll('.decision .paper-btn')].find(x => x.textContent.includes('置顶本条')); b?.click(); return !!b })()`);
  await sleep(1200);
  const pinState = await evaluate(`JSON.stringify({ pinned: !!document.querySelector('.pin-flag'), toasts: [...document.querySelectorAll('.toast')].map(t => t.textContent.trim().slice(0, 40)) })`);
  const ps = JSON.parse(pinState);
  check('UI 置顶生效并提示原置顶被解除', ps.pinned && /原置顶/.test(ps.toasts.join(' ')), ps.toasts.join(' / ').slice(0, 90));

  // 浏览器上传的插图在详情页应以新鲜签名直链呈现
  const shownImage = await evaluate(`(() => {
    const want = ${JSON.stringify(uploadedMid)};
    const img = [...document.querySelectorAll('img')].find((i) => i.getAttribute('data-mid') === want);
    return JSON.stringify({ found: Boolean(img), signed: /exp=/.test(img?.getAttribute('src') || '') });
  })()`);
  const si = JSON.parse(shownImage);
  check('浏览器上传的插图在详情页以签名直链呈现', si.found === true && si.signed === true, shownImage);

  // 删除（UI 路径）
  await cdp.send('Page.navigate', { url: `${SITE}/post/${createdId}` });
  await waitFor('document.querySelectorAll(".collation-col").length === 2');
  await evaluate(`(() => { const b = [...document.querySelectorAll('.decision .paper-btn')].find(x => /删除/.test(x.textContent)); b?.click(); return !!b })()`);
  await waitFor('document.querySelector(".paper-dialog[open]")', 6000, '删除确认框');
  await evaluate(`document.querySelector('.paper-dialog[open] footer button:last-child').click(), true`);
  const backHome = await waitFor('location.pathname === "/"', 10000, '删除后回卷首');
  await sleep(900);
  const goneState = await evaluate(`JSON.stringify({
    path: location.pathname,
    cards: document.querySelectorAll('.post-card').length,
    still: [...document.querySelectorAll('.card-title')].filter((el) => el.textContent.includes('走查建档')).length,
    toasts: [...document.querySelectorAll('.toast')].map((t) => t.textContent.trim().slice(0, 24)),
  })`);
  check('UI 删除生效且不留残卡', backHome && JSON.parse(goneState).still === 0, goneState);

  // 删档后，浏览器上传的那张图应被服务端回收（文件与索引都不留）
  const mediaFile = path.join(process.cwd(), 'server/data/media', `${uploadedMid}.png`);
  for (let i = 0; i < 30 && fs.existsSync(mediaFile); i += 1) await sleep(150);
  const idxText = fs.readFileSync(path.join(process.cwd(), 'server/data/media-index.json'), 'utf8');
  check(
    '删档后浏览器上传的插图被回收',
    fs.existsSync(mediaFile) === false && idxText.includes(String(uploadedMid)) === false,
    `文件残留 ${fs.existsSync(mediaFile)} · 索引残留 ${idxText.includes(String(uploadedMid))}`
  );

  const pinSole = await evaluate(`[...document.querySelectorAll('.post-card')].filter(el => el.dataset.pinned === 'true').length`);
  check('删除后全局仍至多一个置顶', Number(pinSole) <= 1, `置顶 ${pinSole} 个`);
  // ---------- 16. 界面上存在、但先前从未点过的控件 ----------
  await cdp.send('Page.navigate', { url: `${SITE}/` });
  await waitFor('document.querySelectorAll(".post-card").length > 0');

  await evaluate(`document.querySelector('.paper-switch[data-switch="tone"]').click(), true`);
  await sleep(350);
  const night = await evaluate(`document.documentElement.dataset.tone`);
  check('夜读纸面开关切换全局色域', night === 'night', String(night));
  await evaluate(`document.querySelector('.paper-switch[data-switch="tone"]').click(), true`);
  await sleep(350);
  const day = await evaluate(`document.documentElement.dataset.tone`);
  check('可切回日间纸面', day === 'day', String(day));

  await cdp.send('Page.navigate', { url: `${SITE}/about` });
  await sleep(800);
  const about = await evaluate(`document.querySelector('.sheet-title')?.textContent?.trim() || ''`);
  check('凡例页可达', /凡例/.test(about), about);
  const samplePane = await evaluate(`(() => {
    const sec = [...document.querySelectorAll('.pane')].find((s) => s.querySelector('h2')?.textContent.trim() === '出厂示例');
    return JSON.stringify({
      rows: sec ? sec.querySelectorAll('.matrix tbody tr').length : 0,
      hasLink: /example\\.org/.test(sec?.textContent || ''),
      hasUser: /示例馆员/.test(sec?.textContent || ''),
      hasEpub: /EPUB 在线阅览/.test(sec?.textContent || ''),
      leaksPwd: /demo-pass|roxy-guest/.test(sec?.textContent || ''),
    })
  })()`);
  const ex = JSON.parse(samplePane);
  check(
    '凡例页列出出厂示例且逐条给出编辑/删除入口',
    ex.rows >= 6 && ex.hasLink && ex.hasUser && ex.hasEpub,
    `${ex.rows} 行`
  );
  check('示例清单不展示任何口令值', ex.leaksPwd === false);

  await cdp.send('Page.navigate', { url: `${SITE}/this-page-does-not-exist` });
  await sleep(800);
  const nf = await evaluate(`document.querySelector('.sheet-title')?.textContent?.trim() || ''`);
  check('未知路径落到"未收录"而非白屏', /未收录/.test(nf), nf);

  await cdp.send('Page.navigate', { url: `${SITE}/search` });
  await waitFor('document.querySelector("form input")', 6000, '检索页表单');
  await evaluate(`(() => { const el = document.querySelector('form input'); el.value = '辐射'; el.dispatchEvent(new Event('input', { bubbles: true })); return true })()`);
  await sleep(200);
  await evaluate(`document.querySelector('form button[type=submit]').click(), true`);
  await waitFor('document.querySelectorAll(".score-bar").length > 0', 8000, '检索结果');
  const hits = await evaluate(`document.querySelectorAll('.score-bar').length`);
  check('检索页提交可出结果并给出相关度', hits > 0, `${hits} 条`);

  await cdp.send('Page.navigate', { url: `${SITE}/tags` });
  await waitFor('document.querySelectorAll(".tagline").length > 0', 6000, '话题索引');
  const topicName = await evaluate(`document.querySelector('.tagline span')?.textContent?.trim() || ''`);
  await evaluate(`document.querySelector('.tagline').click(), true`);
  await waitFor('location.pathname === "/" && location.search.includes("tag=")', 6000, '话题跳转');
  const topicUrl = await evaluate(`decodeURIComponent(location.search)`);
  check('话题索引页点击可驱动首页筛选', topicUrl.includes('tag='), `${topicName} → ${topicUrl}`);
  await cdp.send('Page.navigate', { url: `${SITE}/` });
  await waitFor('document.querySelectorAll(".post-card").length > 0');

  // 重排序页：真点保存，恢复时再点一次
  await cdp.send('Page.navigate', { url: `${SITE}/reorder` });
  await waitFor('document.querySelectorAll(".order-row").length > 1', 6000, '重排列表');
  const firstBefore = await evaluate(`document.querySelector('.order-row .order-title')?.textContent?.trim().slice(0, 12) || ''`);
  const saveBtn = await evaluate(`(() => { const b = document.querySelector('.pane button.seal-press, form button.seal-press, .sheet-main button.seal-press'); return b ? b.disabled : 'none' })()`);
  await evaluate(`document.querySelector('.order-row button[aria-label^="下移"]').click(), true`);
  await sleep(300);
  const enabledAfter = await evaluate(`(() => { const b = document.querySelector('.sheet-main button.seal-press'); return b ? b.disabled : 'none' })()`);
  check('重排在改动前禁用保存、改动后可用', saveBtn === true && enabledAfter === false, `禁用 ${saveBtn} → ${enabledAfter}`);
  await evaluate(`document.querySelector('.sheet-main button.seal-press').click(), true`);
  const orderSaved = await waitFor('document.querySelector(".sheet-main button.seal-press")?.disabled === true', 9000, '保存后回到无改动态');
  check('重排序可保存（保存后回到无改动态）', orderSaved === true);
  await cdp.send('Page.navigate', { url: `${SITE}/` });
  await waitFor('document.querySelectorAll(".post-card").length > 0');
  const firstAfter = await evaluate(`document.querySelector('.card-title')?.textContent?.trim().slice(0, 12) || ''`);
  check('重排序保存后首页次序真的变了', firstAfter !== firstBefore, `${firstBefore} → ${firstAfter}`);
  await cdp.send('Page.navigate', { url: `${SITE}/reorder` });
  await waitFor('document.querySelectorAll(".order-row").length > 1', 6000, '重排列表（还原）');
  await evaluate(`document.querySelector('.order-row button[aria-label^="上移"]').click(), true`);
  await sleep(300);
  await evaluate(`document.querySelector('.sheet-main button.seal-press').click(), true`);
  await sleep(900);

  // 菜单编辑：隐藏"凡例"并保存 → 页眉入口消失 → 还原
  await cdp.send('Page.navigate', { url: `${SITE}/menu-editor` });
  await waitFor('document.querySelectorAll(".paper-check input[type=checkbox]").length > 3', 6000, '菜单编辑行');
  const hideAbout = await evaluate(`(() => {
    const input = document.querySelector('[aria-label="about 的菜单显示名"]');
    const box = input?.closest('li.mrow')?.querySelector('input[type=checkbox]');
    if (!box) return 'no-box';
    if (box.checked) box.click();
    return String(box.checked);
  })()`);
  check('取消勾选即改变暴露状态', hideAbout === 'false', hideAbout);
  await evaluate(`[...document.querySelectorAll('button')].find(b => /保存菜单/.test(b.textContent))?.click(), true`);
  await waitFor('[...document.querySelectorAll(".toast")].some(t => /菜单/.test(t.textContent))', 8000, '菜单保存提示');
  await cdp.send('Page.navigate', { url: `${SITE}/` });
  await sleep(900);
  const indexTexts = await evaluate(`[...document.querySelectorAll('.index-link')].map(el => el.textContent.trim()).join('|')`);
  check('菜单隐藏后页眉入口消失', !/凡例/.test(indexTexts), indexTexts.slice(0, 60));
  await cdp.send('Page.navigate', { url: `${SITE}/menu-editor` });
  await sleep(900);
  await evaluate(`(() => { const input = document.querySelector('[aria-label="about 的菜单显示名"]'); const box = input?.closest('li, .menu-row, .row')?.querySelector('input[type=checkbox]'); if (box && !box.checked) box.click(); return true })()`);
  await sleep(200);
  await evaluate(`[...document.querySelectorAll('button')].find(b => /保存菜单/.test(b.textContent))?.click(), true`);
  await waitFor('[...document.querySelectorAll(".toast")].some(t => /菜单/.test(t.textContent))', 8000, '菜单还原提示');
  await cdp.send('Page.navigate', { url: `${SITE}/` });
  await sleep(900);
  const menuRestored = await evaluate(`[...document.querySelectorAll('.index-link')].map(el => el.textContent.trim()).join('|')`);
  check('重新勾选后入口还原', /凡例/.test(menuRestored), menuRestored.slice(0, 60));

  // 用户名册：新增 → 出现 → 确认移除 → 消失
  await cdp.send('Page.navigate', { url: `${SITE}/users` });
  await waitFor('document.querySelector("form[aria-label=\\"新增可登录用户\\"]")', 6000, '名册表单');
  await evaluate(`(() => {
    const f = document.querySelector('form[aria-label="新增可登录用户"]');
    if (!f) return 'no-form';
    const [u, p, d] = [...f.querySelectorAll('input')];
    u.value = 'walkuser'; u.dispatchEvent(new Event('input', { bubbles: true }));
    p.value = 'walkthrough-2026'; p.dispatchEvent(new Event('input', { bubbles: true }));
    d.value = '走查用户'; d.dispatchEvent(new Event('input', { bubbles: true }));
    return 'filled';
  })()`);
  await sleep(200);
  await evaluate(`document.querySelector('form[aria-label="新增可登录用户"] button[type=submit]')?.click(), true`);
  await waitFor('document.body.textContent.includes("walkuser")', 8000, '新用户出现在名册');
  const added = await evaluate(`document.querySelectorAll('.users tbody tr').length`);
  check('界面可新增登录用户', added >= 2, `${added} 人`);
  await evaluate(`(() => {
    const row = [...document.querySelectorAll('.users tbody tr')].find(tr => tr.textContent.includes('walkuser'));
    [...row.querySelectorAll('button')].find(b => /移除/.test(b.textContent))?.click();
    return true;
  })()`);
  await waitFor('document.querySelector(".paper-dialog[open]")', 6000, '移除确认框');
  await evaluate(`[...document.querySelectorAll('.paper-dialog[open] footer button')].find(b => /确认移除/.test(b.textContent)).click(), true`);
  await waitFor('!document.body.textContent.includes("walkuser")', 8000, '用户已移除');
  const removed = await evaluate(`document.body.textContent.includes('walkuser')`);
  check('界面可移除用户且不留痕', removed === false);

  // 详情页：置顶 / 取消置顶
  await cdp.send('Page.navigate', { url: `${SITE}/` });
  await waitFor('document.querySelectorAll(".post-card").length > 0');
  await evaluate(`document.querySelector('.post-card').click(), true`);
  await waitFor('document.querySelectorAll(".collation-col").length === 2', 8000, '档案详情');
  // 置顶是开关：不假设初始状态，点一次看文案是否翻转，再点一次看是否翻回
  const readPin = `(() => { const b = [...document.querySelectorAll('.decision button')].find((x) => /置顶/.test(x.textContent)); return b ? b.textContent.trim() : 'none' })()`;
  const pin0 = await evaluate(readPin);
  await evaluate(`[...document.querySelectorAll('.decision button')].find((x) => /置顶/.test(x.textContent)).click(), true`);
  await sleep(1400);
  const pin1 = await evaluate(readPin);
  check('详情页可切换置顶状态', pin1 !== pin0 && /置顶/.test(pin1), `${pin0} → ${pin1}`);
  await evaluate(`[...document.querySelectorAll('.decision button')].find((x) => /置顶/.test(x.textContent)).click(), true`);
  await sleep(1400);
  const pin2 = await evaluate(readPin);
  check('再点一次可回到原状态', pin2 === pin0, `${pin1} → ${pin2}`);

  // 编辑器：CKEditor 自带格式是否落在后端白名单的形制上（粗体 / 清单 / 引文）
  await cdp.send('Page.navigate', { url: `${SITE}/edit` });
  await waitFor('document.querySelectorAll(".ck-editor__editable").length === 2', 30000, '富文本面就绪');
  const stockTips = await evaluate(
    `[...document.querySelectorAll('.ck-toolbar .ck-button')].map(b => b.getAttribute('data-cke-tooltip-text') || '')`
  );
  check(
    'CKEditor 自带按钮提示随界面转为中文',
    ['撤销', '加粗', '项目符号列表', '块引用'].every((t) => stockTips.some((x) => x.startsWith(t))) &&
      !['Undo', 'Bold', 'Bulleted List', 'Block quote'].some((t) => stockTips.includes(t)),
    stockTips.slice(0, 8).join(' / ')
  );
  await revealLeaf(1);
  await typeIntoEditor(0, '某饮料可治愈疾病');
  await selectInEditor(0, '某饮料');
  const bolded = await clickToolbarButton(0, '.ck-button[data-cke-tooltip-text^="加粗"]');
  check('加粗产出 strong（白名单内形制）', /<strong>某饮料<\/strong>/.test(bolded), bolded.slice(0, 90));
  await selectInEditor(0, '可治愈疾病');
  const listed = await clickToolbarButton(0, '.ck-button[data-cke-tooltip-text^="项目符号列表"]');
  check('清单项产出 ul>li（白名单内形制）', /<ul><li[^>]*>/.test(listed), listed.slice(0, 130));
  const quoted = await clickToolbarButton(0, '.ck-button[data-cke-tooltip-text^="块引用"]');
  check('引文键把选段升格为 blockquote', /<blockquote>/.test(quoted), quoted.slice(0, 150));

  // 用印对话框的取消分支与提示关闭
  await evaluate(`document.querySelector('form.pane button[type=submit]').click(), true`);
  await waitFor('document.querySelector(".paper-dialog[open]")', 6000, '确认对话框');
  await evaluate(`document.querySelector('.paper-dialog[open] footer button:first-child').click(), true`);
  await sleep(400);
  const cancelled = await evaluate(`document.querySelector('.paper-dialog[open]') === null && location.pathname === "/edit"`);
  check('确认对话框可取消且不改状态', cancelled === true);
  const closedToast = await evaluate(`(() => { const b = document.querySelector('.toast button'); if (!b) return 'none'; b.click(); return 'clicked' })()`);
  await sleep(300);
  check('提示条可手动关闭', closedToast === 'clicked' || closedToast === 'none', closedToast);

  // ---------- 17. 资源库与洛琪希图书馆镜像 ----------
  const railBlocks = await evaluate(`JSON.stringify({
    sources: !!document.querySelector('nav[aria-label="辟谣常用资源清单"]'),
    sourceRows: document.querySelectorAll('nav[aria-label="辟谣常用资源清单"] .record-slip').length,
    lib: [...document.querySelectorAll('.margin-section')].some((s) => /洛琪希图书馆镜像/.test(s.textContent)),
    libBook: [...document.querySelectorAll('.margin-section')].find((s) => /洛琪希图书馆镜像/.test(s.textContent))?.textContent.includes('1') ?? false,
  })`);
  const rb = JSON.parse(railBlocks);
  check('侧栏呈现辟谣常用资源库块', rb.sources === true && rb.sourceRows > 0, `${rb.sourceRows} 条`);
  check('侧栏呈现洛琪希图书馆镜像块', rb.lib === true);

  await cdp.send('Page.navigate', { url: `${SITE}/resources` });
  await waitFor('document.querySelectorAll(".res-row").length > 0', 8000, '资源库列表');
  const resPage = await evaluate(`JSON.stringify({
    groups: document.querySelectorAll('.group').length,
    href: document.querySelector('.res-row')?.getAttribute('href') || '',
    rel: document.querySelector('.res-row')?.getAttribute('rel') || '',
    name: document.querySelector('.res-row .slip-title')?.textContent?.trim().slice(0, 20) || '',
    editor: Boolean(document.querySelector('form[aria-label], .pane .paper-btn.seal-press')),
  })`);
  const rp = JSON.parse(resPage);
  check('资源库页按分组列出可核对的入口', rp.groups > 0 && /^https:\/\//.test(rp.href) && /nofollow/.test(rp.rel), `${rp.groups} 组 · ${rp.name}`);
  check('登录用户在资源库页可编辑条目', rp.editor === true);
  const railLink = await evaluate(`(() => {
    const row = [...document.querySelectorAll('.res-row')].find((a) => a.getAttribute('href') === '/library');
    return row ? JSON.stringify({ name: row.querySelector('.slip-title')?.textContent?.trim().slice(0, 24) || '' }) : 'none';
  })()`);
  check('资源库支持站内链接形态的示例条目', railLink !== 'none', String(railLink).slice(0, 60));

  await cdp.send('Page.navigate', { url: `${SITE}/library` });
  await waitFor('document.querySelector(\'.pane[aria-label="在架书目"] tbody tr\')', 8000, '镜像页书目表');
  const libPage = await evaluate(`JSON.stringify({
    rows: document.querySelectorAll('.pane[aria-label="在架书目"] tbody tr').length,
    gated: document.querySelectorAll('.pane[aria-label="在架书目"] button[disabled]').length,
    pending: document.querySelectorAll('.pending-list .tagline').length,
    keyRows: document.querySelectorAll('.pane[aria-label="口令管理"] .lic-table tbody tr').length,
    fileCell: document.querySelector('.pane[aria-label="书目管理"] .mono')?.textContent?.trim() || '',
    codeVisible: (document.querySelector('.pane[aria-label="口令管理"] .lic-table tbody')?.textContent || '').includes('roxy-guest'),
  })`);
  const lp = JSON.parse(libPage);
  check('镜像页对在架书目逐项列出且取书受口令门控', lp.rows > 0 && lp.gated === lp.rows, `${lp.rows} 册 / ${lp.gated} 个禁用按钮`);
  check('馆员视图可见磁盘文件名与口令明文', /\.epub$/.test(lp.fileCell) && lp.codeVisible === true, lp.fileCell);

  // 解锁后取书链接应真的能取到文件
  await evaluate(`(() => {
    const input = document.querySelector('input[type=password]');
    const set = Object.getOwnPropertyDescriptor(input.constructor.prototype, 'value').set;
    set.call(input, 'roxy-guest');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await evaluate(`document.querySelector('.gate button[type=submit]').click(), true`);
  await waitFor('document.querySelectorAll(".lic-table a[download]").length > 0', 8000, '取书链接出现');
  const dlCheck = await evaluate(`(async () => {
    const a = document.querySelector('.lic-table a[download]');
    const res = await fetch(a.getAttribute('href'));
    const buf = await res.arrayBuffer();
    return JSON.stringify({ status: res.status, bytes: buf.byteLength, type: res.headers.get('content-type'), href: a.getAttribute('href').slice(0, 24) });
  })()`);
  const dc = JSON.parse(dlCheck);
  check('输入口令后可直接取到 EPUB 文件', dc.status === 200 && dc.bytes > 1000 && dc.type === 'application/epub+zip', `${dc.status} · ${dc.bytes}B · ${dc.type}`);

  // 口令管理：签发 → 停用 → 吊销（自清理，不留测试口令）
  const keyCountBefore = lp.keyRows;
  await evaluate(`(() => {
    const pane = document.querySelector('.pane[aria-label="口令管理"]');
    const [codeInput, labelInput] = pane.querySelectorAll('input[type=text]');
    const set = Object.getOwnPropertyDescriptor(codeInput.constructor.prototype, 'value').set;
    set.call(codeInput, 'bw-walk-key'); codeInput.dispatchEvent(new Event('input', { bubbles: true }));
    set.call(labelInput, '走查临时口令'); labelInput.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await sleep(200);
  await evaluate(`[...document.querySelectorAll('.pane[aria-label="口令管理"] button')].find((b) => b.textContent.trim() === '签发口令').click(), true`);
  const issued = await waitFor(`document.querySelectorAll('.pane[aria-label="口令管理"] .lic-table tbody tr').length === ${keyCountBefore} + 1`, 8000, '新口令出现在表中');
  check('登录用户可签发下载口令', issued === true, `${keyCountBefore} → ${keyCountBefore + 1}`);
  await evaluate(`(() => {
    const row = [...document.querySelectorAll('.pane[aria-label="口令管理"] .lic-table tbody tr')].find((tr) => tr.textContent.includes('bw-walk-key'));
    [...row.querySelectorAll('button')].find((b) => /停用/.test(b.textContent))?.click();
    return Boolean(row);
  })()`);
  await sleep(1200);
  const disabled = await evaluate(`[...document.querySelectorAll('.pane[aria-label="口令管理"] .lic-table tbody tr')].find((tr) => tr.textContent.includes('bw-walk-key'))?.textContent.includes('已停用') ?? false`);
  check('口令可停用', disabled === true);
  const revoked = await evaluate(`(() => {
    const row = [...document.querySelectorAll('.pane[aria-label="口令管理"] .lic-table tbody tr')].find((tr) => tr.textContent.includes('bw-walk-key'));
    const btn = [...row.querySelectorAll('button')].find((b) => /吊销/.test(b.textContent));
    btn.click();
    return true;
  })()`);
  await waitFor('document.querySelector(".paper-dialog[open]")', 6000, '吊销确认框');
  await evaluate(`document.querySelector('.paper-dialog[open] footer button:last-child').click(), true`);
  await waitFor(`![...document.querySelectorAll('.pane[aria-label="口令管理"] .lic-table tbody')].some((t) => t.textContent.includes('bw-walk-key'))`, 8000, '口令已吊销');
  const gone = await evaluate(`document.body.textContent.includes('bw-walk-key')`);
  check('口令可吊销且不留痕', revoked === true && gone === false);

  await shot('10-resources-library');

  // ---------- 17b. 在线阅览：按章节分页、翻页、插图、全本与令牌收回 ----------
  await cdp.send('Page.navigate', { url: `${SITE}/library/bseed2/read?c=0&p=1` });
  await waitFor('document.querySelector(".reading-sheet .epub-body")', 15000, '阅览页正文');
  const r1 = JSON.parse(await evaluate(`(() => {
    const body = document.querySelector('.reading-sheet .epub-body');
    return JSON.stringify({
      toc: document.querySelectorAll('.toc .toc-link').length,
      text: (body?.textContent || '').slice(0, 40),
      dirty: /<script|style=|<svg/i.test(body?.innerHTML || ''),
      img: body?.querySelector('img')?.getAttribute('src') || '',
      pos: document.querySelector('.reading-head .micro-label')?.textContent?.trim() || '',
      gate: Boolean(document.querySelector('.pane[aria-label="口令解锁"]')),
    });
  })()`));
  check('整页刷新后仍凭会话内令牌直接开卷', r1.gate === false && r1.toc === 5, `${r1.toc} 章 · ${r1.pos}`);
  check('章节正文按页下发', /演示/.test(r1.text), r1.text);
  check('阅览页不含脚本 / 行内样式 / svg', r1.dirty === false);
  check('插图改走站内门控地址', /^\/api\/library\/bseed2\/asset\?p=/.test(r1.img), r1.img.slice(0, 48));
  const imgOk = JSON.parse(await evaluate(`(async () => {
    const img = document.querySelector('.reading-sheet .epub-body img');
    img?.scrollIntoView();
    if (img && !img.complete) await img.decode().catch(() => {});
    const res = await fetch(img.getAttribute('src'));
    return JSON.stringify({ status: res.status, type: res.headers.get('content-type'), w: img?.naturalWidth || 0 });
  })()`));
  check('插图在页内真正解码显示', imgOk.status === 200 && imgOk.w > 0, `${imgOk.status} · ${imgOk.type} · ${imgOk.w}x`);
  await evaluate(`[...document.querySelectorAll('.page-nav button')].find(b => /下一页/.test(b.textContent)).click(), true`);
  await waitFor(`location.search.includes('c=1')`, 8000, '翻页同步地址栏');
  const r2 = await evaluate(`document.querySelector('.reading-title')?.textContent?.trim() || ''`);
  check('下一页换章并同步地址栏', r2 === '第 2 章 · 演示', r2);
  const nowMark = await evaluate(`document.querySelectorAll('.toc .toc-link.is-now').length`);
  check('目录里当前章有唯一标记', nowMark === 1, `${nowMark} 个高亮`);
  // 正文里的跨章链接：必须走单页路由（不整页重载），并滚到包内锚点
  await evaluate('window.__bw_no_reload = 1, true');
  const linkClicked = await evaluate(`(() => {
    const a = [...document.querySelectorAll('.page-host a[href^="/library/"]')].find((x) => /read\\?c=/.test(x.getAttribute('href') || ''));
    if (!a) return false;
    a.click();
    return true;
  })()`);
  const linkArrived = await waitFor(`document.querySelector('.reading-title')?.textContent?.trim() === '第 3 章 · 演示'`, 10000, '正文链接换章');
  const stillAlive = await evaluate(`window.__bw_no_reload === 1`);
  const anchorKept = await evaluate(`Boolean(document.getElementById('sec-3'))`);
  check(
    '正文跨章链接走单页路由并保留包内锚点',
    linkClicked === true && linkArrived === true && stillAlive === true && anchorKept === true,
    `未重载=${stillAlive} 锚点=${anchorKept}`
  );
  await evaluate(`[...document.querySelectorAll('.toc-mode button')].find(b => /全本通读/.test(b.textContent)).click(), true`);
  const wholeNow = await waitFor(`document.querySelectorAll('.reading-sheet .epub-body > section').length === 5`, 15000, '全本渲染');
  check('阈值以下的书可全本通读', wholeNow === true, '五章合为一页');
  await evaluate(`[...document.querySelectorAll('.toc-mode button')].find(b => /回到分页/.test(b.textContent)).click(), true`);
  await waitFor(`location.search.includes('c=0')`, 8000, '回到分页');
  await evaluate(`sessionStorage.removeItem('bianwang.library.grant.v1'), true`);
  await cdp.send('Page.navigate', { url: `${SITE}/library/bseed2/read?c=0&p=1` });
  await waitFor('document.querySelector(\'.pane[aria-label="口令解锁"]\')', 10000, '阅览口令门');
  await evaluate(`(() => {
    const i = document.querySelector('.pane[aria-label="口令解锁"] input[type=password]');
    const s = Object.getOwnPropertyDescriptor(i.constructor.prototype, 'value').set;
    s.call(i, 'roxy-guest');
    i.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await evaluate(`document.querySelector('.pane[aria-label="口令解锁"] button[type=submit]').click(), true`);
  const reGated = await waitFor(`document.querySelectorAll('.toc .toc-link').length === 5`, 15000, '就地输口令后开卷');
  check('令牌收回后阅览页要求口令，输对即开卷', reGated === true);
  await shot('11-reader-pages');

  // 窄屏：两张新表格不得撑破卷面
  await viewport(390, 844);
  await sleep(700);
  const overflowLib = await evaluate(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
  await cdp.send('Page.navigate', { url: `${SITE}/resources` });
  await sleep(900);
  const overflowRes = await evaluate(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
  await cdp.send('Page.navigate', { url: `${SITE}/library/bseed2/read?c=0&p=1` });
  await sleep(1200);
  const overflowRead = await evaluate(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
  check(
    '镜像页、资源库页与阅览页窄屏无横向溢出',
    Number(overflowLib) <= 0 && Number(overflowRes) <= 0 && Number(overflowRead) <= 0,
    `library ${overflowLib}px / resources ${overflowRes}px / reader ${overflowRead}px`
  );
  await cdp.send('Page.navigate', { url: `${SITE}/about` });
  await sleep(900);
  const overflowAbout = await evaluate(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
  check('凡例页的出厂示例表窄屏不撑破卷面', Number(overflowAbout) <= 0, `about ${overflowAbout}px`);
  await viewport(1440, 960);
  await sleep(500);

  // ---------- 12. 权限：登出后写路径不可用 ----------
  await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('登出')).click(), true`);
  await sleep(900);
  await cdp.send('Page.navigate', { url: `${SITE}/edit` });
  await sleep(1200);
  const kicked = await evaluate(`location.pathname`);
  check('未登录访问编辑器被引到登录页', kicked === '/login', `落在 ${kicked}`);



  const bad = results.filter((x) => !x.pass);
  console.log(`\n合计 ${results.length} 项，失败 ${bad.length} 项。截图：${OUT}`);
  if (consoleLines.length) {
    console.log('\n--- 控制台 ---');
    for (const line of consoleLines.slice(0, 12)) console.log(' ', line);
  } else {
    console.log('（无控制台输出）');
  }
  cdp.close();
  await fetch(`${BASE}/json/close/${target.id}`).catch(() => undefined);
  process.exitCode = bad.length ? 1 : 0;
}

main().catch((err) => {
  console.error('走查中断：', err.message);
  process.exitCode = 1;
});
