#!/usr/bin/env node
/**
 * 打包"解压即可放到 Nginx 上跑"的部署包。
 *
 * 为什么要有这个脚本而不是手工 cp：部署包的内容边界是**安全边界**，不是随便打个 zip——
 * `data/.secret`（会话与全部签名的密钥）、`sessions.json`（活着的会话）、
 * `security.log`（含来源 IP 与口令标签）、`login-attempts.json`（锁定计数）
 * 这四样**绝对不能进包**；`web/dist/` 里含编译后的 CKEditor（GPL），所以要随包放许可说明。
 * 默认只**预演**（列出去向、不写一个字节）；`--write` 才落盘，`--zip` 才压缩。
 *
 * 用法：
 *   node scripts/make-nginx-package.mjs            # 预演
 *   node scripts/make-nginx-package.mjs --write    # 生成 outputs/package/<name>/
 *   node scripts/make-nginx-package.mjs --write --zip   # 再压成 <name>.zip
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const NAME = `bianwang-${VERSION}-nginx`;
const STAGE = path.join(ROOT, 'outputs', 'package', NAME);
const ZIP = path.join(ROOT, 'outputs', 'package', `${NAME}.zip`);

const WRITE = process.argv.includes('--write');
const ZIP_IT = process.argv.includes('--zip');

/** 绝不进包的东西：密钥、活会话、审计日志、锁定计数，以及本机跑出来的验收报告（含来源 IP 与路径） */
const FORBIDDEN = new Set(['.secret', 'sessions.json', 'security.log', 'login-attempts.json', '口令.txt', '.bianwang-deps-probe.mjs']);
const FORBIDDEN_PATTERNS = [/^verify-report-.*\.md$/];
const norm = (p) => path.basename(p).replace(/^security\.log.*/, 'security.log');
/**
 * pnpm deploy 会在 `.pnpm/node_modules/` 里留一条指回**工作区包本身**的链接（`…/server`）。
 * 解引用复制时它会把整个仓库 server/（含 `.secret`、开发期 users.csv、真实数据）灌进部署包。
 * 这条必须按路径挡掉，而不是靠下面的文件名黑名单。
 */
const WORKSPACE_SELF_LINK = /[\\/]node_modules[\\/]\.pnpm[\\/]node_modules[\\/]server$/;
const forbidden = (p) => {
  if (WORKSPACE_SELF_LINK.test(p)) return true;
  const base = norm(p);
  return FORBIDDEN.has(base) || FORBIDDEN_PATTERNS.some((re) => re.test(base));
};

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function walk(dir, base = dir, out = [], keepForbidden = false) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(base, full).replaceAll(path.sep, '/');
    if (!keepForbidden && forbidden(full)) continue;
    // pnpm 的 node_modules 里满是"指向目录的符号链接"：Dirent.isDirectory() 对软链返回 false，
    // 不跟着 stat 走就会把目录当文件去读（EISDIR），清单也会漏掉一半内容
    const isDir = entry.isDirectory() || (entry.isSymbolicLink() && fs.statSync(full).isDirectory());
    if (isDir) walk(full, base, out, keepForbidden);
    else out.push(rel);
  }
  return out;
}

const DOCS = ['README.md', 'DEPLOY.md', 'DEVELOPMENT.md', 'THIRD_PARTY_NOTICES.md', 'USAGE.md'];
// 仪表盘只带源码与脚本；exe 由 install.cmd 在目标机用自带 csc.exe 现编
const DASHBOARD_FILES = ['Dashboard.cs', 'build.cmd', 'install.cmd', 'uninstall.cmd'];

/**
 * 后端运行时**每次打包现做**，不复用旧产物。
 * 理由很实在：上一轮的解压回环里，包内 `api/src/index.js` 还是修复前的版本——
 * 因为 `.api-deploy` 是更早 `pnpm deploy` 的快照，改了源码也不会自己变。
 * 派生缓存的坑本站已经踩过一次（数据代次），这里同理：**能被现做的东西就不要留快照**。
 */
const API_SRC = path.join(ROOT, 'outputs', 'package', '.api-deploy');

