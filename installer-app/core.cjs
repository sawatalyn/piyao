// ============================================================================
// 辨妄阁 · 离线安装包图形安装器（Electron 主进程）
//
// 形态与 WinForms 那一版一致：一个程序，四段——自检 / 安装 / 自启选择 / 维护。
// 它不重写安装逻辑：真正做事的仍是包内 installer\*.cmd 那几个引擎，本文件只把
// 它们的退出码与逐行输出接回来显示。逻辑只有一份，界面是前置。
//
// 为什么换成 Electron（用户 2026-10-01 指定）：离线包要把"安装器 + 站点 + 运行时"
// 合成一个自解压 exe，随包已经带着 Electron 当 Node 运行时；同一个 exe 再当安装器
// 界面，就不必在目标机上另编一份 WinForms。runtime\BianwangRuntime.exe 被
// ELECTRON_RUN_AS_NODE=1 带着跑就是 node，不带就是本界面。
//
// 三条不可让的口径（沿用 Installer.cs，A-11 / A-14 / 协议那条）：
//   1) 自检里"依赖在不在"必须真跑一次 import，不能只看 node_modules 目录存在；
//      探针要落在 api\ 里，ESM 裸模块名按发起 import 的文件位置上溯。
//   2) 自启三选一各自对应一个真实可用的机制：不注册 / 登录时（HKCU Run，免管理员）/
//      开机时（计划任务 SYSTEM，需管理员，客户端 Windows 可能拒——降级并明说）。
//   3) 判"做成"要回查，不信退出码 0 本身。
//
// 命令行出口：本程序**不**假装自己是 CLI。Electron 在 Windows 是 GUI 子系统程序，
// 从 cmd 启动时 stdout 不保证可见；无界面/远程/Server Core 一律用
//     installer\setup.cmd /cli [D:\Sites\bianwang]
// 那条批处理路径，它不依赖任何 exe。
//
// 语言与依赖：只用 Node 内建模块 + electron，不新增 npm 包。
// ============================================================================
'use strict';

// 这一层刻意不 require('electron')：路径、运行时判定、引擎调用都要能在纯 node 里
// 被自检直接跑一遍（本机复验走的就是这条路），也免得安装器界面起不来时诊断也起不来。
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const http = require('http');
const https = require('https');

const RUNTIME_DIR = path.dirname(process.execPath);
const PKG_ROOT = path.resolve(RUNTIME_DIR, '..');
const PKG_INSTALLER = path.join(PKG_ROOT, 'installer');
const SELF_EXE = process.execPath;

// 引擎清单：包完整性与"逻辑只有一份"都靠它；runtime.cmd 是新加的解析层，也必须在内
const ENGINES = [
  'env.cmd', 'deploy.cmd', 'autostart.cmd', 'run-site.cmd',
  'uninstall.cmd', 'creds.cmd', 'creds.ps1', 'runtime.cmd', 'setup.cmd'
];
const MIN_NODE = [20, 19, 0];

// 后端启动时真正 import 的东西。单一来源是 installer\startup-imports.json；
// 读不到才退回下面这份内置表（出包硬闸会比对内置表与 Dashboard.cs 里的同名单）
const IMPORTS_FILE = path.join(PKG_INSTALLER, 'startup-imports.json');
const FALLBACK_IMPORTS = [
  'express', 'express-rate-limit', 'sanitize-html', 'minisearch', 'multer',
  'cookie-parser', 'csv-parse/sync', 'csv-stringify/sync', 'diff',
  '@rgrove/parse-xml', 'pdfjs-dist/legacy/build/pdf.mjs'
];

function argvValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

const CLI_TARGET = argvValue('--target');
const CLI_PORT = parseInt(argvValue('--port') || '', 10) || 0;

// 界面上改的目标目录/端口只影响本进程（安装包里的引擎脚本各自读 port.txt /
// target.txt，落盘的仍然是它们那份），所以这里只是"这一次运行用什么"
let targetOverride = CLI_TARGET;
let portOverride = CLI_PORT;

// %APPDATA%\Bianwang 与仪表盘共用：cfg（协议/端口）就写在那儿，安装器只读不写
function appDataBianwang() {
  return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Bianwang');
}

function readText(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch (e) { return ''; }
}

