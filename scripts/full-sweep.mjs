#!/usr/bin/env node
/**
 * 全量接口体检：真实启动隔离实例，覆盖接口、失败分支、生产响应头、
 * 哈希口令模式、登录锁定与反爬。
 *
 * 用法：node scripts/full-sweep.mjs
 * 不碰 8787 与 server/data：每个实例的数据目录是 .scratch-verify/sweep-<名>/，跑完删除。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { encodePng } from '../server/scripts/png.js';
import { demoEpub, multiChapterEpub } from '../server/scripts/epub.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SWEEP = path.join(ROOT, '.scratch-verify');
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const results = [];
const created = [];
const running = [];
let base = '';
let inst = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 后端落盘是排队异步的：读盘断言前先等这次写入真的到了盘上 */
async function waitForFile(file, test, ms = 5000) {
  const start = Date.now();
  let content = '';
  while (Date.now() - start < ms) {
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch {
      content = '';
    }
    if (test(content)) return content;
    await sleep(80);
  }
  return content;
}

function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

async function boot(name, env = {}) {
  const data = path.join(SWEEP, `sweep-${name}`);
  fs.rmSync(data, { recursive: true, force: true });
  fs.mkdirSync(data, { recursive: true });
  created.push(data);
  const port = 8810 + created.length;
  execFileSync(process.execPath, [path.join(ROOT, 'server/scripts/reseed.js')], {
    env: { ...process.env, BW_DATA_DIR: data },
    stdio: 'ignore',
  });
  const child = spawn(process.execPath, [path.join(ROOT, 'server/src/index.js')], {
    cwd: ROOT,
    stdio: 'ignore',
    env: { ...process.env, BW_PORT: String(port), BW_HOST: '127.0.0.1', BW_DATA_DIR: data, BW_SECRET: `sweep-${name}`, ...env },
  });
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80; i += 1) {
    try {
      const r = await fetch(`${url}/api/health`, { headers: { 'user-agent': UA } });
      if (r.ok) break;
    } catch {
      /* 尚未监听 */
    }
    if (child.exitCode !== null) throw new Error(`实例 ${name} 启动即退出，码 ${child.exitCode}`);
    await sleep(120);
  }
  const record = { name, port, url, data, child, cookie: '', csrf: '' };
  running.push(record);
  console.log(`\n—— 实例 ${name}：${url} · 数据 ${path.relative(ROOT, data)} ——`);
  return record;
}

/** 统一请求：自动带 UA、会话 cookie 与 CSRF 头 */
async function call(method, p, options = {}) {
  const {
    body,
    json = true,
    cookie = 'keep',
    csrf = true,
    standalone = false,
    headers = {},
    absolute = null,
    formData,
  } = options;
  const target = absolute ?? `${base}${p}`;
  const init = { method, headers: { 'user-agent': UA, ...headers } };
  // 调用方自带 Cookie 头时以它为准（要测"某个具体会话"就不能被实例会话覆盖或删掉）
  const gaveCookie = Object.keys(init.headers).some((k) => k.toLowerCase() === 'cookie');
  if (cookie === 'keep' && inst?.cookie && !standalone && !gaveCookie) init.headers.cookie = inst.cookie;
  if ((cookie === 'none' || standalone) && !gaveCookie) delete init.headers.cookie;
  // 调用方显式给了令牌就用它的（要测"令牌不匹配"就不能被覆盖）
  const gaveToken = Object.keys(init.headers).some((k) => k.toLowerCase() === 'x-bw-csrf');
  if (csrf && inst?.csrf && !gaveToken && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    init.headers['x-bw-csrf'] = inst.csrf;
  }
  if (formData) init.body = formData;
  else if (body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  const res = await fetch(target, init);
  for (const c of typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : []) {
    const pair = c.split(';')[0];
    if (pair.startsWith('bw_sid=') && inst && !standalone && !gaveCookie) {
      inst.cookie = /bw_sid=;|bw_sid=$/.test(pair) ? '' : pair;
    }
  }
  const text = await res.text();
  let parsed = null;
  try {
    parsed = json === false ? text : JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed, headers: res.headers, raw: text };
}

async function login(username = 'admin', password = 'admin', extra = {}) {
  const r = await call('POST', '/api/auth/login', {
    body: { username, password, ...extra },
    cookie: 'none',
    csrf: false,
  });
  if (r.status === 200 && r.body?.csrfToken) inst.csrf = r.body.csrfToken;
  return r;
}

function makePng(width = 24, height = 16) {
  return Buffer.from(encodePng(width, height, (x, y) => ((x + y) % 2 ? [23, 24, 23] : [246, 242, 232])));
}

async function upload(bytes, filename = '证据.png') {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: 'image/png' }), filename);
  return call('POST', '/api/media', { body: undefined, formData: form });
}

const POST_BODY = (over = {}) => ({
  title: '体检档案：某食品添加物会导致某病',
  tags: ['体检话题', '食品安全'],
  rumor: {
    html: '<p>网传该添加物致病，样本量仅 <span class="anno anno-circle c-seal">7 例</span>。</p>',
    source: { platform: '短视频', url: '', seenAt: '' },
  },
  verdict: { html: '<p>对照试验未复现，判定为不实。</p>', rating: '不实' },
  sources: [{ id: 's1', title: '某机构对照试验记录', url: 'https://example.org/a', mediaId: '', org: '', collectedAt: '', note: '' }],
  annotations: {},
  meta: { editor: '体检', level: '低', reviewAt: '2099-01-01' },
  ...over,
});

