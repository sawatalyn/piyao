/**
 * 辨妄阁 · 离线完整安装包（单个自解压 exe，形态对齐 MySQL 的离线安装器）
 *
 *   node scripts/make-offline-package.mjs            # 预演：只说要做什么，不落盘
 *   node scripts/make-offline-package.mjs --write    # 出包
 *
 * 产物：outputs/package/bianwang-<版本>-offline-win.exe
 *   内含：站点（api / web / nginx / ops / docs / dashboard / installer）
 *       + 随带运行时 runtime\BianwangRuntime.exe（Electron 44.5.1 改名，内建 Node 24.21.0）
 *       + 图形安装器 runtime\resources\app（自检 / 安装 / 自启 / 维护四段）
 *
 * 三步硬口径：
 *   1) 站点那部分**不另做一份**：先调 make-nginx-package.mjs 把它连同它自己的六道硬闸
 *      跑完（运行态挡在包外、孤立自足性真起后端、批处理 CRLF+ASCII、清单与校验值），
 *      再把它的产物当输入。逻辑只有一份。
 *   2) 外部二进制一律**按校验值取用**：Electron 官方运行包与 NSIS 工具包都先比对
 *      sha256 才解；对不上就停，不"顺手用本地那份"。缓存目录在仓库外（仓库是公开的）。
 *   3) 二进制闸门从"包内零 exe"改成"白名单逐件核对"：只允许 runtime\ 里那一套
 *      Electron 文件 + 安装器资源，别处冒出 .exe 一律拒。
 *
 * 许可：Electron 是 MIT（包内自带 LICENSE 与 LICENSES.chromium.html，随包走）；
 *   NSIS 与其 zlib 压缩模块是 zlib/libpng（见 installer\offline.nsi 顶部说明：
 *   LZMA 模块是 CPL-1.0，所以压缩器固定用 zlib）。
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const WRITE = process.argv.includes('--write');

const NAME = `bianwang-${VERSION}-offline-win`;
const SITE_STAGE = path.join(ROOT, 'outputs', 'package', `bianwang-${VERSION}-nginx`);
const STAGE = path.join(ROOT, 'outputs', 'package', NAME);
const EXE = path.join(ROOT, 'outputs', 'package', `${NAME}.exe`);

/** 仓库外的取用缓存：%LOCALAPPDATA%\bianwang-offline-cache */
const CACHE = path.join(process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || os_home(), 'AppData', 'Local'), 'bianwang-offline-cache');
function os_home() { return process.env.USERPROFILE || process.env.HOME; }

const ASSETS = [
  {
    what: 'Electron 官方 Windows x64 运行包（改名后当站点运行时与安装器宿主）',
    file: 'electron-v44.5.1-win32-x64.zip',
    url: 'https://github.com/electron/electron/releases/download/v44.5.1/electron-v44.5.1-win32-x64.zip',
    bytes: 157998329,
    sha256: '9b382492dcfee91f8f9e92c91f7972550a1b95d2299cac72279dab33a600d7db',
    kind: 'zip',
    into: 'runtime'
  },
  {
    what: 'NSIS 工具包（makensis，只在本机用来编译安装器，不进交付物）',
    file: 'nsis-bundle-3.12.tar.gz',
    url: 'https://github.com/electron-userland/electron-builder-binaries/releases/download/nsis%402.0.1/nsis-bundle-3.12.tar.gz',
    bytes: 6227143,
    sha256: 'fe36a357f3a220db893498e830fd80e0769768a18a99f4e4d2447b982538feed',
    kind: 'targz',
    into: '.nsis'
  }
];

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const MB = (n) => (n / 1048576).toFixed(1) + ' MB';

function needAsset(a) {
  const p = path.join(CACHE, a.file);
  if (!fs.existsSync(p)) {
    console.error(`✗ 缓存里没有 ${a.file}\n  ${a.what}\n  取用：curl -L --proxy http://127.0.0.1:7897 -o "${path.join(CACHE, a.file)}" "${a.url}"\n  （先 mkdir -p "${CACHE}"）`);
    process.exit(1);
  }
  const st = fs.statSync(p);
  const got = sha256(p);
  if (st.size !== a.bytes || got !== a.sha256) {
    console.error(`✗ ${a.file} 与声明不符：${MB(st.size)} / sha256 ${got.slice(0, 16)}…\n  应为 ${MB(a.bytes)} / sha256 ${a.sha256}\n  不"顺手用本地这份"：要么重新取，要么把上面的常量改成你核实过的来源。`);
    process.exit(1);
  }
  console.log(`  ✓ ${a.file}  ${MB(st.size)}  sha256 ${got.slice(0, 16)}… 已核对`);
  return p;
}