const plan = [
  { to: 'web/dist', from: path.join(ROOT, 'web', 'dist'), kind: '前端产物：Nginx 的 root 指这里；后端在没有 Nginx 时也会按 api/../../web/dist 自己伺服（便于单机自测）' },
  { to: 'api', from: API_SRC, deployed: true, kind: '后端运行时（pnpm deploy --legacy --prod 现做；复制时解引用成实体目录，压缩包里不留符号链接）' },
  { to: 'nginx', from: path.join(ROOT, 'nginx'), kind: 'Nginx 站点与安全片段' },
  { to: 'docs', from: ROOT, kind: '五份文档（README / DEPLOY / DEVELOPMENT / THIRD_PARTY_NOTICES / USAGE）', picks: DOCS },
  { to: 'ops', from: path.join(ROOT, 'ops-extras'), kind: '起停与验收脚本、环境变量样例、systemd/任务计划样例' },
  // 只放源码与 build/install 脚本，不放编译好的 exe：预置二进制会和 api/ 一样有"带上旧快照"的风险，
  // 而 install.cmd 在目标机上用系统自带的 csc.exe 现编一次只要 1 秒。
  { to: 'dashboard', from: path.join(ROOT, 'dashboard'), kind: 'Windows 仪表盘源码与 build/install 脚本（exe 在目标机现编，不预置二进制）', picks: DASHBOARD_FILES },
];


console.log(`打包目标 ${NAME}`);
for (const item of plan) {
  if (item.deployed) {
    console.log(`  ${item.to}/  ←  将由 pnpm --filter server deploy --legacy --prod 现做（${item.kind}）`);
    continue;
  }
  if (!fs.existsSync(item.from)) {
    console.log(`  ✗ ${item.to} 源不存在：${item.from}`);
    process.exitCode = 1;
    continue;
  }
  const rels = item.picks ? item.picks : walk(item.from);
  const bytes = rels.reduce((sum, rel) => sum + fs.statSync(path.join(item.from, rel)).size, 0);
  console.log(`  ${item.to}/  ←  ${rels.length} 个文件 / ${(bytes / 1048576).toFixed(1)} MB · ${item.kind}`);
  if (item.picks) {
    const missing = rels.filter((rel) => !fs.existsSync(path.join(item.from, rel)));
    if (missing.length) {
      console.log(`     ✗ 缺文档：${missing.join(', ')}`);
      process.exitCode = 1;
    }
  }
  const blocked = item.picks ? [] : walk(item.from, item.from, [], true).filter((rel) => forbidden(rel));
  if (blocked.length) console.log(`     已挡在包外（不该进包的运行态）：${blocked.join(', ')}`);
}

if (!WRITE) {
  console.log('\n预演结束：未写入任何文件。要落盘请加 --write（可再加 --zip）。');
  process.exit(process.exitCode || 0);
}

/* ---------- 落盘 ---------- */

fs.rmSync(STAGE, { recursive: true, force: true });
fs.mkdirSync(STAGE, { recursive: true });

/** 现做后端运行时：pnpm 的 legacy deploy 要求目标目录为空，所以先清掉自己上轮生成的那份 */
fs.rmSync(API_SRC, { recursive: true, force: true });
const deploy = spawnSync(
  'pnpm',
  ['--filter', 'server', 'deploy', '--legacy', '--prod', path.relative(ROOT, API_SRC).replaceAll('\\', '/')],
  { cwd: ROOT, encoding: 'utf8', shell: true }
);
if (deploy.status !== 0) {
  console.error((deploy.stdout || '') + (deploy.stderr || ''));
  console.error('✗ pnpm deploy 没过，包不做（宁可不出，也不出一个来源不明的 api/）');
  process.exit(1);
}
if (!fs.existsSync(path.join(API_SRC, 'node_modules'))) {
  console.error('✗ deploy 声称成功，但产物里没有 node_modules');
  process.exit(1);
}
console.log(`现做 api 运行时：${path.relative(ROOT, API_SRC)}（deploy exit ${deploy.status}）`);

for (const item of plan) {
  if (item.picks) {
    fs.mkdirSync(path.join(STAGE, item.to), { recursive: true });
    for (const rel of item.picks) fs.copyFileSync(path.join(item.from, rel), path.join(STAGE, item.to, rel));
    continue;
  }
  fs.cpSync(item.from, path.join(STAGE, item.to), {
    recursive: true,
    // pnpm 的 node_modules 是指向 .pnpm 仓库的符号链接农场：不解引用的话，
    // zip 里会留一堆指向部署机上不存在路径的链接，且同一份内容被重复收两遍
    dereference: true,
    force: true,
    filter: (source) => !forbidden(source),
  });
}

/* 后端的数据目录**整目录清空后重新播种**：
 * 只删"运行态四件"不够——开发期经界面上传的图片、`.gitkeep` 之外的残留会一起进包，
 * 而包里应当只有与 `pnpm seed` 完全一致的出厂态。 */