async function sectionCore() {
  inst = await boot('core');
  base = inst.url;

  const health = await call('GET', '/api/health');
  check('健康检查可用', health.status === 200 && health.body.ok === true);

  const robots = await call('GET', '/robots.txt', { json: false });
  check('robots.txt 挡住接口与后台路径', robots.status === 200 && /Disallow: \/api\//.test(robots.body) && /Disallow: \/login/.test(robots.body));

  const missing = await call('GET', '/api/no-such-route');
  check('未知接口回落为 JSON 404', missing.status === 404 && missing.body.error === 'no-route');

  const emptyUa = await call('GET', '/api/posts', { headers: { 'user-agent': '' } });
  check('空 UA 被拒', emptyUa.status === 403, String(emptyUa.body?.error));
  const botUa = await call('GET', '/api/posts', { headers: { 'user-agent': 'python-requests/2.31.0' } });
  check('抓取库 UA 被拒', botUa.status === 403, String(botUa.body?.error));

  const deep = await call('GET', '/api/posts?page=21', { cookie: 'none' });
  check('游客深翻页被拒（防批量抓取）', deep.status === 403, String(deep.body?.error));
  const clamped = await call('GET', '/api/posts?size=999', { cookie: 'none' });
  check('分页尺寸被钳制到上限', clamped.status === 200 && clamped.body.items.length <= 48, `${clamped.body.items?.length} 条`);

  const anonWrite = await call('POST', '/api/posts', { body: POST_BODY(), cookie: 'none', csrf: false });
  check('未登录建档被拒', anonWrite.status === 401);

  const trap = await call('POST', '/api/auth/login', {
    body: { username: 'admin', password: 'admin', company_website: 'http://spam.example' },
    cookie: 'none',
    csrf: false,
  });
  check('蜜罐字段命中即拒且不给线索', trap.status === 401 && !/locked|频繁/.test(JSON.stringify(trap.body)), JSON.stringify(trap.body).slice(0, 50));

  const ok = await login();
  check('默认账号登录并取得令牌', ok.status === 200 && Boolean(ok.body.csrfToken));
  const setCookie = ok.headers.get('set-cookie') || '';
  check('会话 Cookie 带 HttpOnly 与 SameSite', /HttpOnly/.test(setCookie) && /SameSite=Strict/.test(setCookie));

  // 已登录时再点一次登录（带着旧会话 cookie）：登录接口本应豁免 CSRF
  const relogin = await call('POST', '/api/auth/login', { body: { username: 'admin', password: 'admin' }, csrf: false });
  check('已登录状态下重新登录不被 CSRF 拦住', relogin.status === 200, String(relogin.body?.error));
  if (relogin.status === 200) inst.csrf = relogin.body.csrfToken;

  const noCsrf = await call('POST', '/api/posts', { body: POST_BODY(), csrf: false });
  check('缺 CSRF 的写操作被拒', noCsrf.status === 403, String(noCsrf.body?.error));
  const badCsrf = await call('POST', '/api/posts', { body: POST_BODY(), csrf: true, headers: { 'x-bw-csrf': 'wrong' } });
  check('CSRF 令牌不匹配被拒', badCsrf.status === 403);

  const roster = await call('GET', '/api/users');
  const leaked = /"password"\s*:\s*"admin"/.test(JSON.stringify(roster.body));
  check('名册不回显口令列', roster.status === 200 && !leaked, `存储形态 ${roster.body.storage}`);

  const added = await call('POST', '/api/users', {
    body: { username: 'reviewer', password: 'Passw0rd!8', role: 'editor', displayName: '体检员' },
  });
  check('可新增登录用户', added.status === 200 && added.body.items.some((u) => u.username === 'reviewer'));
  const csv = fs.readFileSync(path.join(inst.data, 'users.csv'), 'utf8');
  check('新用户确实写入 CSV', /reviewer/.test(csv));

  const reviewer = await call('POST', '/api/auth/login', {
    body: { username: 'reviewer', password: 'Passw0rd!8' },
    standalone: true,
    csrf: false,
  });
  const reviewerCookie = (reviewer.headers.get('set-cookie') || '').split(';')[0];
  check('新用户可用明文口令登录', reviewer.status === 200 && reviewerCookie.startsWith('bw_sid='));

  const delAdmin = await call('DELETE', '/api/users/admin');
  check('默认 admin 不可被删除', delAdmin.status === 400, String(delAdmin.body?.message || delAdmin.body?.error));

  const delReviewer = await call('DELETE', '/api/users/reviewer');
  check('可删除用户', delReviewer.status === 200 && !delReviewer.body.items.some((u) => u.username === 'reviewer'));
  const orphan = await call('GET', '/api/auth/me', { cookie: 'none', headers: { cookie: reviewerCookie } });
  check('被删用户的会话立即失效', orphan.status === 200 && orphan.body.user === null, JSON.stringify(orphan.body.user));

  const good = await upload(makePng());
  check('合法 PNG 可上传', good.status === 201 && Boolean(good.body.id), good.body.id);
  const goodId = good.body.id;

  const fake = await upload(Buffer.from('<html>不是图片</html>'), '伪装.png');
  check('伪装图片被魔数拦下', fake.status === 415, String(fake.body?.error));
  const huge = await upload(Buffer.concat([makePng(4, 4), Buffer.alloc(6 * 1024 * 1024, 7)]), '超大.png');
  check('超过 5MB 的图片被拒', huge.status === 413, String(huge.body?.message || huge.body?.error));

  const fat = await call('POST', '/api/posts', { body: { title: 'x'.repeat(700 * 1024) } });
  check('超大请求体返回 413 而非 500', fat.status === 413, String(fat.body?.error));

  const emptyTitle = await call('POST', '/api/posts', { body: POST_BODY({ title: '   ' }) });
  check('空标题被拒', emptyTitle.status === 400);
  const longTitle = await call('POST', '/api/posts', { body: POST_BODY({ title: '长'.repeat(121) }) });
  check('超长标题被拒', longTitle.status === 400, String(longTitle.body?.message));
  const emptyRumor = await call('POST', '/api/posts', { body: POST_BODY({ rumor: { html: '<p>   </p>' } }) });
  check('谣言正文空被拒', emptyRumor.status === 400);
  const emptyVerdict = await call('POST', '/api/posts', { body: POST_BODY({ verdict: { html: '<p></p>' } }) });
  check('辟谣内容空被拒', emptyVerdict.status === 400);
  const badScheme = await call('POST', '/api/posts', {
    body: POST_BODY({ sources: [{ id: 's9', title: 't', url: 'javascript:alert(1)', mediaId: '' }] }),
  });
  check('材料源非法协议被拒', badScheme.status === 400, String(badScheme.body?.message));

  // 正常浏览密度不得被接口限流误伤：40 次"整页加载"＝200 个请求
  let limited = 0;
  for (let i = 0; i < 40; i += 1) {
    for (const p of ['/api/bootstrap', '/api/menu', '/api/resources', '/api/library', '/api/posts?page=1&size=9']) {
      const r = await call('GET', p, { cookie: 'none', csrf: false });
      if (r.status === 429) limited += 1;
    }
  }
  check('正常浏览密度不误触接口限流', limited === 0, `${limited} 个 429 / 200 个请求`);

  return { goodId };
}

const REGISTRY_IDS = () => {
  const src = fs.readFileSync(path.join(ROOT, 'web/src/modules/registry.js'), 'utf8');
  return [...src.matchAll(/\n\s+id:\s*'([^']+)'/g)].map((m) => m[1]);
};

async function sectionDeep(goodId) {
  // 菜单种子必须与前端注册表可解析的 id 一致，否则首部署会出现"入口凭空消失"
  const seeded = await call('GET', '/api/menu');
  const registry = REGISTRY_IDS();
  const orphan = seeded.body.items.filter((i) => !registry.includes(i.moduleId));
  const absent = registry.filter((id) => !seeded.body.items.some((i) => i.moduleId === id));
  check('默认菜单 id 全部能被前端注册表解析', orphan.length === 0, orphan.map((i) => i.moduleId).join(','));
  check('注册表里的功能都在默认菜单中', absent.length === 0, absent.join(','));

  // 老装机的 menu.json 里没有后加的模块：读一次就得自动补到末尾，否则新功能的入口永远不出现
  const menuFile = path.join(inst.data, 'menu.json');
  const stale = JSON.parse(fs.readFileSync(menuFile, 'utf8'));
  const dropped = stale.items.filter((i) => i.moduleId !== 'library');
  fs.writeFileSync(menuFile, JSON.stringify({ version: 1, items: dropped }));
  const healed = await call('GET', '/api/menu');
  check(
    '缺项的旧菜单文件会被自动补齐且不破坏原有次序',
    healed.body.items.length === stale.items.length &&
      healed.body.items.some((i) => i.moduleId === 'library') &&
      healed.body.items.slice(0, dropped.length).every((i, k) => i.moduleId === dropped[k].moduleId),
    `${dropped.length} 项 → ${healed.body.items.length} 项`
  );

  const created = await call('POST', '/api/posts', {
    body: POST_BODY({
      rumor: { html: `<p>网传说法。<figure class="rich-fig"><img data-mid="${goodId}" src="/api/media/${goodId}" alt="证据图"></figure></p>` },
    }),
  });
  check('带插图的档案可建档', created.status === 201, created.body?.post?.id);
  const pid = created.body.post.id;

  const first = await call('GET', `/api/posts/${pid}`);
  const signedSrc = /src="([^"]*exp=[^"]*)"/.exec(first.body.post.rumor.html)?.[1] || '';
  check('读取时插图换成签名直链', signedSrc.includes('exp=') && signedSrc.includes('sig='), signedSrc.slice(0, 42));

  // 编辑器保存的是 DOM 原文，会把带签名的 src 原样 PUT 回来
  const roundTrip = await call('PUT', `/api/posts/${pid}`, {
    body: {
      ...created.body.post,
      title: '体检档案（已修订）：某食品添加物会导致某病',
      rumor: { ...first.body.post.rumor, html: first.body.post.rumor.html },
    },
  });
  // 落盘是异步的：先确认这次修订真的写到了盘上，再判库里有没有签名串
  const landed = await waitForFile(path.join(inst.data, 'posts.json'), (c) => c.includes('已修订'));
  check('修订（PUT）可成功保存并落盘', roundTrip.status === 200 && landed.includes('已修订'), String(roundTrip.body?.message || ''));
  check('签名串不会被写进档案库', !/exp=/.test(landed), `库里出现 exp= ${landed.split('exp=').length - 1} 处`);
  const second = await call('GET', `/api/posts/${pid}`);
  const renewed = /src="([^"]*exp=[^"]*)"/.exec(second.body.post.rumor.html)?.[1] || '';
  check('修订后仍能取到新鲜签名', renewed.includes('sig='), renewed.slice(0, 30));

  const notFound = await call('GET', '/api/posts/pnotexist');
  check('不存在的档案返回 404', notFound.status === 404);
  const putMissing = await call('PUT', '/api/posts/pnotexist', { body: POST_BODY() });
  check('修订不存在的档案返回 404', putMissing.status === 404);

  const list = await call('GET', '/api/posts?size=48');
  const unpinnedBefore = list.body.items.filter((p) => !p.pinned).map((p) => p.id);
  const reversed = [...unpinnedBefore].reverse();
  const ordered = await call('PUT', '/api/order', { body: { ids: reversed } });
  const after = await call('GET', '/api/posts?size=48');
  // 置顶档案恒浮在最前，次序断言只看非置顶那一段
  const unpinnedAfter = after.body.items.filter((p) => !p.pinned).map((p) => p.id);
  check(
    '重排序真实改变首页次序',
    ordered.status === 200 && unpinnedAfter.join() === reversed.join(),
    `${after.body.items.length} 条，段首 ${after.body.items[0]?.title?.slice(0, 12)}`
  );
  const badOrder = await call('PUT', '/api/order', { body: { ids: ['不存在的id' ] } });
  check('未知档案 id 的重排被拒', badOrder.status === 400);

  const titleOf = (id) => after.body.items.find((p) => p.id === id)?.title || '';
  const a = unpinnedAfter[unpinnedAfter.length - 1];
  const b = unpinnedAfter[unpinnedAfter.length - 2];
  const pinA = await call('POST', `/api/posts/${a}/pin`, { body: { pinned: true } });
  check('可置顶', pinA.status === 200 && pinA.body.pinned === true, titleOf(a).slice(0, 16));
  const pinB = await call('POST', `/api/posts/${b}/pin`, { body: { pinned: true } });
  check('置顶转移时自动解除原置顶', pinB.body.pinned === true && pinB.body.released === titleOf(a), `解除：${String(pinB.body.released).slice(0, 16)}`);
  const unpin = await call('POST', `/api/posts/${b}/pin`, { body: { pinned: false } });
  check('可取消置顶', unpin.status === 200 && unpin.body.pinned === false);
  const pinGhost = await call('POST', '/api/posts/pnotexist/pin', { body: { pinned: true } });
  check('置顶不存在的档案返回 404', pinGhost.status === 404);

  const menuBad = await call('PUT', '/api/menu', { body: { items: '不是数组', known: registry } });
  check('菜单非数组被拒', menuBad.status === 400);
  const menuEmpty = await call('PUT', '/api/menu', { body: { items: [], known: registry } });
  check('菜单清空到无一项被拒', menuEmpty.status === 400);
  const items = seeded.body.items.map((i) => ({ ...i, visible: i.moduleId === 'about' ? false : i.visible !== false }));
  const menuSave = await call('PUT', '/api/menu', { body: { items, known: registry } });
  check('菜单可保存并即时生效', menuSave.status === 200 && menuSave.body.items.find((i) => i.moduleId === 'about').visible === false);
  await call('PUT', '/api/menu', { body: { items: seeded.body.items, known: registry } });

  const search = await call('GET', '/api/search?q=' + encodeURIComponent('辐射'));
  check('中文单字/词可命中检索', search.body.items.length > 0, `${search.body.items.length} 条命中`);
  const tags = await call('GET', '/api/tags?q=' + encodeURIComponent('食'));
  check('话题前缀联想可用', tags.body.items.length > 0, tags.body.items.map((t) => t.name).slice(0, 3).join('/'));
  const tagClamp = await call('GET', '/api/tags?limit=9999');
  check('话题数量参数被钳制', tagClamp.body.items.length <= 200);

  const dirty = await call('POST', '/api/posts', {
    body: POST_BODY({ rumor: { html: '<p onclick="alert(1)">x</p><script>alert(2)</script><img src="x" onerror="alert(3)">' } }),
  });
  const clean = dirty.body?.post?.rumor?.html || '';
  check('危险标签与事件属性被净化', !/<script|onclick|onerror|javascript:/i.test(clean), clean.slice(0, 60));
  if (dirty.body?.post?.id) await call('DELETE', `/api/posts/${dirty.body.post.id}`);

  // CKEditor 免费版产出的形制必须整体穿过白名单，否则用户看到的加粗/清单会在落库时被静默吃掉
  const shaped = await call('POST', '/api/posts', {
    body: POST_BODY({
      rumor: {
        html:
          '<p><strong>a</strong><em>b</em><u>c</u><s>d</s>' +
          '<span class="anno anno-circle c-seal" data-cke-y="1">e</span></p>' +
          '<ul><li>f</li></ul><ol><li>g</li></ol><blockquote>h</blockquote>' +
          '<p><a href="https://example.org/x" target="_blank">i</a></p>',
      },
    }),
  });
  const kept = shaped.body?.post?.rumor?.html || '';
  check(
    'CKEditor 形制（粗体/斜体/下划线/删除线/清单/引文/批注）不被误删',
    ['<strong>', '<em>', '<u>', '<s>', '<ul><li>', '<ol><li>', '<blockquote>', 'anno anno-circle c-seal']
      .every((frag) => kept.includes(frag)) && !/data-cke-y/.test(kept),
    kept.slice(0, 150)
  );
  check('链接被强制加上 rel 与 nofollow', /rel="noopener noreferrer nofollow"/.test(kept), String(kept.match(/<a [^>]*>/)?.[0]));
  if (shaped.body?.post?.id) await call('DELETE', `/api/posts/${shaped.body.post.id}`);

  const idxFile = path.join(inst.data, 'media-index.json');
  const indexed = await waitForFile(idxFile, (c) => c.includes(goodId));
  check('删档前图片在索引中', indexed.includes(goodId));
  const gone = await call('DELETE', `/api/posts/${pid}`);
  const pruned = await waitForFile(idxFile, (c) => !c.includes(goodId));
  const fileGone = !fs.existsSync(path.join(inst.data, 'media', `${goodId}.png`));
  check(
    '删档同时回收其独占图片',
    gone.status === 200 && !pruned.includes(goodId) && fileGone,
    `索引残留 ${pruned.includes(goodId)} · 文件残留 ${!fileGone}`
  );

  const keep = await upload(makePng(16, 16));
  const keepUrl = `${base}${keep.body.url}`;
  fs.rmSync(path.join(inst.data, 'media', `${keep.body.id}.png`), { force: true });
  const deadLink = await call('GET', keep.body.url, { absolute: keepUrl });
  check('签名有效但文件缺失返回 404', deadLink.status === 404, String(deadLink.body?.error));
  const tampered = await call('GET', `/api/media/${keep.body.id}?exp=9999999999999&sig=deadbeef`);
  check('伪造签名被拒', tampered.status === 403);

  // 外部换掉 posts.json（reseed、从备份恢复、手工编辑）后检索索引必须一起换代：
  // 只在本进程写入时标脏的话，索引里留着旧文档 id，列表正常而搜索恒为 0 命中
  const postsFile = path.join(inst.data, 'posts.json');
  fs.writeFileSync(
    postsFile,
    JSON.stringify({
      version: 1,
      items: [{
        ...POST_BODY({ title: '外部换代档案：某添加剂致病（代次回归）', tags: ['外部换代'] }),
        id: 'pexternal01',
        pinned: false,
        order: 0,
        author: '外部',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }],
    })
  );
  const extSearch = await call('GET', `/api/search?q=${encodeURIComponent('外部换代')}`, { cookie: 'none' });
  check(
    '外部替换 posts.json 后检索随之换代',
    extSearch.status === 200 && extSearch.body.items.some((i) => i.id === 'pexternal01') && extSearch.body.items.length === 1,
    `命中 ${extSearch.body?.items?.length} 条`
  );
  const extList = await call('GET', '/api/posts?size=20', { cookie: 'none' });
  check('外部替换后列表与索引口径一致', extList.body.items.length === 1 && extList.body.items[0].id === 'pexternal01');
}

async function sectionShelves() {
  inst = await boot('shelves');
  base = inst.url;
  const reg = await login();
  check('镜像线实例可登录', reg.status === 200);

  // —— 资源库 ——
  const pubRes = await call('GET', '/api/resources', { cookie: 'none' });
  check('资源库对游客公开', pubRes.status === 200 && pubRes.body.groups.length > 0, `${pubRes.body.total} 条`);
  const shelfUrls = pubRes.body.groups.flatMap((g) => g.items).map((i) => i.url);
  const seededUrl = shelfUrls.find((u) => /roxylib/.test(u)) || '';
  check('借书柜台条目已入库', Boolean(seededUrl), `${shelfUrls.length} 条中的 ${seededUrl.slice(0, 48)}`);
  const allRes = await call('GET', '/api/resources/all', { cookie: 'none' });
  check('资源库全表需登录', allRes.status === 401);

  const okRes = await call('POST', '/api/resources', {
    body: { name: '官方作品页', url: 'https://example.org/mt', group: '官方一手出处', note: '可核实卷数与企划时点', trust: '高' },
  });
  check('登录后可登记资源', okRes.status === 201, okRes.body?.resource?.id);
  const badRes = await call('POST', '/api/resources', { body: { name: '危险条目', url: 'javascript:alert(1)' } });
  check('资源库拒绝危险协议链接', badRes.status === 400, String(badRes.body?.message));
  const emptyRes = await call('POST', '/api/resources', { body: { name: '   ', url: 'https://a.b' } });
  check('资源名空被拒', emptyRes.status === 400);
  const hideRes = await call('PUT', `/api/resources/${okRes.body.resource.id}`, {
    body: { ...okRes.body.resource, visible: false },
  });
  const afterHide = await call('GET', '/api/resources', { cookie: 'none' });
  const flat = afterHide.body.groups.flatMap((g) => g.items).map((i) => i.id);
  check('隐藏条目对游客不可见', hideRes.status === 200 && !flat.includes(okRes.body.resource.id), `${hideRes.status} / ${afterHide.body.total} 条可见`);
  const showRes = await call('PUT', `/api/resources/${okRes.body.resource.id}`, {
    body: { ...okRes.body.resource, visible: true },
  });
  const afterShow = await call('GET', '/api/resources', { cookie: 'none' });
  const back = afterShow.body.groups.flatMap((g) => g.items).map((i) => i.id);
  check('再次公开后条目回到游客视野', showRes.status === 200 && back.includes(okRes.body.resource.id));
  const delRes = await call('DELETE', `/api/resources/${okRes.body.resource.id}`);
  check('资源条目可删除', delRes.status === 200);
  const missPut = await call('PUT', '/api/resources/rnotexist', {
    body: { name: 'x', url: 'https://a.b' },
  });
  check('修订不存在的资源返回 404', missPut.status === 404);

  // —— 出厂示例实体：每项功能随包一份可删可改的样例，这里逐个核实它们真的在位 ——
  const cardList = await call('GET', '/api/posts?page=1&size=20', { cookie: 'none' });
  const demoIds = cardList.body.items.map((p) => p.id);
  check('出厂演示档案已就位', demoIds.length >= 6, `${demoIds.length} 条`);
  const sample = await call('GET', `/api/posts/${demoIds[0]}`, { cookie: 'none' });
  const sp = sample.body?.post || {};
  check(
    '示例图文登记了原始载体链接',
    /^https:\/\/example\.org\//.test(String(sp?.rumor?.source?.url || '')),
    String(sp?.rumor?.source?.url).slice(0, 44)
  );
  check(
    '示例图文的材料源带可回页出处链接与采集时刻',
    (sp.sources || []).some((row) => /^https:\/\/example\.org\//.test(row.url || '') && /^\d{4}-\d{2}-\d{2}$/.test(row.collectedAt || '')),
    `${(sp.sources || []).length} 条材料源`
  );
  check(
    '示例图文含正文圈划、划线与图上批注',
    /anno-circle/.test(String(sp?.rumor?.html)) && /anno-line/.test(String(sp?.rumor?.html)) && Object.keys(sp.annotations || {}).length > 0
  );
  const inSiteRes = pubRes.body.groups.flatMap((g) => g.items).find((i) => i.url === '/library');
  check('资源库含站内链接示例且原样入库', Boolean(inSiteRes), inSiteRes?.name || '未找到');

  const demoLogin = await call('POST', '/api/auth/login', {
    body: { username: 'demo', password: 'demo-pass' },
    standalone: true,
    csrf: false,
  });
  const demoCookie = (demoLogin.headers.get('set-cookie') || '').split(';')[0];
  check('出厂示例用户可用口令登录', demoLogin.status === 200 && demoCookie.startsWith('bw_sid='));
  const demoWho = await call('GET', '/api/auth/me', { cookie: 'none', headers: { cookie: demoCookie } });
  check('示例用户的会话身份为 demo', demoWho.status === 200 && demoWho.body?.user?.username === 'demo', JSON.stringify(demoWho.body?.user));
  const demoRow = (await call('GET', '/api/users')).body.items.find((x) => x.username === 'demo');
  check('名册里的示例用户为编辑角色且口令列为空', demoRow?.role === 'editor' && demoRow?.password === '', `${demoRow?.role}/${demoRow?.storage}`);
  const delDemo = await call('DELETE', '/api/users/demo');
  check('示例用户可从名册移除', delDemo.status === 200 && !delDemo.body.items.some((x) => x.username === 'demo'));
  const backDemo = await call('POST', '/api/users', {
    body: { username: 'demo', password: 'demo-pass', role: 'editor', displayName: '示例馆员（可删除）' },
  });
  check('移除后可重新登记（重跑种子同样恢复）', backDemo.status === 200 && backDemo.body.items.some((x) => x.username === 'demo'));
  const demoCsv = await waitForFile(path.join(inst.data, 'users.csv'), (c) => /demo/.test(c));
  check('示例用户确实落在 CSV 名册里', /demo/.test(demoCsv));

  // —— 镜像站：目录公开、内容受口令门控 ——
  const list = await call('GET', '/api/library', { cookie: 'none' });
  const raw = JSON.stringify(list.body);
  check('镜像目录对所有人公开', list.status === 200 && list.body.items.length > 0, `${list.body.total} 册`);
  check('公开目录不泄露磁盘文件名与口令', !/\.epub/.test(raw) && !/roxy-guest/.test(raw));
  const guestKeys = await call('GET', '/api/library/keys', { cookie: 'none' });
  check('口令表需登录才可读', guestKeys.status === 401);

  // 出厂五章演示册：在线阅览这条链路在出厂状态就有可翻的实体
  const grant0 = await call('POST', '/api/library/unlock', { body: { code: 'roxy-guest' }, cookie: 'none', csrf: false });
  const qs0 = `k=${grant0.body.k}&exp=${grant0.body.exp}&sig=${grant0.body.sig}`;
  const readBook = list.body.items.find((item) => /分页阅览演示册/.test(item.title));
  check('出厂五章演示册已在镜像目录登记', Boolean(readBook), readBook?.title || '未找到');
  const readerMeta = await call('GET', `/api/library/${readBook.id}/reader?${qs0}`, { cookie: 'none', csrf: false });
  check(
    '演示册可逐章阅览且未触发强制分页',
    readerMeta.status === 200 && readerMeta.body.chapters.length >= 5 && readerMeta.body.splitRequired === false,
    `${readerMeta.body?.chapters?.length} 章`
  );
  const lastChapter = await call('GET', `/api/library/${readBook.id}/reader/${readerMeta.body.chapters.length - 1}?${qs0}`, {
    cookie: 'none',
    csrf: false,
  });
  check('末章可取到正文且无下一翻页', lastChapter.status === 200 && lastChapter.body.nav.next === null, String(lastChapter.body?.chapterTitle));

  const bookId = list.body.items[0].id;
  const grant = await call('POST', '/api/library/unlock', { body: { code: 'roxy-guest' }, cookie: 'none', csrf: false });
  check('正确口令签发短时效令牌', grant.status === 200 && Boolean(grant.body.sig), `有效期至 ${String(grant.body.expiresAt).slice(11, 19)}`);
  const dl = await call('GET', `/api/library/files/${bookId}?k=${grant.body.k}&exp=${grant.body.exp}&sig=${grant.body.sig}`, {
    cookie: 'none',
    csrf: false,
    json: false,
  });
  check('凭令牌可取到整本书', dl.status === 200 && dl.raw.length > 1000, `${dl.status} · ${dl.raw.length}B · ${dl.headers.get('content-type')}`);
  check(
    '下载响应禁缓存并按附件下发',
    /no-store/.test(dl.headers.get('cache-control') || '') && /attachment/.test(dl.headers.get('content-disposition') || '')
  );
  const forged = await call('GET', `/api/library/files/${bookId}?k=${grant.body.k}&exp=${grant.body.exp}&sig=deadbeef`, { cookie: 'none', csrf: false });
  check('伪造签名令牌被拒', forged.status === 403);
  const expired = await call('GET', `/api/library/files/${bookId}?k=${grant.body.k}&exp=1000&sig=${grant.body.sig}`, { cookie: 'none', csrf: false });
  check('过期令牌被拒', expired.status === 403);
  const naked = await call('GET', `/api/library/files/${bookId}`, { cookie: 'none' });
  check('无令牌直接取书被拒', naked.status === 403);

  const ghost = await call('POST', '/api/library/register', { body: { file: '不在位.epub', title: '幽灵' } });
  check('登记不在目录内的文件被拒', ghost.status === 400, String(ghost.body?.message));
  fs.writeFileSync(path.join(inst.data, 'library', '伪装.epub'), Buffer.from('<html>不是 epub</html>'), 'utf8');
  const fake = await call('POST', '/api/library/register', { body: { file: '伪装.epub', title: '伪装' } });
  check('伪装成 EPUB 的文件被魔数拦下', fake.status === 415, String(fake.body?.message));
  const epub = demoEpub({ title: '馆方备份测试件', author: '辨妄阁', note: '接口自检用' });
  fs.writeFileSync(path.join(inst.data, 'library', '馆方备份测试件.epub'), epub);
  const reg2 = await call('POST', '/api/library/register', {
    body: { file: '馆方备份测试件.epub', title: '馆方备份测试件', author: '辨妄阁', rights: '自产测试件' },
  });
  check('磁盘上的真实 EPUB 可登记入册', reg2.status === 201 && reg2.body.book.bytes === epub.length, `${reg2.body?.book?.bytes}B`);
  const newBookId = reg2.body?.book?.id;

  const scoped = await call('POST', '/api/library/keys', {
    body: { code: 'only-one', label: '仅一本', scope: 'files', fileIds: [newBookId] },
  });
  check('可签发指定书目范围的口令', scoped.status === 201 && scoped.body.key.scope === 'files');
  const shortKey = await call('POST', '/api/library/keys', { body: { code: 'abc', label: '太短' } });
  check('短于 4 位的口令被拒', shortKey.status === 400);
  const scopedGrant = await call('POST', '/api/library/unlock', { body: { code: 'only-one' }, cookie: 'none', csrf: false });
  const cross = await call('GET', `/api/library/files/${bookId}?k=${scopedGrant.body.k}&exp=${scopedGrant.body.exp}&sig=${scopedGrant.body.sig}`, {
    cookie: 'none',
    csrf: false,
  });
  check('指定范围口令取不到范围外的书', cross.status === 403, String(cross.body?.error));
  const within = await call('GET', `/api/library/files/${newBookId}?k=${scopedGrant.body.k}&exp=${scopedGrant.body.exp}&sig=${scopedGrant.body.sig}`, {
    cookie: 'none',
    csrf: false,
    json: false,
  });
  check('指定范围口令可取到范围内的书', within.status === 200, `${within.status} · ${within.raw.length}B`);
  const revoke = await call('DELETE', `/api/library/keys/${scoped.body.key.id}`);
  const afterRevoke = await call('GET', `/api/library/files/${newBookId}?k=${scopedGrant.body.k}&exp=${scopedGrant.body.exp}&sig=${scopedGrant.body.sig}`, {
    cookie: 'none',
    csrf: false,
  });
  check('吊销口令后已发令牌立即失效', revoke.status === 200 && afterRevoke.status === 403, String(afterRevoke.body?.error));

  // —— 在线阅览：按章节分页、净化正文、图片同受口令门控 ——
  const tq = `k=${grant.body.k}&exp=${grant.body.exp}&sig=${grant.body.sig}`;
  const read = (p, opts = {}) => call('GET', `/api/library/${p}`, { cookie: 'none', csrf: false, ...opts });
  const small = multiChapterEpub({ title: '分页阅览测试册', chapters: 4 });
  fs.writeFileSync(path.join(inst.data, 'library', '分页阅览测试册.epub'), small);
  const regSmall = await call('POST', '/api/library/register', {
    body: { file: '分页阅览测试册.epub', title: '分页阅览测试册', rights: '自产测试件' },
  });
  const smallId = regSmall.body?.book?.id;
  check('多章节演示册可登记', regSmall.status === 201 && regSmall.body.book.bytes === small.length, `${regSmall.body?.book?.bytes}B`);

  const nakedMeta = await read(`${smallId}/reader`);
  check('无令牌读不到章节目录', nakedMeta.status === 403, String(nakedMeta.body?.error));
  const meta = await read(`${smallId}/reader?${tq}`);
  check('凭令牌可读到章节目录', meta.status === 200 && meta.body.chapters.length === 4, `${meta.body?.chapters?.length} 章`);
  check('章节标题取自包内 nav', meta.body.chapters?.[0]?.title === '第 1 章 · 演示', meta.body.chapters?.[0]?.title);
  check('未超阈值的书不强制拆分', meta.body.splitRequired === false);
  const first = await read(`${smallId}/reader/0?${tq}&p=1`);
  check('单章成页并给出翻页指针', first.status === 200 && first.body.nav.next?.c === 1, JSON.stringify(first.body?.nav));
  check('页内正文为包内自产文字', /11/.test(String(first.body?.html)));
  check(
    '正文里的脚本 / 行内样式 / svg 全被净化',
    !/script|__bw_pwned|style=|<svg|onload/i.test(String(first.body?.html))
  );
  const assetPath = String(/src="([^"]+)"/.exec(String(first.body?.html))?.[1] || '').replace(/&amp;/g, '&');
  check('正文保留标题锚点（跨章跳链可落位）', /<h2 id="sec-1">/.test(String(first.body?.html)), /<h2[^>]*>/.exec(String(first.body?.html))?.[0]);
  check('插图改写为站内门控地址', assetPath.startsWith('/api/library/') && assetPath.includes('sig='), assetPath.slice(0, 64));
  // 二进制要按字节验魔数，call() 的 raw 是文本，这里单独走一次 arrayBuffer
  const assetRes = await fetch(`${base}${assetPath}`, { headers: { 'user-agent': UA } });
  const assetBytes = Buffer.from(await assetRes.arrayBuffer());
  check(
    '凭令牌可取回插图（真 PNG）',
    assetRes.status === 200 && assetBytes.subarray(1, 4).toString() === 'PNG',
    `${assetRes.status} · ${assetBytes.length}B · ${assetRes.headers.get('content-type')}`
  );
  const assetNaked = await call('GET', assetPath.split('&k=')[0], { cookie: 'none', csrf: false });
  check('无令牌取不到插图', assetNaked.status === 403, String(assetNaked.body?.error));
  const traversal = await read(`${smallId}/asset?p=${encodeURIComponent('../../../etc/passwd')}&${tq}`);
  check('图片接口拒绝包外路径', traversal.status === 404, String(traversal.body?.error));
  const jump = /href="(\/library\/[^"]+)"/.exec(String(first.body?.html))?.[1] || '';
  check('跨章链接改写为站内阅览页', jump.includes('/read?c=1#sec-2'), jump);
  const outOfRange = await read(`${smallId}/reader/99?${tq}`);
  check('越界章节返回 404', outOfRange.status === 404, String(outOfRange.body?.error));
  const badIndex = await read(`${smallId}/reader/notANumber?${tq}`);
  check('非法章节序号返回 400', badIndex.status === 400, String(badIndex.body?.error));
  const wholeSmall = await read(`${smallId}/reader/all?${tq}`);
  check('阈值以下的书可整本渲染', wholeSmall.status === 200 && /id="c3"/.test(String(wholeSmall.body?.html)), `${wholeSmall.body?.bytes}B`);
  await call('POST', '/api/library/keys', {
    body: { code: 'only-new', label: '仅测试件', scope: 'files', fileIds: [newBookId] },
  });
  const narrowGrant = await call('POST', '/api/library/unlock', { body: { code: 'only-new' }, cookie: 'none', csrf: false });
  const narrowTq = `k=${narrowGrant.body.k}&exp=${narrowGrant.body.exp}&sig=${narrowGrant.body.sig}`;
  const outScope = await read(`${smallId}/reader?${narrowTq}`);
  check('范围外口令读不到他书正文', outScope.status === 403 && outScope.body.error === 'out-of-scope', String(outScope.body?.error));
  const inScope = await read(`${newBookId}/reader?${narrowTq}`);
  check('范围内口令可正常读到目录', inScope.status === 200 && inScope.body.chapters.length >= 1, `${inScope.body?.chapters?.length} 章`);

  const big = multiChapterEpub({ title: '大书拆分测试册', chapters: 2, sections: 40, padBytes: 10 * 1024 * 1024 + 128 * 1024 });
  fs.writeFileSync(path.join(inst.data, 'library', '大书拆分测试册.epub'), big);
  const regBig = await call('POST', '/api/library/register', {
    body: { file: '大书拆分测试册.epub', title: '大书拆分测试册', rights: '自产测试件' },
  });
  const bigId = regBig.body?.book?.id;
  check('10MB 以上的书可登记为镜像', regBig.status === 201 && regBig.body.book.bytes > 10 * 1024 * 1024, `${(regBig.body?.book?.bytes / 1048576).toFixed(1)}MB`);
  const bigMeta = await read(`${bigId}/reader?${tq}`);
  check('大书被标记为必须按章节分页', bigMeta.body.splitRequired === true, `${bigMeta.body?.chapters?.length} 章`);
  const bigPage = await read(`${bigId}/reader/0?${tq}`);
  check(
    '大书首章按小节切成多页且每页在上限内',
    bigPage.body.parts > 1 && bigPage.body.bytes <= bigMeta.body.limits.pageBytes,
    `${bigPage.body?.parts} 小节 · ${bigPage.body?.bytes}B`
  );
  const bigPart2 = await read(`${bigId}/reader/0?${tq}&p=2`);
  check('可翻到大书首章的第 2 小节', bigPart2.status === 200 && bigPart2.body.part === 2, `part=${bigPart2.body?.part}`);
  const wholeBig = await read(`${bigId}/reader/all?${tq}`);
  check('大书整本渲染被拒（409）', wholeBig.status === 409 && wholeBig.body.error === 'split-required', String(wholeBig.body?.message));
  fs.rmSync(path.join(inst.data, 'library', '大书拆分测试册.epub'), { force: true });

  const wrong = await call('POST', '/api/library/unlock', { body: { code: 'wrong-one' }, cookie: 'none', csrf: false });
  check('错口令被拒', wrong.status === 401, String(wrong.body?.error));
  let last = null;
  for (let i = 0; i < 6; i += 1) {
    last = await call('POST', '/api/library/unlock', { body: { code: `猜${i}` }, cookie: 'none', csrf: false });
  }
  check('连错若干次进入冷却（挡口令穷举）', last.status === 429 && Boolean(last.headers.get('retry-after')), `${last.status} Retry-After ${last.headers.get('retry-after')}`);

  return { bookId };
}