function readRememberedTarget() {
  const fromPkg = readText(path.join(PKG_INSTALLER, 'target.txt')).trim();
  if (fromPkg) return fromPkg;
  // 装完之后再次双击的是 <target>\runtime\ 里那一份，包根就在目标目录内，
  // target.txt 也可能只写在目标那份 installer 下
  return readText(path.join(PKG_ROOT, 'installer', 'target.txt')).trim();
}

// 协议与端口同源：命令行 > installer\port.txt > 仪表盘记的 dashboard.cfg > 空。
// 安装器只"跟随"协议，不改它——那是仪表盘「访问协议」那一栏的权柄（默认 http）。
function readCfg() {
  const out = { port: 0, scheme: 'http', tlsFrom: 'node', tlsPfx: '' };
  const text = readText(path.join(appDataBianwang(), 'dashboard.cfg'));
  text.split(/\r?\n/).forEach((line) => {
    const i = line.indexOf('=');
    if (i < 0) return;
    const k = line.slice(0, i).trim().toLowerCase();
    const v = line.slice(i + 1).trim();
    if (k === 'port') out.port = parseInt(v, 10) || 0;
    else if (k === 'scheme') out.scheme = v.toLowerCase() === 'https' ? 'https' : 'http';
    else if (k === 'tls_from') out.tlsFrom = v.toLowerCase() || 'node';
    else if (k === 'tls_pfx') out.tlsPfx = v;
  });
  return out;
}

function site() {
  const target = (() => {
    if (targetOverride) return path.resolve(targetOverride);
    const remembered = readRememberedTarget();
    // 离线包的默认落点就是包所在目录：NSIS 已经问过装在哪儿、东西也解到那儿了，
    // 再默认 C:\Bianwang 等于让操作员对着自己刚选的目录再拷一遍。
    return remembered || PKG_ROOT;
  })();
  const cfg = readCfg();
  const deployed = fs.existsSync(path.join(target, 'api', 'src', 'index.js'));
  // 装好之后必须用目标目录那份引擎：autostart.cmd / run-site.cmd 都把自已的上一层当
  // 站点根，从包里调用就会起包里那份 api\（实测踩过：装完自启，起的是包，站根仍是空的）
  const engineDir = deployed && fs.existsSync(path.join(target, 'installer'))
    ? path.join(target, 'installer')
    : PKG_INSTALLER;
  const portFilePort = parseInt(readText(path.join(engineDir, 'port.txt')).trim(), 10) || 0;
  const port = portOverride || portFilePort || cfg.port || 0;
  const scheme = cfg.scheme;
  const url = scheme !== 'https'
    ? 'http://127.0.0.1:' + port + '/'
    : (cfg.tlsFrom === 'nginx' ? 'https://127.0.0.1/' : 'https://127.0.0.1:' + port + '/');
  return {
    pkgRoot: PKG_ROOT,
    pkgInstaller: PKG_INSTALLER,
    runtimeExe: SELF_EXE,
    target,
    targetApi: path.join(target, 'api'),
    targetInstaller: path.join(target, 'installer'),
    targetDashExe: path.join(target, 'dashboard', 'BianwangDashboard.exe'),
    engineDir,
    deployed,
    port,
    scheme,
    tlsFrom: cfg.tlsFrom,
    tlsPfx: cfg.tlsPfx,
    url: port > 0 ? url : '',
    isAdmin: isElevated()
  };
}

function isElevated() {
  try {
    return spawnSync('net', ['session'], { windowsHide: true }).status === 0;
  } catch (e) {
    return false;
  }
}

// 起 Node 子进程的唯一入口：随包运行时是 Electron 的可执行文件，必须显式带上
// ELECTRON_RUN_AS_NODE=1，否则它不报版本，而是再把安装器界面开一个窗口出来。
function nodeCapture(exe, asNode, args, opts) {
  const o = opts || {};
  const env = Object.assign({}, process.env);
  if (asNode) env.ELECTRON_RUN_AS_NODE = '1';
  const res = spawnSync(exe, args, {
    windowsHide: true,
    encoding: 'buffer',
    timeout: o.timeout || 30000,
    cwd: o.cwd || undefined,
    env
  });
  const dec = (b) => (b ? new TextDecoder('utf-8').decode(b).trim() : '');
  return { rc: res.status === null || res.status === undefined ? -1 : res.status, stdout: dec(res.stdout), stderr: dec(res.stderr), error: res.error };
}

