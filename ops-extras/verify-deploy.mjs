#!/usr/bin/env node
/**
 * 部署后验收：只读检查站点是否真的活着（默认不写任何东西）。
 *
 * 为什么默认只读：部署机上跑验收的时候，多半已经在生产数据上了。
 * 建档/修订/比对/置顶/删除这条写链路要显式加 --mutate 才走，且用完自清。
 *
 * 用法：
 *   node ops/verify-deploy.mjs                                  # 预演（只读），默认 http://127.0.0.1
 *   node ops/verify-deploy.mjs https://bia.example.org
 *   node ops/verify-deploy.mjs http://127.0.0.1:8787 --mutate --user admin --pass '改过的口令'
 *   node ops/verify-deploy.mjs https://bia.example.org --expect-prod   # 把 CSP 那类项从"提醒"判成"失败"
 *
 * 注意：--mutate 会真的置顶一次再删除该条，**原置顶会被转移走**（置顶是全局唯一）。
 * 跑完请在页面上把该置顶的那条重新点一次，或对演示机执行 pnpm seed。
 *
 * 报告落盘：ops/verify-report-<时间戳>.md（含逐项 PASS/FAIL 与实测值）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const BASE = (argv.find((a) => /^https?:\/\//.test(a)) || 'http://127.0.0.1').replace(/\/$/, '');
const MUTATE = argv.includes('--mutate');
const flag = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : '';
};
const USER = flag('--user') || process.env.BW_ADMIN_USER || '';
const PASS = flag('--pass') || process.env.BW_ADMIN_PASS || '';

/** 站点对脚本型 UA 直接拒，所以只读检查用浏览器 UA；反爬那一节再单独用 curl UA 复现拒绝 */
const BROWSER_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const jar = { cookie: '', csrf: '' };

const results = [];
/**
 * FAIL = 站点真的不通；WARN = 只在生产入口才该满足的项（CSP），开发实例或直连后端时缺失属正常；
 * INFO = 只有经过 Nginx 才成立的项（带哈希资源的 immutable 由 Nginx 下发，Node 只给 1h），
 *        无论何时都不判红，只告诉你"这条没经 Nginx 就别指望"。
 * 要按生产标准把 WARN 判红，加 --expect-prod。
 */
const EXPECT_PROD = process.argv.includes('--expect-prod');
const push = (name, ok, detail = '', level = 'FAIL') => {
  const state = ok ? 'PASS' : level === 'INFO' ? 'INFO' : level === 'WARN' && !EXPECT_PROD ? 'WARN' : 'FAIL';
  results.push({ name, ok: state !== 'FAIL', detail: String(detail).slice(0, 220), state });
  console.log(`${state}  ${name}${detail ? `  — ${String(detail).slice(0, 100)}` : ''}`);
};

async function call(method, urlPath, body, options = {}) {
  const headers = { 'user-agent': options.ua || BROWSER_UA };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (!options.noCookie && jar.cookie) headers.cookie = jar.cookie;
  if (options.csrf !== false && jar.csrf && method !== 'GET') headers['x-bw-csrf'] = jar.csrf;
  const res = await fetch(BASE + urlPath, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
  for (const c of res.headers.getSetCookie?.() || []) {
    const pair = c.split(';')[0];
    jar.cookie = jar.cookie ? `${jar.cookie.replace(/;?\s*/, '; ')}${pair}` : pair;
  }
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = null; }
  return { status: res.status, headers: res.headers, data, text };
}

console.log(`验收目标 ${BASE}${MUTATE ? '（含写链路）' : '（只读预演）'}\n`);

