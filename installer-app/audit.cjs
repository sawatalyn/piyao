// ============================================================================
// 自检清单（对应原 Installer.cs 的 Audit.Run）
//
// 三条硬口径都在这份文件里：
//   1) 依赖在不在 = 真跑一次 import，不是看 node_modules 目录存在（A-11）；
//      探针必须落在 api\ 里，ESM 裸模块名按发起 import 的文件位置上溯，放 %TEMP%
//      会让健康的安装被判成"全部缺包"。
//   2) 判"有"要回查：任务与 Run 键都读回来再看，不信写入侧的返回（A-14 同族）。
//   3) 协议默认 http 不是缺陷（用户指定：生产暂无证书就要按明文起站）；
//      但 https + 后端持证书 + 证书不在 必须报红，因为 run-site.cmd 会拒绝起站。
// ============================================================================
'use strict';

const fs = require('fs');
const path = require('path');
const core = require('./core.cjs');

function chk(name, verdict, detail, fix, required) {
  return { name, verdict, detail: detail || '', fix: fix || '', required: required !== false };
}

// 依赖探针：真 import 一次
async function depsProbe(apiDir) {
  const specs = core.startupImports();
  const probe = path.join(apiDir, '.bianwang-deps-probe.mjs');
  const body = 'const specs=[' + specs.map((s) => JSON.stringify(s)).join(',') + '];'
    + 'const bad=[];for(const s of specs){try{await import(s)}catch(e){bad.push(s+" <- "+((e&&e.code)||"ERR"))}}'
    + 'console.log(bad.length?("MISS|"+bad.join(", ")):"OK");';
  try {
    fs.writeFileSync(probe, body, 'utf8');
  } catch (e) {
    return { ok: false, detail: '探针写不进 ' + apiDir + '：' + e.message };
  }
  try {
    const rt = core.resolveRuntime();
    if (!rt.ver) return { ok: false, detail: '没有可用运行时，探针没法跑' };
    // 参数直接给路径，不能包一层引号：nodeCapture 走的是 argv（不经 shell），
    // 带了引号 node 会把 "C:\..." 连同引号当模块名去找
    const res = core.nodeCapture(rt.exe, rt.asNode, [probe], { cwd: apiDir, timeout: 90000 });
    const out = (res.stdout || '').trim();
    if (out === 'OK') return { ok: true, count: specs.length, detail: specs.length + ' 个启动依赖全部真 import 成功' };
    if (out.indexOf('MISS|') === 0) return { ok: false, detail: out.slice(5) };
    return {
      ok: false,
      detail: '探针没回话（退出码 ' + res.rc + '）' + (res.stderr ? '：' + res.stderr.slice(0, 200) : '')
    };
  } catch (e) {
    return { ok: false, detail: '探针异常：' + e.message };
  } finally {
    // 探针是临时件，留在 api\ 里会被下次体检当成"包里有陌生文件"
    try { fs.rmSync(probe, { force: true }); } catch (e) { /* 删不掉也不影响结论 */ }
  }
}