const run = (cmd, args, opts) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', shell: false, ...opts });
  if (r.error) {
    console.error(`✗ 起不了 ${cmd}：${r.error.message}`);
    process.exit(1);
  }
  return r;
};

/**
 * Windows 自带的 bsdtar 既能解 .zip 也能解 .tar.gz，不必引第三方解压库。
 * 必须点名 System32 那一个：PATH 上 Git-for-Windows 的 GNU tar 排在前头，
 * 它把 "C:\..." 当成"远程主机的路径"，直接报 Cannot connect to C: resolve failed。
 */
const BSDTAR = path.join(process.env.SystemRoot || 'C:\\WINDOWS', 'System32', 'tar.exe');
function unpack(archive, dest, kind) {
  if (!fs.existsSync(BSDTAR)) {
    console.error(`✗ 找不到系统自带的 ${BSDTAR}（解压要用它）`);
    process.exit(1);
  }
  fs.mkdirSync(dest, { recursive: true });
  const args = kind === 'targz' ? ['-xzf', archive, '-C', dest] : ['-xf', archive, '-C', dest];
  const r = run(BSDTAR, args);
  if (r.status !== 0) {
    console.error(`✗ tar 解压失败：${archive}\n${(r.stderr || '').slice(0, 600)}`);
    process.exit(1);
  }
}

function copyTree(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  let n = 0;
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) { n += copyTree(s, d); continue; }
    fs.copyFileSync(s, d);
    n++;
  }
  return n;
}

/** 交付物里允许出现的 .exe：只有 runtime\ 那一套（Electron 主程序改名件 + 它自带的辅助 exe） */
const EXE_ALLOWED = new Set([
  'runtime/bianwangruntime.exe',
  'runtime/electron.exe',
  'runtime/chrome_proxy.exe',
  'runtime/chrome_crashpad_handler.exe'
]);

function scanBinaries(dir, base = dir, found = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { scanBinaries(full, base, found); continue; }
    if (/\.exe$/i.test(e.name)) found.push(path.relative(base, full).replaceAll(path.sep, '/'));
  }
  return found;
}

/* ---------------------------------------------------------------- 预演 ---- */
console.log(`离线完整安装包  ${NAME}.exe   （版本 v${VERSION}）`);
console.log('');
console.log('取用外部二进制（按校验值）：');
for (const a of ASSETS) console.log(`  · ${a.file}  ${MB(a.bytes)}  sha256 ${a.sha256.slice(0, 16)}…`);
console.log('');
console.log('步骤：');
console.log('  1) make-nginx-package.mjs --write 先出站点那半（含它自己的六道硬闸）');
console.log(`  2) 解包 Electron → ${STAGE}\\runtime，electron.exe 改名 BianwangRuntime.exe`);
console.log(`  3) 拷 installer-app → ${STAGE}\\runtime\\resources\\app`);
console.log('  4) 二进制白名单 + 依赖清单一致性 + NSIS 编译单个 exe');
if (!WRITE) {
  console.log('');
  console.log('预演结束：未写入任何文件。要落盘请加 --write。');
  process.exit(0);
}

/* ---------------- 1. 站点那半：交给既有出包脚本，不复制它的逻辑 ---------------- */
fs.rmSync(STAGE, { recursive: true, force: true });
console.log('');
console.log('== 1/4 站点半边（复用 make-nginx-package.mjs）==');
const stage = run(process.execPath, [path.join(ROOT, 'scripts', 'make-nginx-package.mjs'), '--write']);
process.stdout.write(stage.stdout || '');
if (stage.status !== 0) { console.error('✗ 站点那半没过，停。'); process.exit(1); }
if (!fs.existsSync(path.join(SITE_STAGE, 'api', 'src', 'index.js'))) {
  console.error(`✗ 没拿到站点暂存树：${SITE_STAGE}`);
  process.exit(1);
}
copyTree(SITE_STAGE, STAGE);
console.log(`  ✓ 站点树已作为输入拷入 ${path.basename(STAGE)}`);