/* ---------- 1. 静态产物 ---------- */
const home = await call('GET', '/');
push('首页 200 且是 SPA 外壳（web/dist/ 挂对了）', home.status === 200 && /<div id="app">/.test(home.text), `status ${home.status} · ${home.text.length}B`);
const asset = (home.text.match(/\/assets\/[A-Za-z0-9._-]+\.js/) || [])[0];
push('入口 JS 取到（说明 dist 与 index.html 是同一批产物）', Boolean(asset), asset || 'index.html 里没引用 /assets/*.js（可能被别的缓存层改写）');
if (asset) {
  const one = await call('GET', asset);
  const cc = one.headers.get('cache-control') || '';
  push('静态资源 200', one.status === 200, `${one.status} · cache-control=${cc || '(未设)'}`);
  push(
    '带哈希的静态资源走长缓存 + immutable（只有经过 Nginx 才成立，直连 Node 时它是 1h）',
    /immutable/.test(cc),
    cc || '(未设)',
    'INFO'
  );
}

/* ---------- 2. 只读接口 ---------- */
const health = await call('GET', '/api/health');
push('服务健康', health.status === 200, `status ${health.status}`);

const list = await call('GET', '/api/posts?page=1&size=5');
const first = list.data?.items?.[0];
push('游客可读列表且有内容', list.status === 200 && (list.data?.items?.length || 0) > 0, `${list.data?.total} 条`);
push('列表含谣言与辟谣两主体', Boolean(first?.title && first?.excerpt), first?.title?.slice(0, 24) || '');
push('封面是带签名的短时效直链', /exp=.*sig=|sig=.*exp=/.test(first?.cover || ''), (first?.cover || '（无封面）').slice(0, 52));

if (first) {
  const detail = await call('GET', `/api/posts/${first.id}`);
  const post = detail.data?.post || detail.data;
  push('详情双栏对勘字段齐（rumor / verdict）', detail.status === 200 && Boolean(post?.rumor && post?.verdict), `status ${detail.status} · 字段 ${Object.keys(post || {}).slice(0, 8).join(',')}`);
  const revs = await call('GET', `/api/posts/${first.id}/revisions`);
  push('档案版本台账可读（出厂带建档快照）', revs.status === 200 && (revs.data?.items?.length || 0) >= 1, `${revs.data?.items?.length ?? 0} 版 / 保留 ${revs.data?.keep}`);
  if ((revs.data?.items?.length || 0) >= 1) {
    const a = revs.data.items[0].id;
    const diff = await call('GET', `/api/posts/${first.id}/revisions/diff?from=${a}&to=${a}`);
    push('同一版比对被明确拒绝而不是空转', diff.status === 400 || (diff.status === 200 && (diff.data?.fields?.length || 0) === 0), `status ${diff.status}`);
  }
}

const tags = await call('GET', '/api/tags');
push('话题索引可读', tags.status === 200 && (tags.data?.items?.length || 0) > 0, `${tags.data?.items?.length ?? 0} 个话题`);
const search = await call('GET', '/api/search?q=' + encodeURIComponent('食物相克'));
push('中文检索有命中（bigram 分词生效）', search.status === 200 && (search.data?.items?.length || 0) > 0, `${search.data?.items?.length ?? 0} 条命中`);
const resources = await call('GET', '/api/resources');
const resGroups = resources.data?.groups || [];
const resCount = resGroups.reduce((sum, g) => sum + (g.items?.length || 0), 0);
push('辟谣常用资源库游客可读（按分组下发）', resources.status === 200 && resCount > 0, `${resGroups.length} 组 / ${resCount} 条`);

const lib = await call('GET', '/api/library');
push('镜像目录公开且带演示册', lib.status === 200 && (lib.data?.items?.length || 0) >= 3, `${lib.data?.items?.length ?? 0} 册`);
const libRaw = JSON.stringify(lib.data || {});
push('公开目录不含磁盘文件名与口令', !/\.epub|\.pdf|roxy-guest/i.test(libRaw), '扫全响应体');
const readerOff = await call('GET', '/api/library/bseed1/reader?c=0');
push('未入预览白名单的书读正文被拒', readerOff.status === 403 || readerOff.status === 401, `status ${readerOff.status} · ${readerOff.data?.error?.code || ''}`);

