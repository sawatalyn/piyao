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
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
/**
 * 这一版产物是**站点树**（`bianwang-<版本>-nginx`）：Linux / Nginx 路线直接用它，
 * Windows 路线把它当**输入**——`make-offline-package.mjs` 在它上面铺随带运行时再打成单个 exe。
 * 包内零 `.exe`（仪表盘由目标机现编），所以这棵树本身在 Windows 上要能起站就得 PATH 上有 Node ≥ 20.19.0；
 * "什么都不用装"的那一档在离线包里，不在这里（见 DEPLOY.md §一）。
 */
const NAME = `bianwang-${VERSION}-nginx`;
const STAGE = path.join(ROOT, 'outputs', 'package', NAME);
const ZIP = path.join(ROOT, 'outputs', 'package', `${NAME}.zip`);

const WRITE = process.argv.includes('--write');
const ZIP_IT = process.argv.includes('--zip');

/** 绝不进包的东西：密钥、活会话、审计日志、锁定计数，以及本机跑出来的验收报告（含来源 IP 与路径） */
const FORBIDDEN = new Set(['.secret', 'sessions.json', 'security.log', 'login-attempts.json', '口令.txt', '.bianwang-deps-probe.mjs', 'port.txt', 'run-site.log']);
const FORBIDDEN_PATTERNS = [/^verify-report-.*\.md$/, /\.exe$/i];
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
  { to: 'api', from: API_SRC, deployed: true, kind: '后端运行时（pnpm deploy --legacy --prod --config.node-linker=hoisted 现做：依赖平铺成实体目录、零软链接，拷到别的机器也能起）' },
  { to: 'nginx', from: path.join(ROOT, 'nginx'), kind: 'Nginx 站点与安全片段' },
  { to: 'docs', from: ROOT, kind: '五份文档（README / DEPLOY / DEVELOPMENT / THIRD_PARTY_NOTICES / USAGE）', picks: DOCS },
  { to: 'ops', from: path.join(ROOT, 'ops-extras'), kind: '起停与验收脚本、环境变量样例、systemd/任务计划样例' },
  // 只放源码与 build/install 脚本，不放编译好的 exe：预置二进制会和 api/ 一样有"带上旧快照"的风险，
  // 而 install.cmd 在目标机上用系统自带的 csc.exe 现编一次只要 1 秒。
  { to: 'dashboard', from: path.join(ROOT, 'dashboard'), kind: 'Windows 仪表盘源码与 build/install 脚本（exe 在目标机现编，不预置二进制）', picks: DASHBOARD_FILES },
  { to: 'installer', from: path.join(ROOT, 'installer'), kind: '一键安装包：环境检测/装/更新、部署、开机自启、卸载（脚本必须 CRLF + 纯 ASCII，见下面硬校验）' },
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

/**
 * 现做后端运行时：pnpm 的 legacy deploy 要求目标目录为空，所以先清掉自己上轮生成的那份。
 *
 * `--config.node-linker=hoisted` 不是可选优化，是**必需**：默认的 isolated 链接器把每个包的
 * 兄弟依赖放在 `node_modules/.pnpm/<pkg>@<ver>/node_modules/` 里，顶层条目全是指向那里的软链接。
 * 而软链接进 zip 要么丢、要么在解压机上指向不存在的路径，所以下面复制时必须解引用；
 * 一解引用，顶层 `<pkg>/` 就成了离开 `.pnpm` 的实体目录，它 import 自己的依赖时
 * 沿目录上溯再也碰不到那些兄弟——express-rate-limit 找不到 ip-address，
 * Node 撑到 import 阶段才炸 `ERR_MODULE_NOT_FOUND`。
 * hoisted 直接把整棵树平铺成实体目录（实测 0 条软链接、96 个顶层包），拷机拷得动。
 */