function systemNodeVersion() {
  const res = spawnSync('node', ['-v'], { windowsHide: true, encoding: 'utf-8', timeout: 10000 });
  return res.error ? null : String(res.stdout || '').trim();
}

function parseVer(text) {
  const m = /v?(\d+)\.(\d+)\.(\d+)/.exec(String(text || ''));
  return m ? [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)] : null;
}

function atLeast(v, floor) {
  if (!v) return false;
  for (let i = 0; i < 3; i++) {
    if (v[i] > floor[i]) return true;
    if (v[i] < floor[i]) return false;
  }
  return true;
}

// 运行时判定必须与 installer\runtime.cmd 同一条：随包的赢，否则 PATH 上的 node。
// 两处口径不一致就会出现"体检说行、起站说不行"，那比两条都错更难查。
function resolveRuntime() {
  const bundled = path.join(PKG_ROOT, 'runtime', 'BianwangRuntime.exe');
  if (fs.existsSync(bundled)) {
    const text = nodeCapture(bundled, true, ['-v'], { timeout: 15000 }).stdout;
    const v = parseVer(text);
    return { kind: 'electron', exe: bundled, asNode: true, ver: v, text: text || '' };
  }
  const text = systemNodeVersion();
  return { kind: 'node', exe: 'node', asNode: false, ver: parseVer(text), text: text || '' };
}

// 调引擎：cmd /d /s /c，逐行回显。三个细节都是实测换来的：
//   - windowsVerbatimArguments：默认 Node 会给每个 argv 元素加引号并转义，cmd 收到的
//     就成了 '\"\"C:\\...env.cmd\"' 这种它认不得的东西（实测报"不是内部或外部命令"）。
//     命令行要的是与 C# 版逐字一致的 ""脚本路径" 参数"；
//   - 不写 chcp：`chcp 65001>nul & ""path""` 会让 cmd 把路径在空格处截断（实测 rc=1）。
//     node 的中文输出本来就是 UTF-8，解码权在我们手里，直接按 UTF-8 解；只有 cmd 自己
//     那类 OEM 码页的报错行会解出替换符，那时整行改按 GBK 重解一遍；
//   - stdin 给 NUL：deploy.cmd / env.cmd 的失败分支里有 pause，无人值守时不关掉标准输入
//     就永远等不到那一下按键。30 分钟上限是兜底，正常一两分钟就完。
function runEngine(script, args, onLine) {
  return new Promise((resolve) => {
    const st = site();
    const pkgOwned = script === 'env.cmd' || script === 'deploy.cmd';
    const target = path.join(pkgOwned ? PKG_INSTALLER : st.engineDir, script);
    if (!fs.existsSync(target)) {
      onLine('[X] 引擎不在：' + target);
      resolve({ rc: 127, output: '' });
      return;
    }
    const child = spawn('cmd.exe', ['/d', '/s', '/c', '""' + target + '"' + (args ? ' ' + args : '') + '"'], {
      cwd: path.dirname(target),
      windowsHide: true,
      windowsVerbatimArguments: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let all = '';
    let pending = Buffer.alloc(0);
    const decodeLine = (buf) => {
      const asUtf8 = new TextDecoder('utf-8', { fatal: false }).decode(buf);
      // 只有混进替换符才说明这行不是 UTF-8（cmd 自己的中文报错就是这种）
      return asUtf8.indexOf('\ufffd') >= 0 ? new TextDecoder('gbk').decode(buf) : asUtf8;
    };
    const push = (chunk) => {
      pending = Buffer.concat([pending, chunk]);
      let idx;
      while ((idx = pending.indexOf(0x0a)) >= 0) {
        const raw = pending.subarray(0, idx);
        pending = pending.subarray(idx + 1);
        const text = decodeLine(raw).replace(/\r$/, '');
        all += text + '\n';
        if (text.trim()) onLine(text);
      }
    };
    child.stdout.on('data', push);
    child.stderr.on('data', push);
    const killer = setTimeout(() => {
      onLine('[X] ' + script + ' 超过 30 分钟没结束，已终止。');
      try { child.kill(); } catch (e) { /* 已经结束 */ }
    }, 30 * 60 * 1000);
    const finish = (code) => {
      clearTimeout(killer);
      if (pending.length) { const text = decodeLine(pending).trim(); pending = Buffer.alloc(0); if (text) { all += text + '\n'; onLine(text); } }
      resolve({ rc: code === null ? -1 : code, output: all });
    };
    child.on('error', (e) => { onLine('[X] 起 cmd 失败：' + e.message); finish(127); });
    child.on('close', finish);
  });
}

// 依赖清单的单一来源：installer\startup-imports.json；读不到才用内置表。
// 出包硬闸会比对内置表与 dashboard/Dashboard.cs 里的同名单，防三处各写一份。
function startupImports() {
  try {
    const list = JSON.parse(fs.readFileSync(IMPORTS_FILE, 'utf8'));
    if (Array.isArray(list.specs) && list.specs.length) return list.specs;
    if (Array.isArray(list) && list.length) return list;
  } catch (e) { /* 文件不在/读不动就用内置表，自检照样跑得完 */ }
  return FALLBACK_IMPORTS;
}

// 端口上有没有人听着：安装完的"起来了没"第一问，比看进程名可靠
function portListening(port, timeoutMs) {
  return new Promise((resolve) => {
    if (!(port > 0)) return resolve(false);
    const sock = net.connect({ host: '127.0.0.1', port });
    const timer = setTimeout(() => { sock.destroy(); resolve(false); }, timeoutMs || 1500);
    sock.on('connect', () => { clearTimeout(timer); sock.destroy(); resolve(true); });
    sock.on('error', () => { clearTimeout(timer); resolve(false); });
  });
}

// /api/menu 是唯一"后端活着"的硬证据。自签证书只在回环上出现，所以这里放行
// 的只有 127.0.0.1，不是别人家的主机。
function menuProbe(url) {
  return new Promise((resolve) => {
    if (!url) return resolve({ ok: false, error: 'NO_URL' });
    try {
      const u = new URL(url);
      const mod = u.protocol === 'https:' ? https : http;
      const req = mod.get(u, {
        timeout: 10000,
        rejectUnauthorized: false,
        headers: { 'User-Agent': 'Mozilla/5.0 (bianwang-setup)' }
      }, (res) => {
        res.resume();
        resolve({ ok: res.statusCode === 200, status: res.statusCode });
      });
      req.on('error', (e) => resolve({ ok: false, error: e.code || e.message }));
      req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'ETIMEDOUT' }); });
    } catch (e) {
      resolve({ ok: false, error: e.message });
    }
  });
}