const apiData = path.join(STAGE, 'api', 'data');
fs.rmSync(apiData, { recursive: true, force: true });
const seed = spawnSync(process.execPath, ['scripts/reseed.js'], {
  cwd: path.join(STAGE, 'api'),
  encoding: 'utf8',
  env: { ...process.env, BW_DATA_DIR: apiData },
});
console.log(`包内 reseed：exit ${seed.status} / ${(seed.stdout || '').trim().slice(0, 60)}…`);
if (seed.status !== 0) {
  console.error(seed.stderr);
  process.exit(1);
}

/**
 * reseed 会顺带触发 persistentSecret()，在 data/ 下写下 .secret —— 那正是最不该进包的东西
 * （它同时是会话、图片直链与镜像口令令牌三套签名的主密钥）。
 * 清掉它，让部署机首启各自生成；清单与校验值必须在这一步之后再生成，否则哈希表里还留着它。
 */
const leakedSecret = path.join(apiData, '.secret');
if (fs.existsSync(leakedSecret)) {
  fs.rmSync(leakedSecret, { force: true });
  console.log('已删除 reseed 顺带生成的 api/data/.secret（部署机首启各自生成）');
}
const stillThere = [];
const scanSecrets = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) scanSecrets(full);
    else if (forbidden(full)) stillThere.push(path.relative(STAGE, full));
  }
};
scanSecrets(STAGE);
if (stillThere.length) {
  console.error(`包内仍有运行态文件，拒绝出包：${stillThere.join(', ')}`);
  process.exit(1);
}

/* 守卫与许可再生：包里的依赖必须与本机验证过的完全一致 */
const guard = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'pin-guard.mjs')], { cwd: ROOT, encoding: 'utf8' });
console.log(`依赖守卫：${(guard.stdout || guard.stderr).trim().split('\n')[0]}`);
if (guard.status !== 0) {
  console.error('依赖守卫没过，包不做。');
  process.exit(1);
}

const pnpmDir = path.join(ROOT, 'node_modules', '.pnpm');
const ckeditorDir = fs
  .readdirSync(pnpmDir)
  .find((name) => /^ckeditor5@/.test(name));
const found = ckeditorDir
  ? path.join(pnpmDir, ckeditorDir, 'node_modules', 'ckeditor5', 'COPYING.GPL')
  : '';
if (found && fs.existsSync(found)) fs.copyFileSync(found, path.join(STAGE, 'LICENSE-CKEDITOR-COPYING.GPL'));
else console.log('[!] 没找到 ckeditor5 包内的 COPYING.GPL，请手工确认 GPL 文本是否随包');

fs.writeFileSync(
  path.join(STAGE, 'LICENSE-NOTE.txt'),
  `本包许可提示（务必读一遍）
----------------------------------------------------------------
1. \`web/dist/\` 内含**编译后的 CKEditor 5**（ckeditor5@48.5.2，GPL-2.0-or-later 免费档，
   配置里显式 licenseKey: 'GPL'）。GPL 的义务由**分发**触发：
   - 自用服务器部署、只在自家站点使用：不构成对外分发，随包保留本提示与
     LICENSE-CKEDITOR-COPYING.GPL 即可；
   - 把本包**交给第三方**（含公开下载、发给合作方、开源整站）：整份前端源码
     （web/src/，含本站自定义插件 editor/yan-markup.js）须按 GPL-2.0-or-later 一并释出。
   另一条路是向 CKSource 购买商业许可，届时可去掉这条义务。
2. dompurify 为 MPL-2.0 **或** Apache-2.0 双许可，本站按 Apache-2.0 使用，不受 copyleft 传染。
3. 其余依赖全部宽松许可（MIT / Apache-2.0 / BSD / ISC）。逐包许可与出处见
   docs/THIRD_PARTY_NOTICES.md 与站点页脚「框架与开源协议」表（由已安装包实测生成）。
4. 演示数据全部自产：档案正文为本次自写的说明性样例，不构成事实核查结论；
   三本演示册（两本 EPUB、一本 PDF）由 api/scripts/ 下的生成器现场产出。
   镜像站只伺服馆员自行放入 api/data/library/ 的文件——**不代抓网盘、不收录受版权保护作品**。
5. data/ 里的出厂口令（admin/admin、demo/demo-pass、镜像口令 roxy-guest）只是需求指定的
   占位值。公网部署第一步就是改密，并按 DEPLOY.md 打开 BW_HASH_PASSWORDS=1。
`,
  'utf8'
);