fs.rmSync(API_SRC, { recursive: true, force: true });
const deploy = spawnSync(
  'pnpm',
  ['--filter', 'server', 'deploy', '--legacy', '--prod', '--config.node-linker=hoisted',
    path.relative(ROOT, API_SRC).replaceAll('\\', '/')],
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
    // api/ 已经是 hoisted 平铺（下面数过软链接条数，留一条就判红）；
    // 这里仍留解引用当保险：万一哪天依赖又长出软链接，宁可解成实体也不要在 zip 里留断链
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

/**
 * ============ 孤立自足性硬校验 ============
 * 这一步是上一版漏掉的，直接导致发出去的包在别人机器上起不来（v1.0.0 实测事故）：
 * 包就落在 `outputs/` 下，而**仓库根的 `node_modules/.pnpm` 正好是它的祖先目录**；
 * Node 解析裸标识符时沿目录一层层上溯找 `node_modules`，于是把包里没有的依赖"借"了回来，
 * 本机验收全绿；同一份东西拷到没有那层农场的机器上，撑到 import 阶段炸
 * `ERR_MODULE_NOT_FOUND: Cannot find package 'ip-address'`。
 * 所以校验必须把包里这份 api/ 拷到**祖先路径里一层 node_modules 都没有**的路径，真起一次进程。
 */
function countSymlinks(dir) {
  let n = 0;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.isSymbolicLink()) n += 1;
      else if (e.isDirectory()) stack.push(path.join(d, e.name));
    }
  }
  return n;
}

function firstNodeModulesAncestor(startDir) {
  let d = path.resolve(startDir);
  for (;;) {
    const parent = path.dirname(d);
    if (parent === d) return null;
    const nm = path.join(parent, 'node_modules');
    if (fs.existsSync(nm)) return nm;
    d = parent;
  }
}

const apiNmLinks = countSymlinks(path.join(STAGE, 'api', 'node_modules'));
console.log(`api/node_modules 软链接条数：${apiNmLinks}（hoisted 平铺应为 0）`);
if (apiNmLinks > 0) {
  console.error(`✗ 依赖没平铺干净：还剩 ${apiNmLinks} 条软链接。解引用会把顶层包从它的兄弟依赖旁摘走，包不做。`);
  process.exit(1);
}

const isoRoot = path.join(os.tmpdir(), `bianwang-isocheck-${Date.now()}`);
const rescue = firstNodeModulesAncestor(isoRoot);
if (rescue) {
  console.error(`✗ 孤立校验做不了：${isoRoot} 的祖先路径上已有 node_modules（${rescue}）——在它下面跑会把缺的依赖借来，结果不可信。`);
  process.exit(1);
}
fs.cpSync(path.join(STAGE, 'api'), path.join(isoRoot, 'api'), { recursive: true, force: true, dereference: true });

const isoPort = await new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.on('error', reject);
  probe.listen(0, '127.0.0.1', () => {
    const p = probe.address().port;
    probe.close(() => resolve(p));
  });
});

const child = spawn(process.execPath, ['src/index.js'], {
  cwd: path.join(isoRoot, 'api'),
  encoding: 'utf8',
  env: { ...process.env, BW_PORT: String(isoPort), BW_CRED_FILE: '0', NODE_ENV: 'production' },
});
let isoOut = '';
const isoVerdict = await new Promise((resolve) => {
  const timer = setTimeout(() => resolve('timeout'), 30000);
  const grab = (buf) => {
    isoOut += String(buf);
    if (isoOut.includes('辨妄阁 API 已启动')) {
      clearTimeout(timer);
      resolve('started');
    }
  };
  child.stdout.on('data', grab);
  child.stderr.on('data', grab);
  child.on('exit', (code) => {
    clearTimeout(timer);
    resolve(isoOut.includes('ERR_MODULE_NOT_FOUND') ? 'missing-module' : `exited-${code}`);
  });
});