/* ---------- 3. 防护是否真的开着 ---------- */
const anonWrite = await call('POST', '/api/posts', { title: 'x', rumor: 'y', verdict: 'z' }, { noCookie: true, csrf: false });
push('未登录写路径被拒', anonWrite.status === 401 || anonWrite.status === 403, `status ${anonWrite.status}`);
const anonOps = await call('GET', '/api/ops/media-report', undefined, { noCookie: true });
push('馆务台账需登录', anonOps.status === 401 || anonOps.status === 403, `status ${anonOps.status}`);
const anonLedger = await call('GET', '/api/ops/revisions', undefined, { noCookie: true });
push('版本台账总表需登录', anonLedger.status === 401 || anonLedger.status === 403, `status ${anonLedger.status}`);
const toolUa = await call('GET', '/api/posts?page=1&size=1', undefined, { ua: 'curl/8.4.0', noCookie: true });
push('脚本型 UA 被反爬门槛拒（防护开着）', toolUa.status === 403, `status ${toolUa.status} · ${toolUa.data?.error?.code || ''}`);
const deep = await call('GET', '/api/posts?page=99&size=5', undefined, { noCookie: true });
push('游客深翻页被门槛挡住（防批量抓取）', deep.status === 403 || deep.status === 400, `status ${deep.status} · ${deep.data?.error?.code || ''}`);
const csp = home.headers.get('content-security-policy') || '';
push(
  '生产 CSP 已下发（无 unsafe-inline）',
  /script-src[^;]*'self'/.test(csp) && !/unsafe-inline/.test(csp),
  csp.slice(0, 88) || '(没有 CSP 头——后端不是 NODE_ENV=production，或 CSP 被上游吃掉了)',
  'WARN'
);
/**
 * X-Robots-Tag 只承诺给**接口与资产**（本站正文页是希望被收录的，robots.txt 只挡后台路径）。
 * 所以这一条打在 /api/health 上判，不打在首页上——打在首页会永远红。
 */
const apiNoStore = await call('GET', '/api/health', undefined, { noCookie: true });
const robots = apiNoStore.headers.get('x-robots-tag') || '';
push(
  '接口响应带 X-Robots-Tag 且 no-store（不被公共缓存存走正文）',
  /noindex/.test(robots) && /no-store/.test(apiNoStore.headers.get('cache-control') || ''),
  `x-robots-tag=${robots || '(未设)'} · cache-control=${apiNoStore.headers.get('cache-control') || '(未设)'}`
);
const spoof = await call('GET', first ? `/api/media/${first.cover?.match(/\/api\/media\/([a-z0-9]+)/)?.[1] || 'nope'}?exp=9999999999&sig=deadbeef` : '/api/media/nope?exp=1&sig=1', undefined, { noCookie: true });
push('伪造签名直链被拒', spoof.status === 403 || spoof.status === 404, `status ${spoof.status}`);
const traversal = await call('GET', '/api/library/bseed2/asset?p=../library.json', undefined, { noCookie: true });
push('包内路径越界被拒', traversal.status === 400 || traversal.status === 403 || traversal.status === 404, `status ${traversal.status} · ${traversal.data?.error?.code || ''}`);