fs.writeFileSync(
  path.join(STAGE, 'README-FIRST.md'),
  `# 辨妄阁 · 解压即用（三步）

本包已经是构建好的产物，**不需要**在部署机上跑 pnpm build：

| 目录 | 是什么 |
| --- | --- |
| \`web/dist/\` | 前端产物，直接作为 Nginx 的 \`root\`（后端在没有 Nginx 时也会按 \`api/../web/dist\` 自己伺服，方便单机先点一遍） |
| \`api/\` | Node 后端（含 \`node_modules\`，只有生产依赖）；数据在 \`api/data/\` |
| \`nginx/\` | 站点配置与安全片段 |
| \`ops/\` | 环境变量样例、systemd / 任务计划样例、起停与**验收脚本** |
| \`docs/\` | README / DEPLOY / DEVELOPMENT / THIRD_PARTY_NOTICES |

## 1. 起后端

\`\`\`bash
# Linux（生产：systemd 托管）
cp ops/env.example /etc/bianwang.env     # 改 BW_SECRET、BW_DATA_DIR
sudo cp -r web api /srv/bianwang/ && sudo systemctl start bianwang
# Linux（先手工点一遍）
sh ops/start-api.sh
# Windows
ops\\start-api.cmd                        # 用系统 Node 直接起，日志落 ops\\api.log
\`\`\`

后端只监听 \`127.0.0.1:8787\`，**不要**把它暴露到公网。此时 \`http://127.0.0.1:8787\` 已能整站自访
（后端自己伺服 \`web/dist\`），可以先跑验收再配 Nginx。

## 2. 起 Nginx

把 \`nginx/bianwang.conf\` 里的 \`root\` 指到本包的 \`web/dist\`（或按 DEPLOY.md 拷到
\`/var/www/bianwang/dist\`），\`bianwang-proxy.inc\` 放到 \`/etc/nginx/\`，然后 \`nginx -t && nginx -s reload\`。

## 3. 验收（默认只读，不改任何东西）

\`\`\`bash
node ops/verify-deploy.mjs http://127.0.0.1        # 走 Nginx 的入口判
node ops/verify-deploy.mjs http://127.0.0.1 --expect-prod   # 把 CSP / 长缓存等项从"提醒"升级为"判红"
node ops/verify-deploy.mjs http://127.0.0.1:8787 --mutate --user admin --pass '改过的口令'  # 直连后端，含写链路
\`\`\`

它会逐条核对：健康检查、列表与详情、检索、话题、资源库、镜像目录与预览白名单、签名直链、
版本台账、馆务台账、未登录写路径被拒、脚本型 UA 被反爬拒、游客深翻页被挡、伪造签名被拒、
包内路径越界被拒。**默认只读**；要看写链路（建档→修订→比对→置顶→删除，跑完自清）加 \`--mutate\`。
报告落盘在 \`ops/verify-report-<时间戳>.md\`（含每项实测值）。

三项判红说明：
- 没有 CSP 头 → 后端不是 \`NODE_ENV=production\`（直连 8787 且未设时属正常，故默认记 WARN）；
- \`/assets/\` 没有 \`immutable\` → 请求没经过 Nginx（Node 自己只给 1h），同样记 WARN；
- 接口没有 \`X-Robots-Tag\` / \`no-store\` → Nginx 片段的 \`location /api/\` 没生效，**这是真问题**。
  正文页刻意**不**加 noindex（本站是要被检索到的），robots 头只承诺给接口与资产。

## 必做的安全收口（DEPLOY.md §四）

1. 改默认口令（登录 → 用户名册 → 同名提交即改密）。
2. \`BW_HASH_PASSWORDS=1\` 后再改一次密码，让 CSV 存 scrypt 摘要。
3. 确认 \`api/data/\` 不在 Nginx 的 web root 下（配置片段已 deny，但别把它拷进 web root 目录）。
4. 需要长期留存审计日志时，把 \`api/data/security.log\`（含轮转份）纳入备份轮转。
`,
  'utf8'
);

/* ---------- 清单与校验值 ---------- */

const allFiles = walk(STAGE);
const lines = [];
let nodeModulesBytes = 0;
let nodeModulesCount = 0;
const nmHash = crypto.createHash('sha256');
for (const rel of allFiles) {
  const full = path.join(STAGE, rel);
  const size = fs.statSync(full).size;
  if (rel.startsWith('api/node_modules/')) {
    nodeModulesCount += 1;
    nodeModulesBytes += size;
    nmHash.update(`${rel}\u0000${sha256(full)}\n`);
    continue;
  }
  lines.push(`${sha256(full)}  ${rel}`);
}
lines.push(`${nmHash.digest('hex')}  api/node_modules〔聚合：${nodeModulesCount} 个文件 / ${(nodeModulesBytes / 1048576).toFixed(1)} MB，逐个内容参与〕`);
fs.writeFileSync(path.join(STAGE, 'SHA256SUMS.txt'), `${lines.join('\n')}\n`, 'utf8');