async function audit(st) {
  const out = [];

  const pkgHasSite = fs.existsSync(path.join(st.pkgRoot, 'api', 'src', 'index.js'));
  out.push(chk('包根', pkgHasSite ? 'pass' : 'fail',
    st.pkgRoot + (st.deployed ? '（已安装，就地维护）' : '（尚未安装）'),
    pkgHasSite ? null : '这不是完整的离线包：api\\src\\index.js 不在',
    true));

  const missing = core.ENGINES.filter((f) => !fs.existsSync(path.join(st.pkgInstaller, f)));
  out.push(missing.length
    ? chk('安装引擎', 'fail', '包里缺 ' + missing.join('、'), '重新取一份完整离线包；手工补单个脚本不算修完')
    : chk('安装引擎', 'pass', core.ENGINES.length + ' 个 .cmd/.ps1 齐全（安装逻辑只有这一份）'));

  const need = [['后端', 'api/src/index.js'], ['前端产物', 'web/dist/index.html'], ['站点配置', 'nginx/bianwang-http.conf']];
  const absent = need.filter((n) => !fs.existsSync(path.join(st.pkgRoot, n[1]))).map((n) => n[0]);
  out.push(absent.length
    ? chk('站点内容', 'fail', '缺 ' + absent.join('、'), '包不完整，先别点安装')
    : chk('站点内容', 'pass', '后端 / 前端产物 / Nginx 站点配置都在'));

  const rt = core.resolveRuntime();
  const rtOk = core.atLeast(rt.ver, core.MIN_NODE);
  out.push(rt.ver
    ? chk('运行时', rtOk ? 'pass' : 'fail',
      (rt.kind === 'electron' ? '包内 Electron 内建 Node ' : '系统 Node ') + rt.text
      + (rtOk ? '，满足 >= ' + core.MIN_NODE.join('.') : '，低于要求的 ' + core.MIN_NODE.join('.')),
      rt.kind === 'electron' ? null : '装 Node.js LTS，或改用离线安装包（它自带运行时）')
    : chk('运行时', 'fail', '既没有 runtime\\BianwangRuntime.exe，PATH 上也找不到 node',
      '离线包必须随带运行时；这一项不过，站点起不来'));

  const probeDir = st.deployed ? st.targetApi : path.join(st.pkgRoot, 'api');
  if (fs.existsSync(probeDir)) {
    const p = await depsProbe(probeDir);
    out.push(p.ok
      ? chk('依赖完整性', 'pass', p.detail + '（探针跑在 ' + path.relative(st.pkgRoot, probeDir) + '）')
      : chk('依赖完整性', 'fail', p.detail,
        '包内 api\\node_modules 不完整——重出包，不要在装机上手工补依赖'));
  } else {
    out.push(chk('依赖完整性', 'warn', '找不到 api\\ 目录，探针无从下手', '先解压完整再自检'));
  }

  // 落点可写：写不进去时 deploy.cmd 会给退出码 3，但让人等到那一步才知道，
  // 不如现在说清楚是权限还是盘满
  const testDir = fs.existsSync(st.target) ? st.target : path.dirname(st.target);
  let writable = true;
  let werr = '';
  try {
    const t = path.join(testDir, '.bianwang-write-test');
    fs.writeFileSync(t, 'x');
    fs.rmSync(t, { force: true });
  } catch (e) {
    writable = false;
    werr = e.message;
  }
  out.push(writable
    ? chk('落点可写', 'pass', testDir + ' 可写', null, false)
    : chk('落点可写', 'fail', testDir + ' 写不进去：' + werr,
      st.isAdmin ? '换一个目录，或确认该盘没满' : '以管理员身份重新打开安装器，或换到用户可写目录（如 D:\\Sites\\bianwang）'));

  out.push(fs.existsSync(path.join(st.pkgRoot, 'dashboard', 'build.cmd'))
    ? chk('仪表盘', 'pass', '源码随包，安装时在本机现编 BianwangDashboard.exe', null, false)
    : chk('仪表盘', 'warn', 'dashboard\\build.cmd 不在：装完没有图形仪表盘，用 installer\\run-site.cmd 起站', null, false));

  if (st.scheme !== 'https') {
    out.push(chk('访问协议', 'pass', 'http（默认档：没有证书也能正式上线）', null, false));
  } else if (st.tlsFrom !== 'node') {
    out.push(chk('访问协议', 'pass', 'https 由前置 Nginx 终结，后端按明文监听回环', null, false));
  } else if (st.tlsPfx && fs.existsSync(st.tlsPfx)) {
    out.push(chk('访问协议', 'pass', 'https，后端持证书 ' + st.tlsPfx, null, false));
  } else {
    out.push(chk('访问协议', 'fail',
      '选了 HTTPS + 本机后端持证书，但证书包不在：' + (st.tlsPfx || '（没填路径）'),
      '在仪表盘「访问协议」里生成本机自签证书、或填已有 pfx 路径、或改选前置 Nginx / 退回 http。'
      + 'run-site.cmd 遇到这种配置会拒绝起站——它不会悄悄退回明文，那样你以为加密了、其实没有'));
  }

  const listening = await core.portListening(st.port);
  const menu = listening ? await core.menuProbe(st.url) : { ok: false };
  if (!(st.port > 0)) {
    out.push(chk('端口', 'info', '还没记录端口（自启那一步会问）', null, false));
  } else if (listening) {
    out.push(menu.ok
      ? chk('站点实况', 'pass', st.url + ' 的 /api/menu 回了 ' + menu.status)
      : chk('站点实况', 'warn', '端口 ' + st.port + ' 有人听着，但 /api/menu 没回 200（'
        + (menu.status || menu.error) + '）',
        '可能不是辨妄阁占的这个口：换个端口再装，或先把占用者停掉'));
  } else {
    out.push(chk('站点实况', 'info', '端口 ' + st.port + ' 上现在没人听着（没起站属正常）', null, false));
  }

  out.push(chk('自启现状', 'info',
    '开机任务 BianwangSite=' + core.taskState('BianwangSite')
    + ' · 仪表盘任务 BianwangDashboard=' + core.taskState('BianwangDashboard')
    + ' · 登录 Run 键=' + (core.regReadRunValue() || '无')
    + ' · 提权=' + (st.isAdmin ? '是' : '否'), null, false));

  return out;
}

module.exports = { audit, chk, depsProbe };