let isoHttp = 0;
let isoItems = 0;
if (isoVerdict === 'started') {
  try {
    const res = await fetch(`http://127.0.0.1:${isoPort}/api/menu`, {
      headers: { 'user-agent': 'Mozilla/5.0 (bianwang-isocheck)' },
    });
    isoHttp = res.status;
    const body = await res.json().catch(() => null);
    isoItems = Array.isArray(body?.items) ? body.items.length : 0;
  } catch (err) {
    isoOut += `\n[isocheck] fetch 失败：${err?.message ?? err}`;
  }
}
child.kill();
for (let i = 0; i < 6; i += 1) {
  try {
    fs.rmSync(isoRoot, { recursive: true, force: true });
    break;
  } catch {
    await new Promise((r) => setTimeout(r, 500));
  }
}

if (isoVerdict !== 'started' || isoHttp !== 200 || isoItems === 0) {
  console.error(`✗ 包内 api/ 在仓库外起不来（${isoVerdict} / GET /api/menu → ${isoHttp} / 菜单 ${isoItems} 项），包不做。`);
  console.error(isoOut.slice(0, 1500));
  process.exit(1);
}
console.log(`孤立自足性校验：${isoVerdict} · GET /api/menu → ${isoHttp}（${isoItems} 项）· 端口 ${isoPort} · 临时目录已清理`);

/**
 * ============ 批处理硬校验：必须 CRLF、必须纯 ASCII ============
 * cmd.exe 按**机器 OEM 代码页**逐行解析 .cmd，两条都不是"不好看"而是"在别人机器上跑不起来"：
 *   LF-only   → 每行行首被吃掉一个字符（实测把 `setlocal` 读成 `local`、`else` 读成 `lse`）；
 *   非 ASCII  → 中文按代码页映射成乱码，路径和 robocopy 的 /XF 参数直接失效
 *               （`/XF 口令.txt` 解出来是一串问号，那个文件照抄进包）。
 * 本机 Git Bash 里两种都能跑，所以这一步只能靠字节判断，不能靠"我这边试过了"。
 */
const batchProblems = [];
const scanBatch = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      scanBatch(full);
      continue;
    }
    if (!/\.(cmd|bat)$/i.test(e.name)) continue;
    const bytes = fs.readFileSync(full);
    let bareLf = 0;
    let high = 0;
    for (let i = 0; i < bytes.length; i += 1) {
      if (bytes[i] === 0x0a && (i === 0 || bytes[i - 1] !== 0x0d)) bareLf += 1;
      if (bytes[i] > 0x7f) high += 1;
    }
    if (bareLf || high) {
      batchProblems.push(`${path.relative(STAGE, full)}（LF-only 行数 ${bareLf} / 非 ASCII 字节 ${high}）`);
    }
  }
};
scanBatch(STAGE);
if (batchProblems.length) {
  console.error(`✗ 批处理脚本不合格，包不做（cmd.exe 会吃行首字符或把中文读成乱码）：`);
  for (const p of batchProblems) console.error(`    ${p}`);
  process.exit(1);
}
console.log('批处理校验：包内所有 .cmd/.bat 均为 CRLF 且纯 ASCII');

/**
 * ============ 包内可执行文件：站点树一条都不许有 ============
 * 仪表盘在目标机现编（`Dashboard.cs` + `build.cmd`）。
 * 冻结一份来历不明的 exe 出去，就等于把改动之前的快照当成制品分发（A-6/A-11 同一类错误）。
 * 离线包形态另有一套白名单（`make-offline-package.mjs`：只允许 `runtime\` 那一套 Electron），
 * 但那道闸管的是**它自己那一层**，站点这半永远必须是零 exe。
 */
