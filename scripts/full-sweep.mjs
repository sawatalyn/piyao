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
import { demoEpub, multiChapterEpub, zipStore } from '../server/scripts/epub.js';
import { bigPdf, demoPdf } from '../server/scripts/pdf.js';

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
    env: {
      ...process.env,
      BW_PORT: String(port),
      BW_HOST: '127.0.0.1',
      BW_DATA_DIR: data,
      BW_SECRET: `sweep-${name}`,
      // 体检一轮要发上百次写：沿用产品默认 40/分钟会自己把自己限流成 429，
      // 生产值不变（见 config.writeLimitPerMinute），只在自检实例里放宽。
      BW_WRITE_LIMIT_PER_MIN: '300',
      ...env,
    },
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

  // 名册是明文口令所在的文件：字段里的逗号/引号/换行必须按 RFC4180 往返，
  // 否则一个换行就能把一行裂成两个身份（旧版按行 split 的读法正是如此）
  const edge = await call('POST', '/api/users', {
    body: { username: 'edgy.reviewer', password: 'a,b "c"\nPassw0rd', role: 'editor', displayName: '甲线\n乙线' },
  });
  const edgeRoster = (await call('GET', '/api/users')).body.items;
  check(
    '含换行的显示名不会裂成第二个身份',
    edge.status === 200 &&
      edgeRoster.some((u) => u.username === 'edgy.reviewer') &&
      !edgeRoster.some((u) => /^乙线/.test(String(u.username))),
    `${edgeRoster.length} 行：${edgeRoster.map((u) => u.username).join(',')}`
  );
  const edgeRow = edgeRoster.find((u) => u.username === 'edgy.reviewer');
  check('显示名逐字往返（换行原样保留）', edgeRow?.displayName === '甲线\n乙线', JSON.stringify(edgeRow?.displayName));
  const edgeLogin = await call('POST', '/api/auth/login', {
    body: { username: 'edgy.reviewer', password: 'a,b "c"\nPassw0rd' },
    standalone: true,
    csrf: false,
  });
  check('含逗号与引号的口令可原样登录', edgeLogin.status === 200, String(edgeLogin.body?.error));
  const edgeCsv = fs.readFileSync(path.join(inst.data, 'users.csv'), 'utf8');
  check(
    '落盘为 RFC4180 形态：跨行字段带引号、内嵌引号翻倍',
    /"甲线\r?\n乙线"/.test(edgeCsv) && /""c""/.test(edgeCsv),
    edgeCsv.split('\r\n').filter((line) => /edgy|乙线/.test(line)).join(' ⏎ ').slice(0, 80)
  );
  await call('DELETE', '/api/users/edgy.reviewer');

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

  // —— 版本台账：每次写入留一版完整快照，比对到字段与字词，快照绝不含短时效签名 ——
  const revList = await call('GET', `/api/posts/${pid}/revisions`);
  check(
    '建档与修订各留一版快照（含动作与修订者）',
    revList.status === 200 &&
      revList.body.items.length === 2 &&
      revList.body.items[0].kind === 'create' &&
      revList.body.items[1].kind === 'update' &&
      revList.body.items[1].by === revList.body.items[0].by,
    `${revList.body?.items?.length} 版 · ${revList.body?.items?.map((r) => r.kind).join('>')}`
  );
  const revFile = await waitForFile(path.join(inst.data, 'revisions.json'), (c) => c.includes('snapshot'));
  check(
    '版本快照落盘为未签名图片路径（签名不进台账）',
    /\/api\/media\//.test(revFile) && !/exp=|sig=/.test(revFile),
    `exp= 出现 ${revFile.split('exp=').length - 1} 处`
  );
  const revPairFile = await call('GET', `/api/posts/${pid}/revisions/diff?from=${revList.body.items[0].id}&to=${revList.body.items[1].id}`);
  const titleField = (revPairFile.body?.fields || []).find((f) => f.key === 'title');
  check(
    '两版比对指出标题改了哪个字（非词级字段直接给新旧值）',
    revPairFile.status === 200 &&
      Boolean(titleField?.before && titleField?.after) &&
      titleField.before !== titleField.after &&
      /已修订/.test(titleField.after),
    `${titleField?.before} → ${titleField?.after}`
  );
  check('比对响应里也不带签名串', !/exp=|sig=/.test(JSON.stringify(revPairFile.body)));
  const revThird = await call('PUT', `/api/posts/${pid}`, {
    body: {
      ...created.body.post,
      title: '体检档案（第三次）：某食品添加物会导致某病',
      verdict: { html: '<p>结论改成了实测无差异，仅保留样本说明。</p>', rating: '误导' },
    },
  });
  const revs3 = (await call('GET', `/api/posts/${pid}/revisions`)).body;
  check('第三次写入后共三版且 pair 默认指向最近两版', revThird.status === 200 && revs3.items.length === 3 && revs3.pair.to === revs3.items[2].id, `${revs3.items?.length} 版`);
  const pair3 = await call('GET', `/api/posts/${pid}/revisions/diff?from=${revs3.items[1].id}&to=${revs3.items[2].id}`);
  const verdictField = (pair3.body?.fields || []).find((f) => f.key === 'verdict');
  check(
    '正文比对按字/词给出增删分段（jsdiff）',
    pair3.status === 200 &&
      (verdictField?.segments || []).some((seg) => seg.op === 'del') &&
      (verdictField?.segments || []).some((seg) => seg.op === 'add'),
    JSON.stringify((verdictField?.segments || []).slice(0, 5))
  );
  const foreignDiff = await call('GET', `/api/posts/${pid}/revisions/diff?from=${revs3.items[0].id}&to=rseed1`);
  check('拿别的档案的版本号来比对会被拒（404）', foreignDiff.status === 404, String(foreignDiff.body?.error));

  // —— 全站版本台账总表（#39）：口径随写入即时更新（记忆化按数据代次失效），且能按档案筛选 ——
  const ledgerBefore = await call('GET', '/api/ops/revisions?limit=200');
  const pidRowsBefore = (ledgerBefore.body?.items || []).filter((row) => row.postId === pid).length;
  const onlyPid = await call('GET', `/api/ops/revisions?post=${encodeURIComponent(pid)}&limit=200`);
  check(
    '按档案筛选只回该档的版本，且与本站写入的版本数吻合',
    onlyPid.status === 200 &&
      onlyPid.body.items.length === pidRowsBefore &&
      onlyPid.body.items.every((row) => row.postId === pid),
    `命中 ${onlyPid.body?.totals?.matched} / 该档 ${pidRowsBefore} 版`
  );
  await call('PUT', `/api/posts/${pid}`, {
    body: { ...created.body.post, title: '体检档案（第四次）：再改一次以验证台账代次', verdict: { html: '<p>再改。</p>', rating: '误导' } },
  });
  const ledgerAfter = await call('GET', '/api/ops/revisions?limit=200');
  const pidRowsAfter = (ledgerAfter.body?.items || []).filter((row) => row.postId === pid).length;
  check(
    '再写一版后台账口径即时跟上（记忆化按数据代次失效，不会读到旧缓存）',
    ledgerAfter.status === 200 &&
      pidRowsAfter === pidRowsBefore + 1 &&
      ledgerAfter.body.totals.entries === ledgerBefore.body.totals.entries + 1,
    `该档 ${pidRowsBefore}→${pidRowsAfter} 版 / 全站 ${ledgerBefore.body?.totals?.entries}→${ledgerAfter.body?.totals?.entries} 版`
  );
  check(
    '台账行标出档案是否还在（alive），且流水只给表头不给快照',
    ledgerAfter.body.items.every((row) => typeof row.alive === 'boolean' && typeof row.bytes === 'number') &&
      !/snapshot|exp=|sig=/.test(JSON.stringify(ledgerAfter.body)),
    `${ledgerAfter.body?.items?.length} 行`
  );

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

  // —— 馆务台账：磁盘 / 索引 / 在档引用三方对账，清理须点名且默认只预演 ——
  const strayName = `zzorphan-${Date.now().toString(36)}.png`;
  fs.writeFileSync(path.join(inst.data, 'media', strayName), makePng(8, 8));
  // 一张上传后没被任何档案引用的图（unreferenced）+ 一张索引在、磁盘文件已被前面测试抹掉的图（死链）
  const loose = await upload(makePng(12, 12));
  const report = await call('GET', '/api/ops/media-report');
  const orphanRow = (report.body?.orphanFiles || []).find((row) => row.file === strayName);
  check(
    '磁盘孤儿被点名，并带体积与 sha256 校验值',
    report.status === 200 && orphanRow?.mine === true && /^[0-9a-f]{64}$/.test(String(orphanRow?.sha256)),
    `${orphanRow?.bytes}B · ${String(orphanRow?.sha256).slice(0, 12)}`
  );
  const looseRow = (report.body?.unreferenced || []).find((row) => row.id === loose.body.id);
  check('索引里有记录、档案已不再引用的条目被单列出来', Boolean(looseRow), `${String(looseRow?.file)} / ${report.body?.totals?.unreferenced} 条`);
  const staleRow = (report.body?.staleIndex || []).find((row) => row.id === keep.body.id);
  check('索引里有记录、磁盘文件已缺失的被列为死链（只能重传修复）', Boolean(staleRow), `${report.body?.totals?.staleIndex} 条 · ${String(staleRow?.file)}`);
  check('对账口径自洽：索引记录数 = 在用 + 无引用 + 死链', report.body.totals.indexRecords === report.body.totals.used + report.body.totals.unreferenced + report.body.totals.staleIndex, JSON.stringify(report.body?.totals));

  const refuse = await call('POST', '/api/ops/media-gc', { body: { ids: ['mnotexist'], files: ['../users.csv', 'README.md'], confirm: true } });
  const refuseReasons = (refuse.body?.skipped || []).map((s) => s.reason).join(' ');
  check(
    '清理拒绝越界路径、非本站扩展名与不存在的记录，users.csv 完好',
    refuse.status === 200 &&
      (refuse.body?.skipped || []).length === 3 &&
      /索引里没有/.test(refuseReasons) &&
      /不合法/.test(refuseReasons) &&
      /非本站写出的扩展名/.test(refuseReasons) &&
      fs.existsSync(path.join(inst.data, 'users.csv')),
    `${refuse.status} · ${refuseReasons}`
  );

  const preview = await call('POST', '/api/ops/media-gc', { body: { ids: [loose.body.id], files: [strayName], confirm: false } });
  check(
    '预演列出将要删的两项且一个字节都没动',
    preview.body?.dryRun === true &&
      preview.body.plan.indexRecords.length === 1 &&
      preview.body.plan.orphanFiles.length === 1 &&
      fs.existsSync(path.join(inst.data, 'media', strayName)) &&
      fs.existsSync(path.join(inst.data, 'media', String(looseRow?.file))),
    `将删 ${preview.body?.plan?.indexRecords?.length} 条 + ${preview.body?.plan?.orphanFiles?.length} 个 · 约 ${preview.body?.bytesFreed}B`
  );
  const executed = await call('POST', '/api/ops/media-gc', { body: { ids: [loose.body.id], files: [strayName], confirm: true } });
  check(
    '确认后磁盘孤儿与无引用记录一起消失',
    executed.body?.dryRun === false &&
      executed.body.removed.indexRecords.length === 1 &&
      executed.body.removed.orphanFiles.length === 1 &&
      !fs.existsSync(path.join(inst.data, 'media', strayName)) &&
      !fs.existsSync(path.join(inst.data, 'media', String(looseRow?.file))),
    `${executed.status} · 释放 ${executed.body?.bytesFreed}B`
  );
  // 索引落盘是排队的：先等这次删除真的到了盘上再判定
  const indexAfter = await waitForFile(path.join(inst.data, 'media-index.json'), (c) => !c.includes(String(loose.body.id)));
  check('索引文件同步去掉该记录（不留死引用）', !indexAfter.includes(String(loose.body.id)), `${JSON.parse(indexAfter).items.length} 条在索引`);

  // 仍被在档档案引用的图片必须删不掉
  const refPng = await upload(makePng(10, 10));
  const refId = refPng.body?.id;
  await call('POST', '/api/posts', {
    body: {
      ...POST_BODY({ title: '台账引用保护档案', tags: ['台账'] }),
      rumor: { html: `<p>正文引用<img data-mid="${refId}" src="/api/media/${refId}" alt="证据" /></p>` },
    },
  });
  const guarded = await call('POST', '/api/ops/media-gc', { body: { ids: [refId], files: [], confirm: true } });
  const refRow = (await call('GET', '/api/ops/media-report')).body?.used?.find((row) => row.id === refId);
  check(
    '仍被档案引用的图片拒绝清理，并被列为在用',
    (guarded.body?.skipped || []).some((s) => /仍被在档档案引用/.test(s.reason)) && Boolean(refRow),
    `${guarded.status} · ${JSON.stringify(guarded.body?.skipped)}`
  );
  const logAnon = await call('GET', '/api/ops/security-log', { cookie: 'none' });
  check('安全日志聚合需登录', logAnon.status === 401, String(logAnon.body?.error));
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
    body: { file: '馆方备份测试件.epub', title: '馆方备份测试件', author: '辨妄阁', rights: '自产测试件', previewable: true },
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
    body: { file: '分页阅览测试册.epub', title: '分页阅览测试册', rights: '自产测试件', previewable: true },
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
    body: { file: '大书拆分测试册.epub', title: '大书拆分测试册', rights: '自产测试件', previewable: true },
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

  // —— 包内 XML 由严格解析器读取（@rgrove/parse-xml，ISC）：结构坏了要明确报错，导航坏了只降级 ——
  const OPF_XML = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bid">',
    '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="bid">urn:uuid:1</dc:identifier>',
    '<dc:title>XML 口径测试册</dc:title><dc:language>zh-CN</dc:language></metadata>',
    '<manifest><item href="Text/c1.xhtml" media-type="application/xhtml+xml" id="c1"/>',
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest>',
    '<spine><itemref linear="no" idref="nav"/><itemref idref="c1"/></spine></package>',
  ].join('');
  const C1_XML =
    '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>c1</title></head><body><h2>正文一页</h2></body></html>';
  const GOOD_CONTAINER =
    '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>';
  const navEpub = (nav) =>
    zipStore([
      { name: 'mimetype', data: 'application/epub+zip' },
      { name: 'META-INF/container.xml', data: GOOD_CONTAINER },
      { name: 'content.opf', data: OPF_XML },
      { name: 'nav.xhtml', data: nav },
      { name: 'Text/c1.xhtml', data: C1_XML },
    ]);

  fs.writeFileSync(
    path.join(inst.data, 'library', '导航实体册.epub'),
    navEpub(
      '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>目录</title></head><body><nav epub:type="toc"><ol><li><a href="Text/c1.xhtml">第一章&nbsp;未声明实体</a></li></ol></nav></body></html>'
    )
  );
  const regEntity = await call('POST', '/api/library/register', {
    body: { file: '导航实体册.epub', title: '导航实体册', rights: '自产测试件', previewable: true },
  });
  const entityMeta = await read(`${regEntity.body?.book?.id}/reader?${tq}`);
  check(
    'nav 里未声明的 HTML 实体只让章节名退化，整本书仍可读',
    regEntity.status === 201 &&
      entityMeta.status === 200 &&
      entityMeta.body.chapters.length === 1 &&
      /^第 1 节/.test(entityMeta.body.chapters[0].title),
    `${entityMeta.status} · ${JSON.stringify(entityMeta.body?.chapters)}`
  );
  const entityPage = await read(`${regEntity.body?.book?.id}/reader/0?${tq}`);
  check('退化书的正文照常下发', entityPage.status === 200 && /正文一页/.test(String(entityPage.body?.html)), `${entityPage.body?.bytes}B`);

  fs.writeFileSync(
    path.join(inst.data, 'library', '结构残缺册.epub'),
    zipStore([
      { name: 'mimetype', data: 'application/epub+zip' },
      { name: 'META-INF/container.xml', data: '<?xml version="1.0"?><container><rootfiles><rootfile full-path="a.opf"' },
      { name: 'content.opf', data: OPF_XML },
    ])
  );
  const regBroken = await call('POST', '/api/library/register', {
    body: { file: '结构残缺册.epub', title: '结构残缺册', rights: '自产测试件', previewable: true },
  });
  const brokenMeta = await read(`${regBroken.body?.book?.id}/reader?${tq}`);
  check(
    '残缺的 container.xml 被明确拒绝（422 epub-invalid），不再靠正则猜标签',
    regBroken.status === 201 && brokenMeta.status === 422 && brokenMeta.body.error === 'epub-invalid' && /无法解析/.test(String(brokenMeta.body?.message)),
    `${brokenMeta.status} · ${String(brokenMeta.body?.message).slice(0, 46)}`
  );
  for (const name of ['导航实体册.epub', '结构残缺册.epub']) fs.rmSync(path.join(inst.data, 'library', name), { force: true });

  // —— 预览白名单：可下载不等于可预览，逐本由馆员勾选、默认关 ——
  const off = multiChapterEpub({ title: '白名单测试册', chapters: 2 });
  fs.writeFileSync(path.join(inst.data, 'library', '白名单测试册.epub'), off);
  const regOff = await call('POST', '/api/library/register', {
    body: { file: '白名单测试册.epub', title: '白名单测试册', rights: '自产测试件' },
  });
  const offId = regOff.body?.book?.id;
  check('登记时不勾选即为"仅可下载"', regOff.status === 201 && regOff.body.book.previewable === false, String(regOff.body?.book?.previewable));
  const offMeta = await read(`${offId}/reader?${tq}`);
  check('未入白名单：章节目录被拒（403 preview-off）', offMeta.status === 403 && offMeta.body.error === 'preview-off', String(offMeta.body?.error));
  const offPage = await read(`${offId}/reader/0?${tq}`);
  check('未入白名单：逐章正文同样被拒', offPage.status === 403 && offPage.body.error === 'preview-off', String(offPage.body?.error));
  const offAll = await read(`${offId}/reader/all?${tq}`);
  check('未入白名单：整本渲染同样被拒', offAll.status === 403 && offAll.body.error === 'preview-off', String(offAll.body?.error));
  const offAsset = await read(`${offId}/asset?p=cover.png&${tq}`);
  check('未入白名单：包内插图被挡在门控之前', offAsset.status === 403 && offAsset.body.error === 'preview-off', String(offAsset.body?.error));
  const offDownload = await call('GET', `/api/library/files/${offId}?${tq}`, { cookie: 'none', csrf: false, json: false });
  check('关掉预览不影响凭口令下载', offDownload.status === 200 && offDownload.raw.length > 1000, `${offDownload.raw.length}B`);
  const offBookHit = await read(`search?q=${encodeURIComponent('白名单测试册')}&${tq}`);
  check('未入白名单的书仍可被书目级检索命中', offBookHit.body?.items?.some((i) => i.bookId === offId && i.kind === 'book'), `${offBookHit.body?.total} 项`);
  const offChapterHit = await read(`search?q=${encodeURIComponent('第 2 章')}&${tq}`);
  check(
    '未入白名单时不外泄包内章节标题',
    !offChapterHit.body?.items?.some((i) => i.bookId === offId && i.kind === 'chapter'),
    JSON.stringify(offChapterHit.body?.items?.filter((i) => i.bookId === offId))
  );
  const flipOn = await call('PUT', `/api/library/files/${offId}`, { body: { previewable: true } });
  const flippedMeta = await read(`${offId}/reader?${tq}`);
  check(
    '馆员勾选后即刻获得预览且原字段不被清空',
    flipOn.status === 200 && flipOn.body.book.previewable === true && flipOn.body.book.title === '白名单测试册' && flippedMeta.status === 200,
    `${flipOn.body?.book?.title} / ${String(flipOn.body?.book?.rights)}`
  );
  const chapterNow = await read(`search?q=${encodeURIComponent('第 2 章')}&${tq}`);
  check('入白名单后其章节进入检索', chapterNow.body?.items?.some((i) => i.bookId === offId && i.kind === 'chapter'), `${chapterNow.body?.total} 项`);
  const flipOff = await call('PUT', `/api/library/files/${offId}`, { body: { previewable: false } });
  const afterFlipOff = await read(`${offId}/reader?${tq}`);
  check(
    '取消勾选即刻撤回预览',
    flipOff.body?.book?.previewable === false && afterFlipOff.status === 403 && afterFlipOff.body.error === 'preview-off',
    String(afterFlipOff.body?.error)
  );
  const unregistered = await call('DELETE', `/api/library/files/${offId}`);
  const goneReader = await read(`${offId}/reader?${tq}`);
  check('取消登记后阅览直接 404（白名单不再可达）', unregistered.status === 200 && goneReader.status === 404, String(goneReader.body?.error));
  fs.rmSync(path.join(inst.data, 'library', '白名单测试册.epub'), { force: true });

  // —— PDF 在线阅览：书签优先、无书签回退固定页数，>10MB 强制分节 ——
  const pdf = demoPdf({ title: 'PDF 阅览测试册' });
  fs.writeFileSync(path.join(inst.data, 'library', 'PDF阅览测试册.pdf'), pdf);
  const regPdf = await call('POST', '/api/library/register', {
    body: { file: 'PDF阅览测试册.pdf', title: 'PDF 阅览测试册', rights: '自产测试件', previewable: true },
  });
  const pdfId = regPdf.body?.book?.id;
  check('PDF 按魔数登记并带出类型', regPdf.status === 201 && regPdf.body.book.type === 'application/pdf', `${regPdf.body?.book?.bytes}B`);
  const pdfMeta = await read(`${pdfId}/reader?${tq}`);
  check(
    'PDF 以书签为节并标出 kind=pdf',
    pdfMeta.status === 200 && pdfMeta.body.kind === 'pdf' && pdfMeta.body.chapters.length === 3,
    `${pdfMeta.body?.chapters?.length} 节`
  );
  check('PDF 书签标题原样成为节名', pdfMeta.body.chapters?.[1]?.title === '第二章 · 证据与推理', String(pdfMeta.body.chapters?.[1]?.title));
  check('PDF 目录带每节页数与切分依据', pdfMeta.body.chapters?.[0]?.pages === 2 && pdfMeta.body.meta.splitBy === 'outline', `pages=${pdfMeta.body.chapters?.[0]?.pages} · ${pdfMeta.body.meta?.splitBy}`);
  check('小 PDF 不强制分页', pdfMeta.body.splitRequired === false);
  const pdfPage = await read(`${pdfId}/reader/1?${tq}`);
  check('PDF 正文来自文字层', pdfPage.status === 200 && /controlled trial/.test(String(pdfPage.body?.html)), String(pdfPage.body?.html?.slice(0, 44)));
  check(
    'PDF 正文按物理页成段并给出页号',
    /class="pdf-page"/.test(String(pdfPage.body?.html)) && pdfPage.body.pages?.join(',') === '3,4',
    JSON.stringify(pdfPage.body?.pages)
  );
  check('PDF 正文经净化（无脚本与行内样式）', !/script|style=|onload|<svg/i.test(String(pdfPage.body?.html)));
  check('PDF 节间翻页指针指向下一节', pdfPage.body.nav?.next?.c === 2, JSON.stringify(pdfPage.body?.nav));
  const pdfLast = await read(`${pdfId}/reader/2?${tq}`);
  check('PDF 末节无下一页', pdfLast.body?.nav?.next === null, `part=${pdfLast.body?.part}`);
  const pdfWhole = await read(`${pdfId}/reader/all?${tq}`);
  check('阈值以下的小 PDF 可整本渲染', pdfWhole.status === 200 && /第一章 · 谣言样本/.test(String(pdfWhole.body?.html)), `${pdfWhole.body?.bytes}B`);
  const pdfAsset = await read(`${pdfId}/asset?p=cover.png&${tq}`);
  check('PDF 没有包内插图通道（409）', pdfAsset.status === 409 && pdfAsset.body.error === 'asset-epub-only', String(pdfAsset.body?.error));

  const fat = bigPdf({ title: 'PDF 大书拆分测试册' });
  fs.writeFileSync(path.join(inst.data, 'library', 'PDF大书拆分测试册.pdf'), fat);
  const regFat = await call('POST', '/api/library/register', {
    body: { file: 'PDF大书拆分测试册.pdf', title: 'PDF 大书拆分测试册', rights: '自产测试件', previewable: true },
  });
  const fatId = regFat.body?.book?.id;
  const fatMeta = await read(`${fatId}/reader?${tq}`);
  const perPages = fatMeta.body?.limits?.pagesPerChapter;
  check(
    '无书签的大 PDF 按固定页数切节',
    fatMeta.status === 200 && fatMeta.body.meta.splitBy === 'pages' && fatMeta.body.chapters.length === Math.ceil(80 / perPages),
    `${fatMeta.body?.chapters?.length} 节 / 每节 ${perPages} 页`
  );
  check('大 PDF 被标记为必须按节阅览', fatMeta.body.splitRequired === true);
  const fatPage = await read(`${fatId}/reader/0?${tq}`);
  check(
    '大 PDF 单节正文受单页字节上限约束',
    fatPage.body?.bytes <= fatMeta.body.limits.pageBytes && fatPage.body.splitBy === 'pages',
    `${fatPage.body?.bytes}B · ${fatPage.body?.pages?.length} 页`
  );
  const fatWhole = await read(`${fatId}/reader/all?${tq}`);
  check('大 PDF 整本渲染被拒（409）', fatWhole.status === 409 && fatWhole.body.error === 'split-required', String(fatWhole.body?.message));

  const pdfHit = await read(`search?q=${encodeURIComponent('结论判定')}&${tq}`);
  const pdfChapter = pdfHit.body?.items?.find((i) => i.bookId === pdfId && i.kind === 'chapter');
  check(
    'PDF 书签标题进入架上检索并直连该节',
    pdfChapter?.chapterIndex === 2 && pdfChapter.href === `/library/${pdfId}/read?c=2`,
    JSON.stringify(pdfChapter)
  );

  fs.writeFileSync(path.join(inst.data, 'library', '坏PDF.pdf'), Buffer.from('%PDF-1.4\n%%EOF\n'));
  const regBad = await call('POST', '/api/library/register', {
    body: { file: '坏PDF.pdf', title: '空壳 PDF', rights: '自产测试件', previewable: true },
  });
  const badMeta = await read(`${regBad.body?.book?.id}/reader?${tq}`);
  check('结构不完整的 PDF 明确报错而不是 500', regBad.status === 201 && badMeta.status === 422 && badMeta.body.error === 'pdf-invalid', `${badMeta.status} · ${String(badMeta.body?.message)}`);
  for (const name of ['PDF阅览测试册.pdf', 'PDF大书拆分测试册.pdf', '坏PDF.pdf']) {
    fs.rmSync(path.join(inst.data, 'library', name), { force: true });
  }

  // —— 架上检索：元数据 + 包内章节标题，仍受口令与范围约束 ——
  const nakedSearch = await read('search?q=%E7%AC%AC%202%20%E7%AB%A0');
  check('无令牌检索被拒', nakedSearch.status === 403 && nakedSearch.body.error === 'grant-required', String(nakedSearch.body?.error));
  const emptySearch = await read(`search?q=&${tq}`);
  check('空检索词返回 400', emptySearch.status === 400 && emptySearch.body.error === 'bad-query', String(emptySearch.body?.message));

  const byTitle = await read(`search?q=${encodeURIComponent('分页阅览测试册')}&${tq}`);
  check(
    '按书名可命中书目条目',
    byTitle.status === 200 && byTitle.body.items.some((i) => i.kind === 'book' && i.bookId === smallId),
    `${byTitle.body?.total} 项`
  );
  const byChapter = await read(`search?q=${encodeURIComponent('第 2 章')}&${tq}`);
  const chapterHit = byChapter.body?.items?.find((i) => i.kind === 'chapter' && i.bookId === smallId);
  check(
    '按包内章节标题命中并给出直达链接',
    byChapter.status === 200 && chapterHit?.chapterIndex === 1 && chapterHit.href === `/library/${smallId}/read?c=1`,
    JSON.stringify(chapterHit || byChapter.body?.items?.slice(0, 2))
  );
  check('检索结果不泄露磁盘文件名与令牌', !/\.epub|sig=/.test(JSON.stringify(byChapter.body)));

  // 检索只在口令覆盖的书目内进行：'测试' 同时命中范围内与范围外两本，据此证明范围外那本被查不到
  const narrowSearch = await read(`search?q=${encodeURIComponent('测试')}&${narrowTq}`);
  check(
    '限定范围的口令检索不到范围外的书',
    narrowSearch.status === 200 &&
      narrowSearch.body.total > 0 &&
      narrowSearch.body.items.every((i) => i.bookId === newBookId) &&
      narrowSearch.body.searched === 1,
    `${narrowSearch.body?.searched} 册 / ${narrowSearch.body?.total} 项 / 全为范围内=${narrowSearch.body?.items?.every((i) => i.bookId === newBookId)}`
  );

  // 单本解析失败不得把整次检索打成 500：塞一个"是 ZIP 但不是 EPUB"的文件
  const notEpub = zipStore([{ name: 'readme.txt', data: '这不是 EPUB' }]);
  fs.writeFileSync(path.join(inst.data, 'library', '伪EPUB.epub'), notEpub);
  const regFake = await call('POST', '/api/library/register', {
    body: { file: '伪EPUB.epub', title: '伪 EPUB 检索耐受测试', rights: '自产测试件', previewable: true },
  });
  const fakeSearch = await read(`search?q=${encodeURIComponent('第 2 章')}&${tq}`);
  check(
    '坏包只被跳过、不影响其余书目命中',
    regFake.status === 201 && fakeSearch.status === 200 && fakeSearch.body.skipped >= 1 && fakeSearch.body.total > 0,
    `skipped ${fakeSearch.body?.skipped} · 命中 ${fakeSearch.body?.total}`
  );
  await call('DELETE', `/api/library/files/${regFake.body.book.id}`);
  fs.rmSync(path.join(inst.data, 'library', '伪EPUB.epub'), { force: true });

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