/* ---------------- 2-3. 随带运行时与安装器 ---------------- */
console.log('');
console.log('== 2/4 取用二进制并铺运行时 ==');
const [electronZip, nsisTar] = ASSETS.map(needAsset);
const work = path.join(ROOT, 'outputs', 'package', '.offline-work');
fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(work, { recursive: true });
unpack(electronZip, path.join(work, 'electron'), 'zip');
const runtimeDir = path.join(STAGE, 'runtime');
fs.rmSync(runtimeDir, { recursive: true, force: true });
copyTree(path.join(work, 'electron'), runtimeDir);
const exePath = path.join(runtimeDir, 'electron.exe');
fs.renameSync(exePath, path.join(runtimeDir, 'BianwangRuntime.exe'));
// default_app 是 Electron 自带的示例应用：不删的话，双击运行时而不带 ELECTRON_RUN_AS_NODE
// 会起一个演示窗口，而不是我们的安装器
fs.rmSync(path.join(runtimeDir, 'resources', 'default_app.asar'), { force: true });
console.log('  ✓ runtime\\ 就位，electron.exe → BianwangRuntime.exe，default_app.asar 已移除');

const appFiles = copyTree(path.join(ROOT, 'installer-app'), path.join(runtimeDir, 'resources', 'app'));
console.log(`  ✓ installer-app → runtime\\resources\\app（${appFiles} 个文件）`);

/* ---------------- 3.5 包内文档改成"本包形态"的口径 ---------------- */
/**
 * 站点那半的 README-FIRST / MANIFEST 是按"零 exe 的 nginx 树"写的，原样抄进离线包就成了假说明：
 * 它会叫运维去找 `csc.exe` 现编一个这里根本不需要的安装器（旧形态遗留），
 * 而且 MANIFEST 里既没有 `runtime/` 这一行，也没说 `SHA256SUMS.txt` 到底覆盖哪一半。
 * 这里只改这三处，别的内容不动——一份说明写两遍迟早漂，所以基准仍是站点脚本生成的那份。
 */
