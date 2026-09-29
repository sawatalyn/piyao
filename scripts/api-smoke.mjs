#!/usr/bin/env node
/**
 * 端到端接口自检：不依赖浏览器，直接打后端。
 * 用法：先 `pnpm start`（或 dev:server），再 `node scripts/api-smoke.mjs`
 */
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
  await call('PUT', '/api/menu', {
    body: {
      items: ['home', 'search', 'tags', 'submit', 'reorder', 'menu-editor', 'users', 'about'].map((moduleId, order2) => ({
        moduleId,
        visible: true,
        order: order2,
      })),
      known: ['home', 'search', 'tags', 'submit', 'reorder', 'menu-editor', 'users', 'about'],
    },
  });

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

  for (const id of beforePinIds) await call('POST', `/api/posts/${id}/pin`, { pinned: true });
  const menuRestore = await call('GET', '/api/menu');
  if (menuRestore.data?.items?.length !== 8) {
    await call('PUT', '/api/menu', {
      body: {
        items: ['home', 'search', 'tags', 'submit', 'reorder', 'menu-editor', 'users', 'about'].map((moduleId, index) => ({ moduleId, visible: true, order: index })),
        known: ['home', 'search', 'tags', 'submit', 'reorder', 'menu-editor', 'users', 'about'],
      },
    });
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n合计 ${results.length} 项，失败 ${failed.length} 项。`);
  process.exit(failed.length ? 1 : 0);
};

run().catch((err) => {
  console.error('自检中断：', err);
  process.exit(1);
});