async function sectionWriteLimit() {
  // 写限流阈值现在是可配置项（BW_WRITE_LIMIT_PER_MIN），这里显式验证它真的会挡住
  inst = await boot('writelimit', { BW_WRITE_LIMIT_PER_MIN: '3' });
  base = inst.url;
  await login();
  const menuBody = { items: [{ moduleId: 'home', visible: true }], known: ['home'] };
  const statuses = [];
  let code = '';
  for (let i = 0; i < 4; i += 1) {
    const r = await call('PUT', '/api/menu', { body: menuBody });
    statuses.push(r.status);
    if (r.status === 429) code = String(r.body?.error);
  }
  check(
    '写操作限流按配置生效（前 3 次过、第 4 次 429）',
    statuses.slice(0, 3).every((s) => s === 200) && statuses[3] === 429 && code === 'write-rate-limited',
    statuses.join(',') + ' · ' + code
  );
  const readWhileLimited = await call('GET', '/api/menu');
  check('限流只挡写、不挡读', readWhileLimited.status === 200, String(readWhileLimited.status));

  // 版本保留上限同样是配置项：超出即丢最旧，台账不能无限膨胀
  inst = await boot('keeplimit', { BW_REVISION_KEEP: '2' });
  base = inst.url;
  await login();
  const createdPost = await call('POST', '/api/posts', { body: POST_BODY({ title: '版本上限档案', tags: ['版本'] }) });
  const kid = createdPost.body?.post?.id;
  for (let i = 2; i <= 4; i += 1) {
    await call('PUT', `/api/posts/${kid}`, { body: POST_BODY({ title: `版本上限档案 第${i}次`, tags: ['版本'] }) });
  }
  const kept = await call('GET', `/api/posts/${kid}/revisions`);
  check(
    '版本数超过 BW_REVISION_KEEP 时丢最旧、留下最近两版',
    kept.body?.keep === 2 && kept.body.items.length === 2 && kept.body.items[1].title === '版本上限档案 第4次',
    `${kept.body?.items?.length} 版 · 末版「${kept.body?.items?.[1]?.title}」`
  );
  const ledgerKeep = await call('GET', `/api/ops/revisions?post=${encodeURIComponent(kid)}&limit=50`);
  check(
    '全站台账也遵守保留上限：该档只留最近两版，keep 口径随实例配置',
    ledgerKeep.status === 200 && ledgerKeep.body.totals.keep === 2 && ledgerKeep.body.items.length === 2,
    `keep=${ledgerKeep.body?.totals?.keep} / 该档 ${ledgerKeep.body?.items?.length} 版`
  );
  // 撤档不抹历史（DEVELOPMENT §七 R-14）：删档后台账里该档仍在册，但标为 alive=false
  await call('DELETE', `/api/posts/${kid}`);
  const ledgerOrphan = await call('GET', `/api/ops/revisions?post=${encodeURIComponent(kid)}&limit=50`);
  check(
    '删档后台账仍保留其历史版本，但每行标为已撤档（alive=false）',
    ledgerOrphan.status === 200 &&
      ledgerOrphan.body.items.length === 2 &&
      ledgerOrphan.body.items.every((row) => row.alive === false && row.postId === kid),
    `${ledgerOrphan.body?.items?.length} 版仍在册 / alive ${JSON.stringify((ledgerOrphan.body?.items || []).map((r) => r.alive))}`
  );
}

async function main() {
  try {
    const { goodId } = await sectionCore();
    await sectionDeep(goodId);
    await sectionShelves();
    await sectionProd();
    await sectionHash();
    await sectionLock();
    await sectionWriteLimit();
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