function treeStats(dir, base = dir, acc = { files: 0, bytes: 0 }) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) treeStats(full, base, acc);
    else { acc.files++; acc.bytes += fs.statSync(full).size; }
  }
  return acc;
}
function rewriteDocs() {
  const rf = path.join(STAGE, 'README-FIRST.md');
  const lines = fs.readFileSync(rf, 'utf8').split(/\r?\n/);
  const at = lines.findIndex((l) => /^> \*\*Windows 一键安装\*\*/.test(l));
  if (at < 0) { console.error('✗ README-FIRST.md 里找不到「Windows 一键安装」那段，离线包的说明没法改写（站点脚本改格式了？先看一眼再出包）'); process.exit(1); }
  let end = at;
  while (end + 1 < lines.length && /^>/.test(lines[end + 1])) end++;
  const hint = [
    '> **Windows 一键安装（本包形态：离线完整安装包）**：双击 `installer\\setup.cmd`，它直接打开随包的图形安装器',
    '> `runtime\\BianwangRuntime.exe`（Electron 44.5.1 改名件，内建 Node 24.21.0）——自检 / 安装 / 自启选择 / 维护四段，',
    '> **不需要装 Node.js、不需要 csc.exe、不需要联网**。没键盘或没有图形子系统的机器（含 Server Core）走 `installer\\setup.cmd /cli`，同一条线性四步。',
    '> 卸载：`installer\\uninstall-offline.exe`（安装时写进本目录）或 `installer\\uninstall.cmd`；日常维护另见 `dashboard\\BianwangDashboard.exe`（目标机现编）。'
  ];
  lines.splice(at, end - at + 1, ...hint);
  fs.writeFileSync(rf, lines.join('\r\n'), 'utf8');

  const mf = path.join(STAGE, 'MANIFEST.md');
  const m = fs.readFileSync(mf, 'utf8').split(/\r?\n/);
  // 三处锚点都要"找不到就停"：`splice(-1 + 1, ...)` 不会报错，只会把行静默插到文件头上，
  // 那比出包失败难查得多（A-31 学的就是这个）
  if (!/^# 包内容清单/.test(m[0])) { console.error('✗ MANIFEST.md 首行不是「# 包内容清单 …」，标题没法改写：' + m[0]); process.exit(1); }
  const row = m.findIndex((l) => l.startsWith('| `installer/`'));
  if (row < 0) { console.error('✗ MANIFEST.md 的目录表里找不到 `installer/` 那一行，`runtime/` 没法定位插入点'); process.exit(1); }
  const chkAnchor = m.findIndex((l) => /^## 校验/.test(l));
  if (chkAnchor < 0) { console.error('✗ MANIFEST.md 没有「## 校验」小节，覆盖范围没法写明'); process.exit(1); }
  m[0] = `# 包内容清单 · ${NAME}`;
  const rt = treeStats(runtimeDir);
  m.splice(row + 1, 0, `| \`runtime/\` | ${rt.files} | ${(rt.bytes / 1048576).toFixed(1)} MB | 随带运行时：Electron 44.5.1 的 \`electron.exe\` 改名 \`BianwangRuntime.exe\`（内建 Node 24.21.0）。带 \`ELECTRON_RUN_AS_NODE=1\` 就是后端用的 Node，不带就是图形安装器（\`resources\\app\`，本包的安装界面） |`);
  // 上面那次 splice 把 chk 之后的行号整体往后推了一行，所以这里重新定位一次
  const chk = m.findIndex((l) => /^## 校验/.test(l));
  m.splice(chk + 1, 0, '',
    '>\u3000本清单覆盖的是**站点那半**：`api` · `web` · `nginx` · `ops` · `docs` · `dashboard` · `installer` · 根目录零散件。',
    '>\u3000`runtime/` 不逐条列，它的完整性由**外层安装包**的摘要保证（Release 说明里那行 sha256，出包时同时落在 `SHA256SUMS-offline.txt`）：',
    '>```bash',
    '>certutil -hashfile bianwang-<版本>-offline-win.exe SHA256   # Windows',
    '>sha256sum -c SHA256SUMS-offline.txt                        # 有 coreutils 时',
    '>```',
    '>装完想验随带运行时解析得到的是哪一个：`installer\\setup.cmd /check` 会打印运行时种类与 Node 版本（低于 20.19.0 直接拒绝，不会硬起站）。');
  fs.writeFileSync(mf, m.join('\r\n'), 'utf8');
  console.log(`  ✓ README-FIRST / MANIFEST 已改写成本包口径（runtime\\ ${rt.files} 个文件 / ${(rt.bytes / 1048576).toFixed(1)} MB）`);
}
rewriteDocs();

/* ---------------- 4. 闸门 + NSIS ---------------- */
console.log('');
console.log('== 3/4 出包闸门 ==');
const exes = scanBinaries(STAGE);
const strays = exes.filter((f) => !EXE_ALLOWED.has(f.toLowerCase()));
if (strays.length) {
  console.error(`✗ 白名单外的 .exe：\n  ${strays.join('\n  ')}\n  离线包只允许随带那一套 Electron 可执行文件。`);
  process.exit(1);
}
console.log(`  ✓ 二进制白名单：${exes.length} 个 .exe，全部在 runtime\\ 内（${exes.join('、')}）`);

// 依赖清单三处对齐：installer\startup-imports.json ↔ installer-app 内置表 ↔ Dashboard.cs 常量
const listFile = path.join(STAGE, 'installer', 'startup-imports.json');
const specs = JSON.parse(fs.readFileSync(listFile, 'utf8')).specs;
const appCore = fs.readFileSync(path.join(ROOT, 'installer-app', 'core.cjs'), 'utf8');
const dash = fs.readFileSync(path.join(ROOT, 'dashboard', 'Dashboard.cs'), 'utf8');
// C# 那份用双引号、core.cjs 那份用单引号：比对时两种引号都认，别把闸门做成拼写检查
const has = (text, s) => text.includes(`"${s}"`) || text.includes(`'${s}'`);
const missingIn = (text) => specs.filter((s) => !has(text, s));
const appMiss = missingIn(appCore);
const dashMiss = missingIn(dash);
if (appMiss.length || dashMiss.length) {
  console.error(`✗ 依赖探针清单不一致：installer-app 缺 ${appMiss.join('、') || '(无)'} / Dashboard.cs 缺 ${dashMiss.join('、') || '(无)'}`);
  console.error('  三处各写一份迟早会漂；以 installer\\startup-imports.json 为准改齐再出包。');
  process.exit(1);
}
console.log(`  ✓ 依赖清单一致：${specs.length} 项，JSON / installer-app / Dashboard.cs 三处同源`);

const noRuntime = !fs.existsSync(path.join(runtimeDir, 'BianwangRuntime.exe'));
if (noRuntime) { console.error('✗ 运行时没就位'); process.exit(1); }
// 这里不再"起一次后端"：随包运行时跑后端已经由第 1 步的孤立自足性闸（真起进程 +
// 打 /api/menu）与 ops-extras/verify-deploy.mjs 的解压回环各自证过，重复起一次只会
// 把出包时间拖长、并留下一个要收拾的端口。
console.log('  ✓ 随包运行时就位');

console.log('');
console.log('== 4/4 NSIS 编译单个自解压 exe ==');
unpack(nsisTar, path.join(work, 'nsis'), 'targz');
const nsisRoot = path.join(work, 'nsis', 'nsis-bundle', 'windows');
// makensis 从自己所在目录的上一层找 Stubs/Include；这个包把 exe 放在 windows\ 根下，
// 所以要搬进 Bin\ 才认得自己的家（实测：不搬就报 "reading stub ...\Stubs\zlib-x86-unicode"）
fs.copyFileSync(path.join(nsisRoot, 'makensis.exe'), path.join(nsisRoot, 'Bin', 'makensis.exe'));
fs.rmSync(EXE, { force: true });
// OutFile 是相对**脚本所在目录**（installer\）解析的，不是 cwd —— 实测过一次：
// 编完 exe 落在 installer\ 里，outputs\package 那边左等右等也没有。所以编完搬一步。
const nsiDir = path.join(ROOT, 'installer');
const built = path.join(nsiDir, `${NAME}.exe`);
const nsi = run(path.join(nsisRoot, 'Bin', 'makensis.exe'), [
  '-V2',
  `-DVERSION=${VERSION}`,
  `-DSTAGE=${STAGE}`,
  `-DLICENSE=${path.join(ROOT, 'LICENSE')}`,
  path.join(nsiDir, 'offline.nsi')
], { cwd: nsiDir });
process.stdout.write((nsi.stdout || '').split('\n').slice(-14).join('\n') + '\n');
if (nsi.status !== 0) {
  console.error('✗ makensis 编译失败（见上面的输出）');
  process.exit(1);
}
if (!fs.existsSync(built)) {
  console.error(`✗ makensis 退出 0，但 ${built} 不在——别信退出码，找产物`);
  process.exit(1);
}
fs.mkdirSync(path.dirname(EXE), { recursive: true });
fs.renameSync(built, EXE);
const outBytes = fs.statSync(EXE).size;
if (outBytes < 50 * 1048576) {
  console.error(`✗ 产物只有 ${MB(outBytes)}，不像含完整运行时的包——检查 File /r 是否解到了东西`);
  process.exit(1);
}
fs.rmSync(work, { recursive: true, force: true });

const sums = path.join(ROOT, 'outputs', 'package', 'SHA256SUMS-offline.txt');
// 行尾必须是 LF：`sha256sum -c` 会把 CRLF 的 `\r` 当成文件名的一部分，报
// `bianwang-1.1.0-offline-win.exe\r: FAILED open or read` 并退出 1——而 MANIFEST.md 里就写着这条命令（A-33）
fs.writeFileSync(sums, `${sha256(EXE)}  ${NAME}.exe\n`, 'utf8');
const back = fs.readFileSync(sums, 'utf8');
if (back.includes('\r')) { console.error('✗ SHA256SUMS-offline.txt 里出现了 CR，`sha256sum -c` 会读不到文件名'); process.exit(1); }
if (!/^[0-9a-f]{64} {2}\S+\.exe\n$/.test(back)) { console.error(`✗ SHA256SUMS-offline.txt 的格式不是"<64 位十六进制>  <名>.exe"：${JSON.stringify(back.slice(0, 90))}`); process.exit(1); }
console.log(`  ✓ SHA256SUMS-offline.txt 可被 sha256sum -c 直接读（LF 行尾、两空格分隔）`);
console.log('');
console.log(`产物：${EXE}`);
console.log(`体积：${MB(outBytes)}   sha256：${sha256(EXE)}`);
console.log(`校验值清单：${sums}`);