const topRows = plan.map((item) => {
  const dir = item.to;
  const files = allFiles.filter((f) => f.startsWith(`${dir}/`));
  const bytes = files.reduce((sum, f) => sum + fs.statSync(path.join(STAGE, f)).size, 0);
  return `| \`${dir}/\` | ${files.length} | ${(bytes / 1048576).toFixed(1)} MB | ${item.kind} |`;
});
const loose = allFiles.filter((f) => !f.includes('/'));
const looseBytes = loose.reduce((sum, f) => sum + fs.statSync(path.join(STAGE, f)).size, 0);

fs.writeFileSync(
  path.join(STAGE, 'MANIFEST.md'),
  `# 包内容清单 · ${NAME}

生成时刻：${new Date().toISOString()} · 版本 ${VERSION} · 依赖守卫 ${guard.stdout.trim().split('\n')[0]}

| 目录 | 文件数 | 体积 | 用途 |
| --- | --- | --- | --- |
${topRows.join('\n')}
| 根目录零散文件 | ${loose.length} | ${(looseBytes / 1024).toFixed(1)} KB | README-FIRST / LICENSE 提示 / 清单与校验值 |

## 刻意没打进包的东西

| 名称 | 为什么 |
| --- | --- |
| \`api/data/.secret\` | 会话与**全部签名**（图片直链、镜像口令令牌、CSRF）的密钥。带上它等于把所有部署机的密钥变成同一个，且在仓库里躺过就不算秘密。后端首启会自动重新生成（0600） |
| \`api/data/sessions.json\` | 本机开发期间**活着的会话** |
| \`api/data/security.log\`（含轮转份） | 开发期的来源 IP、口令标签、失败记录 |
| \`api/data/login-attempts.json\` | 开发期的锁定计数 |
| \`web/node_modules\`、\`node_modules\`（开发依赖） | 部署机不需要构建工具链；\`api/node_modules\` 只含生产依赖（\`pnpm deploy --prod\` 的产物） |
| \`web/src/\`、\`server/src/\` 的源码包 | 前端源码属另一件事：需要它请按 LICENSE-NOTE.txt 第 1 条走（GPL 分发义务） |
| 走查截图、隔离测试数据 | 开发过程的产物 |

## 校验

\`\`\`bash
# 顶层零散件与 web/dist/、docs/、ops/、nginx/、api 源码逐个 sha256；
# api/node_modules 用一行聚合值（内容参与哈希，列在 SHA256SUMS.txt 末行）
sha256sum -c SHA256SUMS.txt          # Linux（聚合行请手工比对）
Get-FileHash -Algorithm SHA256 …     # Windows
\`\`\`
`,
  'utf8'
);

console.log(`\n已写入 ${STAGE}`);
console.log(`  共 ${allFiles.length} 个文件 + 清单/校验值`);

/**
 * legacy deploy 会改动工作区的安装状态（实测：之后跑 `pnpm --filter server seed` 会要求重建
 * node_modules 并在无 TTY 下直接失败）。打包是一次动作，不该把开发库留在"下一步就报错"的状态，
 * 所以收尾将 workspace 装回 lockfile 描述的样子。
 */
const restore = spawnSync('pnpm', ['install'], {
  cwd: ROOT,
  encoding: 'utf8',
  shell: true,
  env: { ...process.env, CI: 'true' },
});
console.log(`工作区状态复位：exit ${restore.status} / ${(restore.stdout || '').trim().split('\n').slice(-1)[0] ?? ''}`);

/* ---------- 压缩 ---------- */
if (ZIP_IT) {
  fs.rmSync(ZIP, { force: true });
  const zip = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
      `Compress-Archive -LiteralPath '${STAGE.replaceAll("'", "''")}' -DestinationPath '${ZIP.replaceAll("'", "''")}' -Force`],
    { encoding: 'utf8' }
  );
  if (zip.status !== 0) {
    console.error(zip.stderr);
    process.exit(1);
  }
  const bytes = fs.statSync(ZIP).size;
  console.log(`已压缩 ${ZIP}`);
  console.log(`  ${(bytes / 1048576).toFixed(1)} MB · sha256 ${sha256(ZIP)}`);
}