async function sectionProd() {
  inst = await boot('prod', { NODE_ENV: 'production' });
  base = inst.url;

  const page = await fetch(`${base}/`, { headers: { 'user-agent': UA } });
  const html = await page.text();
  const csp = page.headers.get('content-security-policy') || '';
  check('生产模式伺服构建产物', page.status === 200 && /data-terra-faction="yan-archival"/.test(html), `${page.status} · ${html.length}B`);
  check('生产模式下发严格 CSP', csp.includes("default-src 'self'") && !/unsafe-inline/.test(csp), csp.slice(0, 48));
  check('生产模式带 HSTS 与 nosniff', Boolean(page.headers.get('strict-transport-security')) && page.headers.get('x-content-type-options') === 'nosniff');
  check('响应不暴露框架签名', !page.headers.get('x-powered-by'));

  const r = await login();
  const cookie = (r.headers.get('set-cookie') || '');
  check('生产模式会话 Cookie 追加 Secure', r.status === 200 && /Secure/.test(cookie), cookie.slice(0, 60));
  const api = await call('GET', '/api/posts');
  check('生产模式接口仍禁缓存', api.headers.get('cache-control') === 'no-store' && /noindex/.test(api.headers.get('x-robots-tag') || ''));
  // 单页兜底正则是 `^(?!/api/)`：一旦写错，所有接口会静默返回 index.html 而不是 JSON
  for (const p of ['/api/resources', '/api/library', '/api/bootstrap', '/api/menu']) {
    const res = await call('GET', p, { cookie: 'none', csrf: false });
    check(`生产模式 ${p} 不被单页兜底吞掉`, res.status === 200 && !/^<!doctype html>/i.test(String(res.raw).trimStart()), String(res.headers.get('content-type')));
  }
}

