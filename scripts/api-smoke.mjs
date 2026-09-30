#!/usr/bin/env node
/**
 * 端到端接口自检：不依赖浏览器，直接打后端。
 * 用法：先 `pnpm start`（或 dev:server），再 `node scripts/api-smoke.mjs`
 */
import { MODULE_IDS } from '../web/src/modules/registry.js';

const BASE = process.env.BW_SMOKE_BASE || 'http://127.0.0.1:8787';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/129 Safari/537.36';

let cookie = '';
let csrf = '';
const results = [];

async function call(method, path, { body, json = true, headers = {}, raw = false, noCsrf = false, form = false } = {}) {
  const h = { 'User-Agent': UA, ...headers };
  if (cookie) h.Cookie = cookie;
  if (csrf && method !== 'GET' && !noCsrf) h['x-bw-csrf'] = csrf;
  let payload;
  if (form) payload = body;
  else if (raw) payload = body;
  else if (body !== undefined) {
    h['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${path}`, { method, headers: h, body: payload, redirect: 'manual' });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json() : (json ? null : await res.text());
  return { status: res.status, data };
}

function check(name, pass, detail = '') {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

const run = async () => {
  const health = await call('GET', '/api/health');
  check('服务健康', health.status === 200);

  const list = await call('GET', '/api/posts?page=1&size=5');
  check('游客可读列表', list.status === 200 && list.data.items.length > 0, `${list.data?.total} 条`);
  const first = list.data.items[0];
  check('列表含标题与谣言两主体', Boolean(first?.title && first?.excerpt));
  check('封面为签名短时效链接', /sig=.*exp=|exp=.*sig=/.test(first?.cover || ''));

  const pinnedOnly = list.data.items.filter((item) => item.pinned);
  check('同一时间至多一个置顶', pinnedOnly.length <= 1, `置顶 ${pinnedOnly.length} 条`);

  const zh = await call('GET', `/api/search?q=${encodeURIComponent('路由器辐射')}`);
  check('中文检索命中', zh.status === 200 && zh.data.items.length > 0, `命中 ${zh.data?.items?.length} 条`);
  const fuzzy = await call('GET', `/api/search?q=${encodeURIComponent('微泼炉')}`);
  check('错字模糊检索有结果或明确空', fuzzy.status === 200, `命中 ${fuzzy.data?.items?.length} 条`);

  const tags = await call('GET', '/api/tags?limit=5');
  check('话题标签可读', tags.status === 200 && tags.data.items.length > 0);

  const deep = await call('GET', '/api/posts?page=25');
  check('游客深翻页被拒（反批量抓取）', deep.status === 403);

  const noAuth = await call('POST', '/api/posts', { body: { title: 'x' } });
  check('未登录写入被拒', noAuth.status === 401);

  const badLogin = await call('POST', '/api/auth/login', {
    body: { username: 'admin', password: 'wrong-password' },
  });
  check('错误口令被拒', badLogin.status === 401);

  const login = await call('POST', '/api/auth/login', {
    body: { username: 'admin', password: 'admin' },
  });
  check('默认账号登录成功', login.status === 200 && Boolean(login.data.csrfToken));
  csrf = login.data.csrfToken || '';

  const noCsrf = await call('POST', '/api/posts', { body: { title: 'x' }, noCsrf: true });
  check('缺少 CSRF 令牌的写操作被拒', noCsrf.status === 403);

  const created = await call('POST', '/api/posts', {
    body: {
      title: '自检样例：隔夜茶会致癌吗',
      tags: ['自检', '饮茶'],
      rumor: { html: '<p>网传' + '<span class="anno anno-circle c-seal">隔夜茶含大量亚硝酸盐致癌</span>。</p>' },
      verdict: { html: '<p>实测增量远低于限值，' + '<span class="anno anno-line c-seal">关键在于存放是否敞口</span>。</p>' },
      sources: [{ title: '自检材料', org: '示例机构', collectedAt: new Date().toISOString() }],
      annotations: {},
      meta: { editor: '自检', level: '低', reviewAt: '2099-01-01' },
    },
  });
  check('登录后可建档', created.status === 201, created.data?.post?.id || created.data?.message);
  const newId = created.data?.post?.id;

  const dirty = await call('POST', '/api/posts', {
    body: {
      title: '注入样例',
      tags: ['自检'],
      rumor: { html: '<p onclick="alert(1)">x</p><script>alert(2)<\/script><a href="javascript:alert(3)">y</a>' },
      verdict: { html: '<p>ok</p>' },
    },
  });
  const dirtyHtml = dirty.data?.post?.rumor?.html || '';
  check(
    '服务端净化危险标签与属性',
    dirty.status === 201 && !/<script|onclick\s*=|javascript:/i.test(dirtyHtml),
    dirtyHtml.slice(0, 70)
  );
  if (dirty.data?.post?.id) await call('DELETE', `/api/posts/${dirty.data.post.id}`);

  const pin = await call('POST', `/api/posts/${newId}/pin`, { body: { pinned: true } });
  check('置顶可转移', pin.status === 200 && pin.data.pinned === true && pin.data.title.startsWith('自检样例'), `原置顶解除：${pin.data.released || '无'}`);
  const afterPin = await call('GET', '/api/posts?page=1&size=20');
  const beforePinIds = (await call('GET', '/api/posts?page=1&size=20')).data.items.filter((i) => i.pinned).map((i) => i.id);
  const pins = afterPin.data.items.filter((item) => item.pinned);
  check('转移置顶后原置顶自动解除', pins.length === 1, `仍置顶 ${pins.length} 条`);

  const originalOrder = afterPin.data.items.map((item) => item.id);
  const order = await call('PUT', '/api/order', { body: { ids: [...originalOrder].reverse() } });
  check('批量重排序可保存', order.status === 200 && order.data.items.length > 0);
  const restored = await call('PUT', '/api/order', { body: { ids: originalOrder } });
  check('重排序可还原（自检不留副作用）', restored.status === 200);

  const bigForm = new FormData();
  bigForm.append('file', new Blob([new Uint8Array(6 * 1024 * 1024)], { type: 'image/png' }), 'big.png');
  const upBig = await call('POST', '/api/media', { body: bigForm, form: true });
  check('超出 5MB 的上传被拒', upBig.status === 413 || upBig.status === 400, `HTTP ${upBig.status}`);

  const fakeForm = new FormData();
  fakeForm.append('file', new Blob(['<?php echo 1; ?>'], { type: 'image/png' }), 'shell.png');
  const upFake = await call('POST', '/api/media', { body: fakeForm, form: true });
  check('伪装 Content-Type 的非图片被拒', upFake.status === 415 || upFake.status === 400, `HTTP ${upFake.status}`);

  const goodForm = new FormData();
  const pngBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]);
  goodForm.append('file', new Blob([pngBytes], { type: 'image/png' }), 'ok.png');
  const upGood = await call('POST', '/api/media', { body: goodForm, form: true });
  check('合法图片头可上传', upGood.status === 201, upGood.data?.id || upGood.data?.message);
  if (upGood.data?.id) await call('GET', upGood.data.url);

  const menu = await call('PUT', '/api/menu', {
    body: { items: [{ moduleId: 'home', visible: true }, { moduleId: 'users', visible: false }], known: ['home', 'users'] },
  });
  check('菜单编辑可保存', menu.status === 200 && menu.data.items.length === 2);
  // 还原必须按注册表全量：写死一份短清单会把后加的功能（资源库、镜像站、馆务台账）从菜单里抹掉
  await call('PUT', '/api/menu', {
    body: {
      items: MODULE_IDS.map((moduleId, order2) => ({ moduleId, visible: true, order: order2 })),
      known: MODULE_IDS,
    },
  });

  // —— 版本台账（#32）：建档即有 v1，修订后有 v2，可按字段与字词比对 ——
  const revFirst = await call('GET', `/api/posts/${newId}/revisions`);
  check(
    '建档即写入首版快照（含动作与修订者）',
    revFirst.status === 200 &&
      revFirst.data.items.length === 1 &&
      revFirst.data.items[0].kind === 'create' &&
      revFirst.data.items[0].by === '档案管理员',
    `${revFirst.data?.items?.length} 版 / ${revFirst.data?.items?.[0]?.by}`
  );
  const revised = await call('PUT', `/api/posts/${newId}`, {
    body: {
      title: '自检样例：隔夜茶会致癌吗（第二版）',
      tags: ['自检', '饮茶'],
      rumor: { html: '<p>网传的说法来自一条拼接短视频。</p>' },
      verdict: { html: '<p>实测增量远低于限值，关键在于存放是否敞口与是否加盖。</p>' },
      sources: [{ title: '自检材料', org: '示例机构' }],
      meta: { editor: '自检', level: '中', reviewAt: '2099-01-01' },
    },
  });
  const revSecond = await call('GET', `/api/posts/${newId}/revisions`);
  const pairIds = (revSecond.data?.items || []).map((row) => row.id);
  check(
    '修订后版本数 +1 且默认 pair 指向最近两版',
    revised.status === 200 && revSecond.data?.items?.length === 2 && revSecond.data.pair.from === pairIds[0] && revSecond.data.pair.to === pairIds[1],
    `${revSecond.data?.items?.length} 版`
  );
  const diffPair = await call('GET', `/api/posts/${newId}/revisions/diff?from=${pairIds[0]}&to=${pairIds[1]}`);
  const rumorField = (diffPair.data?.fields || []).find((row) => row.key === 'rumor');
  check(
    '两版比对给出逐字段差异（标题、正文、危害等级都在列）',
    diffPair.status === 200 &&
      ['title', 'rumor', 'level'].every((key) => diffPair.data.fields.some((row) => row.key === key)),
    `${diffPair.data?.fields?.length} 处差异`
  );
  check(
    '正文差异按字/词标注增删（不是只给新旧两段）',
    (rumorField?.segments || []).some((seg) => seg.op === 'del') && (rumorField?.segments || []).some((seg) => seg.op === 'add'),
    JSON.stringify((rumorField?.segments || []).slice(0, 4))
  );
  const revDemo = await call('GET', `/api/posts/${first.id}/revisions`);
  const revDemoRaw = JSON.stringify(revDemo.data);
  check(
    '版本接口只回表头：不给快照正文、不给签名串（落盘口径由全量体检验）',
    revDemo.status === 200 && !/\/api\/media\/|snapshot|exp=|sig=/.test(revDemoRaw),
    `${revDemo.data?.items?.length} 版 · ${revDemoRaw.length}B`
  );
  const crossDiff = await call('GET', `/api/posts/${newId}/revisions/diff?from=${pairIds[0]}&to=rseed1`);
  check('别的档案的版本 id 不能拿来比对（404）', crossDiff.status === 404, String(crossDiff.data?.error));

  // —— 馆务台账（#30 / #31）：只读对账 + 日志聚合，清理走全量体检的隔离实例 ——
  const mediaReport = await call('GET', '/api/ops/media-report');
  check(
    '登录后可读媒体台账，三方对账口径齐备',
    mediaReport.status === 200 && ['used', 'unreferenced', 'orphanFiles', 'staleIndex', 'reclaimableBytes'].every((key) => Number.isFinite(mediaReport.data.totals[key])),
    `索引 ${mediaReport.data?.totals?.indexRecords} / 磁盘 ${mediaReport.data?.totals?.diskFiles} / 孤儿 ${mediaReport.data?.totals?.orphanFiles}`
  );
  const dryRun = await call('POST', '/api/ops/media-gc', {
    body: { ids: mediaReport.data?.unreferenced?.slice(0, 1).map((row) => row.id) || [], files: [], confirm: false },
  });
  check(
    '清理默认是预演：confirm 不为 true 就一个字节都不动',
    dryRun.status === 200 && dryRun.data.dryRun === true && dryRun.data.removed.indexRecords.length === 0,
    `预演将删 ${dryRun.data?.plan?.indexRecords?.length} 条 / 被拒 ${dryRun.data?.skipped?.length} 项`
  );
  const logAll = await call('GET', '/api/ops/security-log?limit=5');
  const csrfSignal = (logAll.data?.signals || []).find((row) => row.key === 'csrf-denied');
  check(
    '安全日志聚合把本轮缺 CSRF 的写操作记成 csrf-denied',
    logAll.status === 200 && Number(csrfSignal?.count) >= 1,
    `csrf-denied=${csrfSignal?.count} · 共 ${logAll.data?.totals?.entries} 条`
  );
  check(
    '聚合给出事件 / 来源 / 按日三种口径',
    logAll.data?.byEvent?.length > 0 && logAll.data?.byIp?.length > 0 && logAll.data?.byDay?.length > 0,
    `${logAll.data?.byEvent?.length} 类事件 / ${logAll.data?.byIp?.length} 个来源`
  );
  const logFiltered = await call('GET', '/api/ops/security-log?event=csrf-denied&limit=2');
  check(
    '按事件筛选只回到该类事件并遵守条数上限',
    logFiltered.status === 200 &&
      logFiltered.data.recent.length > 0 &&
      logFiltered.data.recent.length <= 2 &&
      logFiltered.data.recent.every((row) => row.event === 'csrf-denied'),
    `${logFiltered.data?.recent?.length} 条 / 命中 ${logFiltered.data?.totals?.matched}`
  );

  // —— 版本台账总表（#39）：全站口径，只回表头不回快照 ——
  const ledgerAll = await call('GET', '/api/ops/revisions?limit=50');
  const ledgerRaw = JSON.stringify(ledgerAll.data ?? null);
  check(
    '登录后可读全站版本台账，口径齐备（版本数/涉及档案/快照字节/每档保留/已撤档）',
    ledgerAll.status === 200 &&
      Number.isFinite(ledgerAll.data?.totals?.entries) &&
      Number.isFinite(ledgerAll.data?.totals?.posts) &&
      Number.isFinite(ledgerAll.data?.totals?.bytes) &&
      Number.isFinite(ledgerAll.data?.totals?.keep) &&
      Number.isFinite(ledgerAll.data?.totals?.orphanPosts) &&
      Array.isArray(ledgerAll.data?.items) &&
      Array.isArray(ledgerAll.data?.posts),
    `${ledgerAll.data?.totals?.entries} 版 / ${ledgerAll.data?.totals?.posts} 档 / ${ledgerAll.data?.totals?.bytes}B / 撤档 ${ledgerAll.data?.totals?.orphanPosts}`
  );
  check(
    '台账流水行只给表头，不外泄快照正文或签名串',
    ledgerAll.status === 200 &&
      !/snapshot|\/api\/media\/|exp=|sig=/.test(ledgerRaw) &&
      (ledgerAll.data.items.length === 0 ||
        ledgerAll.data.items.every((row) => 'id' in row && 'version' in row && 'kind' in row && 'postId' in row && 'alive' in row && 'bytes' in row)),
    `${ledgerAll.data?.items?.length} 行 · ${ledgerRaw.length}B`
  );
  const ledgerCreate = await call('GET', '/api/ops/revisions?kind=create&limit=50');
  check(
    '按动作筛选只回建档版本（筛选落到查询上）',
    ledgerCreate.status === 200 &&
      ledgerCreate.data.items.every((row) => row.kind === 'create'),
    `建档 ${ledgerCreate.data?.items?.length} 行 / 命中 ${ledgerCreate.data?.totals?.matched}`
  );
  const anyPostId = ledgerAll.data?.items?.[0]?.postId || '';
  if (anyPostId) {
    const ledgerByPost = await call('GET', `/api/ops/revisions?post=${encodeURIComponent(anyPostId)}&limit=50`);
    check(
      '按档案筛选只回该档的版本',
      ledgerByPost.status === 200 &&
        ledgerByPost.data.items.length > 0 &&
        ledgerByPost.data.items.every((row) => row.postId === anyPostId),
      `${anyPostId} · ${ledgerByPost.data?.items?.length} 行`
    );
  }

  const users = await call('GET', '/api/users');
  check('登录后可读用户名册', users.status === 200 && users.data.items.some((u) => u.username === 'admin'));
  check(
    '口令默认不随接口外泄',
    users.status === 200 && users.data.items.every((u) => u.password === ''),
    `存储形态 ${users.data.storage}`
  );

  if (newId) {
    const del = await call('DELETE', `/api/posts/${newId}`);
    check('登录后可删除档案', del.status === 200);
  }

  const botUa = await fetch(`${BASE}/api/posts`, { headers: { 'User-Agent': 'python-requests/2.31' } });
  check('脚本 UA 无会话时被拒', botUa.status === 403);
  const emptyUa = await fetch(`${BASE}/api/posts`, { headers: { 'User-Agent': '' } });
  check('空 UA 被拒', emptyUa.status === 403);

  const expired = await call('GET', `/api/media/${first?.cover?.match(/media\/([^?]+)/)?.[1]}?exp=1&sig=bad`);
  check('过期或伪造签名的图片链接被拒', expired.status === 403);

  const logout = await call('POST', '/api/auth/logout');
  check('登出成功', logout.status === 200);
  const afterLogout = await call('GET', '/api/auth/me');
  check('登出后会话失效', afterLogout.data.user === null);
  const opsAnon = await call('GET', '/api/ops/media-report');
  const logAnon = await call('GET', '/api/ops/security-log');
  const ledgerAnon = await call('GET', '/api/ops/revisions');
  check(
    '登出后媒体台账、安全日志与版本台账总表都回到需登录',
    opsAnon.status === 401 && logAnon.status === 401 && ledgerAnon.status === 401,
    `${opsAnon.status} / ${logAnon.status} / ${ledgerAnon.status}`
  );

  for (const id of beforePinIds) await call('POST', `/api/posts/${id}/pin`, { pinned: true });
  const menuRestore = await call('GET', '/api/menu');
  check(
    '菜单还原后与注册表条目数一致',
    menuRestore.status === 200 && menuRestore.data.items.length === MODULE_IDS.length,
    `${menuRestore.data?.items?.length} 项 / 注册表 ${MODULE_IDS.length} 项`
  );
  await call('PUT', '/api/menu', {
    body: {
      items: MODULE_IDS.map((moduleId, index) => ({ moduleId, visible: true, order: index })),
      known: MODULE_IDS,
    },
  });

  const failed = results.filter((r) => !r.pass);
  console.log(`\n合计 ${results.length} 项，失败 ${failed.length} 项。`);
  process.exit(failed.length ? 1 : 0);
};

run().catch((err) => {
  console.error('自检中断：', err);
  process.exit(1);
});