const foundExe = [];
const scanExe = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== 'node_modules') scanExe(full);
      continue;
    }
    if (/\.exe$/i.test(e.name)) foundExe.push(path.relative(STAGE, full).replace(/\\/g, '/'));
  }
};
scanExe(STAGE);
if (foundExe.length) {
  console.error(`✗ 包内出现 ${foundExe.length} 个 .exe，包不做（站点树这半一律零 exe）：`);
  for (const p of foundExe) console.error(`    ${p}`);
  console.error('  注：随包运行时属于离线包那一层（make-offline-package.mjs），不在这棵站点树里。');
  process.exit(1);
}
console.log('二进制校验：包内零 .exe（仪表盘由 build.cmd 现编；随带运行时在离线包那一层加）');

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

> **Windows 一键安装**：这棵树**不含随带运行时**，所以在 Windows 上起站需要机器上有 Node ≥ 20.19.0：
> 要么用离线包（\`bianwang-<版本>-offline-win.exe\`，自带运行时、装机机什么都不用装），
> 要么在这里跑 \`installer\\setup.cmd /cli\`（走 PATH 上的 \`node\`，低于 20.19.0 会拒绝起站而不是硬跑）。
> \`installer\\setup.cmd\` 不带 \`/cli\` 时要开图形界面需要 \`runtime\\BianwangRuntime.exe\`（只有离线包里有）。

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
allFiles.sort();
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
// 聚合行写成注释：它不是一个"文件"，若按 `hash  路径` 的格式出现，`sha256sum -c` 会把整包
// 判成失败（"api/node_modules〔聚合…〕: FAILED open or read"），交付时那条红字比缺这一行更坑。
lines.push(`# api/node_modules 聚合摘要：${nmHash.digest('hex')}（${nodeModulesCount} 个文件 / ${(nodeModulesBytes / 1048576).toFixed(1)} MB，逐文件内容按"相对路径\\0sha256\\n"参与哈希；比对法见 MANIFEST.md）`);
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
# api/node_modules（2300+ 个文件）不逐条列，改为末行一条注释里的聚合摘要：
#   把每个文件的"相对路径\\0<该文件的 sha256>\\n"按相对路径排序串起来再取一次 sha256
sha256sum -c SHA256SUMS.txt          # 应当全部 OK、退出码 0（注释行会被自动跳过）
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
  // 不用 Compress-Archive：PowerShell 5.1 写出的条目名带 `\`，Linux 的 unzip 会把每条
  // 当成一个"文件名里有反斜杠"的平面文件解出来，目录树直接没了（A-25）。
  const zip = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
      path.join(ROOT, 'scripts', 'make-zip.ps1'),
      '-SourceDir', STAGE, '-DestinationZip', ZIP],
    { encoding: 'utf8' }
  );
  const zipOut = `${zip.stdout || ''}${zip.stderr || ''}`.trim().split('\n').slice(-4).join(' / ');
  if (zip.status !== 0) {
    console.error(zipOut);
    console.error('  压缩这一步失败就不出包：一个解不开的 zip 比没有 zip 更坑。');
    process.exit(1);
  }
  const bad = (zipOut.match(/BACKSLASH_ENTRIES=(\d+)/) || [])[1];
  const nonAscii = (zipOut.match(/NON_ASCII_ENTRIES=(\d+)/) || [])[1];
  if (bad !== '0' || nonAscii !== '0') {
    console.error(`zip 条目名不合格（反斜杠 ${bad} 条 / 非 ASCII ${nonAscii} 条）：这种包在非 Windows 上解不出正确的目录树，拒绝交付。`);
    console.error('  非 ASCII 的解决办法是把**文件名**改成 ASCII（界面显示的是 title，不受影响）；见 A-26。');
    console.error(zipOut);
    process.exit(1);
  }
  const bytes = fs.statSync(ZIP).size;
  console.log(`已压缩 ${ZIP}`);
  console.log(`  ${(bytes / 1048576).toFixed(1)} MB · sha256 ${sha256(ZIP)} · ${zipOut.match(/DIRS=\d+ FILES=\d+/)?.[0] ?? ''} · 条目名全部 ASCII 且用 /`);
}