// Run 键回查：写完再读，不看写入侧的返回（A-14 同一类错）
function regReadRunValue() {
  const res = spawnSync('reg',
    ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', '/v', 'BianwangDashboard'],
    { windowsHide: true, encoding: 'utf-8', timeout: 10000 });
  if (res.error || res.status !== 0) return '';
  const m = /REG_SZ\s+(.*)/.exec(res.stdout || '');
  return m ? m[1].trim() : '';
}

// 任务状态三值：present / absent / unknown。把 unknown 当 absent 会漏报
// "任务其实装着，只是这个账号查不到"——客户端 Windows 上的 SYSTEM 任务就是这样
function taskState(name) {
  const res = spawnSync('schtasks', ['/query', '/tn', name],
    { windowsHide: true, encoding: 'utf-8', timeout: 15000 });
  if (!res.error && res.status === 0) return 'present';
  const err = String(res.stderr || '') + String(res.stdout || '');
  if (/Access is denied|拒绝访问|(\d{5,})/i.test(err)) return 'unknown';
  return 'absent';
}

module.exports = {
  PKG_ROOT, PKG_INSTALLER, RUNTIME_DIR, SELF_EXE, ENGINES, MIN_NODE, IMPORTS_FILE, FALLBACK_IMPORTS,
  argvValue, appDataBianwang,
  setTargetOverride: (v) => { targetOverride = v; },
  setPortOverride: (v) => { portOverride = v; },
  readText, site, isElevated, resolveRuntime, nodeCapture, systemNodeVersion, parseVer, atLeast,
  runEngine, portListening, menuProbe, regReadRunValue, taskState, startupImports
};