async function sectionHash() {
  inst = await boot('hash', { BW_HASH_PASSWORDS: '1' });
  base = inst.url;

  const r = await login();
  check('哈希模式下默认账号仍可登录', r.status === 200, String(r.body?.message || ''));
  const roster = await call('GET', '/api/users');
  check('名册声明的存储形态为 scrypt', roster.body.storage === 'scrypt' || roster.body.items?.[0]?.storage === 'scrypt', JSON.stringify(roster.body.storage));
  await call('POST', '/api/users', { body: { username: 'hashman', password: 'Sup3r!Secret', role: 'editor', displayName: '哈希员' } });
  const csv = fs.readFileSync(path.join(inst.data, 'users.csv'), 'utf8');
  check('CSV 中不出现明文口令', !/Sup3r!Secret/.test(csv) && /scrypt\$/.test(csv), csv.split('\n')[1]?.slice(0, 28));
  const wrong = await call('POST', '/api/auth/login', {
    body: { username: 'hashman', password: '不对的口令' },
    standalone: true,
    csrf: false,
  });
  check('哈希模式错误口令仍被拒', wrong.status === 401);
  const right = await call('POST', '/api/auth/login', {
    body: { username: 'hashman', password: 'Sup3r!Secret' },
    standalone: true,
    csrf: false,
  });
  check('哈希模式新用户可用明文口令登录', right.status === 200);
}