/* ---------- 4. 写链路（要显式开） ---------- */
if (!MUTATE) {
  console.log('\n（未跑写链路：加 --mutate --user/--pass 才会建档→修订→比对→置顶→删除，用完自清）');
} else {
  if (!USER || !PASS) {
    push('写链路需要 --user 与 --pass', false, '缺凭据（也可用环境变量 BW_ADMIN_USER / BW_ADMIN_PASS）');
  } else {
    const login = await call('POST', '/api/auth/login', { username: USER, password: PASS });
    jar.csrf = login.data?.csrfToken || '';
    push('管理员登录并取到 CSRF 令牌', login.status === 200 && Boolean(jar.csrf), `status ${login.status} · ${login.data?.user?.displayName || login.data?.error?.code || ''}`);
    const stamp = new Date().toISOString();
    const draft = {
      title: `部署验收自清条目 ${stamp.slice(0, 19)}`,
      tags: ['验收'],
      rumor: { html: '<p>验收用的假说法，跑完即删。</p>' },
      verdict: { html: '<p>验收用的判定，跑完即删。</p>' },
      sources: [{ title: '验收材料', org: '示例机构', collectedAt: stamp }],
      annotations: {},
      meta: { editor: '验收', level: '低', reviewAt: '2099-01-01' },
    };
    const created = await call('POST', '/api/posts', draft);
    const id = created.data?.post?.id;
    push('建档成功', created.status === 201 && Boolean(id), `status ${created.status} · ${id || JSON.stringify(created.data?.error || created.data?.message || '')}`);
    if (id) {
      const revised = await call('PUT', `/api/posts/${id}`, {
        ...draft,
        title: `${draft.title}（已修订）`,
        verdict: { html: '<p>验收用的判定，跑完即删。已复核一遍。</p>' },
      });
      push('修订成功', revised.status === 200, `status ${revised.status}`);
      const revs = await call('GET', `/api/posts/${id}/revisions`);
      const two = (revs.data?.items || []).slice(0, 2);
      push('版本台账累积到两版', two.length === 2, `${revs.data?.items?.length ?? 0} 版`);
      if (two.length === 2) {
        const diff = await call('GET', `/api/posts/${id}/revisions/diff?from=${two[1].id}&to=${two[0].id}`);
        const wordwise = (diff.data?.fields || []).find((f) => f.segments);
        push('两版比对给出词级增删', diff.status === 200 && (diff.data?.fields?.length || 0) > 0 && Boolean(wordwise), `字段 ${(diff.data?.fields || []).map((f) => f.key).join(',') || ''}`);
      }
      const pinned = await call('POST', `/api/posts/${id}/pin`, {});
      push('置顶可用（返回全局清单与被解除的原置顶）', pinned.status === 200 && Array.isArray(pinned.data?.list), pinned.data?.released ? `原置顶 ${pinned.data.released}` : '（此前无其他置顶）');
      const dead = await call('DELETE', `/api/posts/${id}`);
      push('删除自清成功', dead.status === 200 && dead.data?.ok === true, `status ${dead.status}`);
      const gone = await call('GET', `/api/posts/${id}`);
      push('删后详情 404（不留半死条目）', gone.status === 404, `status ${gone.status}`);
    }
    /* 审计是 120ms 缓冲落盘的（服务端为省 syscall 的取舍），所以读台账要给它追平的机会。
     * 但"有条数"不能当追平信号——只读阶段的 denied-client 会先落盘，此时登录与建档还在队列里。
     * 实测（09-30 解压回环）：一旦以"条数 > 0"提前 break，台账就只剩 denied-client，
     * 断言变成"看运气决定这一批刷了几行"，PASS 不是因真实原因通过。所以要等**两类事件都到齐**。 */
    const seen = (rows, re) => (rows || []).some((r) => re.test(r.key));
    let report = { status: 0, data: null };
    for (let attempt = 0; attempt < 20; attempt += 1) {
      report = await call('GET', '/api/ops/security-log?limit=5');
      const rows = report.data?.byEvent || [];
      if (seen(rows, /login/) && seen(rows, /post-/)) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    push(
      '馆务台账能读到本轮写链路的审计痕迹（登录与档案写操作都在）',
      report.status === 200 && (report.data?.totals?.entries || 0) > 0 && seen(report.data?.byEvent, /login/) && seen(report.data?.byEvent, /post-/),
      `${report.status} · ${report.data?.totals?.entries ?? 0} 条 / 事件 ${(report.data?.byEvent || []).map((r) => r.key).join(',')}`
    );
    /* 全站版本台账总表：登录后要能读，且只回表头不回快照（刚才删掉的那条应作为"已撤档"仍在册） */
    const ledger = await call('GET', '/api/ops/revisions?limit=50');
    const ledgerRaw = JSON.stringify(ledger.data || {});
    const orphan = id ? (ledger.data?.items || []).filter((r) => r.postId === id && r.alive === false) : [];
    push(
      '版本台账总表登录可读、只回表头、且撤档历史仍在册（标 alive=false）',
      ledger.status === 200 &&
        Number.isFinite(ledger.data?.totals?.bytes) &&
        Number.isFinite(ledger.data?.totals?.keep) &&
        !/snapshot|exp=|sig=/.test(ledgerRaw) &&
        orphan.length >= 1,
      `${ledger.status} · ${ledger.data?.totals?.entries ?? 0} 版 / 撤档本条 ${orphan.length} 行`
    );
  }
}

/* ---------- 5. 落盘报告 ---------- */
const failed = results.filter((r) => r.state === 'FAIL');
const warned = results.filter((r) => r.state === 'WARN');
const info = results.filter((r) => r.state === 'INFO');
const at = new Date().toISOString().replace(/[:.]/g, '-');
const here = path.dirname(fileURLToPath(import.meta.url));
const reportPath = path.join(here, `verify-report-${at}.md`);
const body = [
  `# 辨妄阁部署验收报告`,
  ``,
  `- 目标：\`${BASE}\``,
  `- 时刻：${new Date().toISOString()}`,
  `- 模式：${MUTATE ? '只读检查 + 写链路（已自清）' : '只读预演（未写任何东西）'}${EXPECT_PROD ? ' · 按生产标准判红' : ''}`,
  `- 结果：**${results.length - failed.length}/${results.length} 通过**${failed.length ? `，失败 ${failed.length} 项` : ''}${warned.length ? `，提醒 ${warned.length} 项` : ''}${info.length ? `，仅经 Nginx 才成立 ${info.length} 项` : ''}`,
  ``,
  `> 判读口径：**FAIL**＝站点真不通；**WARN**＝只在生产入口才要求（如 CSP），加 \`--expect-prod\` 会判红；`,
  `> **INFO**＝只有请求经过 Nginx 才成立的项（如 \`/assets/\` 的 immutable），永不判红。`,
  ``,
  `| 检查 | 结果 | 实测 |`,
  `| --- | --- | --- |`,
  ...results.map((r) => `| ${r.name} | ${r.state === 'PASS' ? 'PASS' : `**${r.state}**`} | ${r.detail.replace(/\|/g, '\\|') || '—'} |`),
  ``,
  failed.length ? '## 失败项怎么读\n\n' + failed.map((r) => `- **${r.name}** — ${r.detail}`).join('\n') : '没有失败项。',
  warned.length ? `\n## 提醒项（只在该站点应按生产标准时才必须满足）\n\n` + warned.map((r) => `- **${r.name}** — ${r.detail}`).join('\n') : '',
  info.length ? `\n## 仅经 Nginx 才成立的项（说明这次请求是直连后端的）\n\n` + info.map((r) => `- **${r.name}** — ${r.detail}`).join('\n') : '',
  ``,
  `> 只读项失败通常是配置问题（CSP 缺失＝NODE_ENV 不是 production；反爬项失败＝BW_ALLOW_TOOL_UA 被开了）。`,
  `> 写链路项失败通常是凭据或 CSRF 令牌问题；跑完会自动删除建档，不留残余。`,
  ``,
].join('\n');
fs.writeFileSync(reportPath, body, 'utf8');
console.log(`\n合计 ${results.length} 项，失败 ${failed.length} 项，提醒 ${warned.length} 项，INFO ${info.length} 项。报告：${reportPath}`);
process.exit(failed.length ? 1 : 0);