async function sectionLock() {
  inst = await boot('lock');
  base = inst.url;

  let last = null;
  for (let i = 0; i < 5; i += 1) {
    last = await call('POST', '/api/auth/login', { body: { username: 'admin', password: `错口令${i}` }, cookie: 'none', csrf: false });
  }
  check('连错五次回到统一失败口径', last.status === 401, String(last.body?.error));
  const locked = await call('POST', '/api/auth/login', { body: { username: 'admin', password: 'admin' }, cookie: 'none', csrf: false });
  check('锁定期内即使口令正确也拒绝', locked.status === 429 && Boolean(locked.headers.get('retry-after')), `Retry-After ${locked.headers.get('retry-after')}`);
  const persisted = fs.existsSync(path.join(inst.data, 'login-attempts.json'));
  check('失败计数落盘（重启不清零）', persisted);
  const uaBot = await call('GET', '/api/posts', { headers: { 'user-agent': 'Scrapy/2.11' } });
  check('爬虫框架 UA 无会话即拒', uaBot.status === 403);
}

async function main() {
  try {
    const { goodId } = await sectionCore();
    await sectionDeep(goodId);
    await sectionShelves();
    await sectionProd();
    await sectionHash();
    await sectionLock();
  } catch (err) {
    check('体检脚本自身未抛异常', false, err?.stack?.split('\n').slice(0, 2).join(' | ') || String(err));
  } finally {
    for (const i of running) i.child.kill();
    await sleep(300);
    for (const d of created) fs.rmSync(d, { recursive: true, force: true });
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n合计 ${results.length} 项，失败 ${failed.length} 项。隔离数据目录已清理。`);
  for (const f of failed) console.log(`  · ${f.name} — ${f.detail}`);
  process.exit(failed.length ? 1 : 0);
}

main();
