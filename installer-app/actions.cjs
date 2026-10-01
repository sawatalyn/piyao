// ============================================================================
// 四个动作（对应原 Installer.cs 的 Actions）：安装 / 自启 / 起站实况 / 卸载维护
//
// 这里不做任何安装逻辑，只做"调引擎 + 接回退出码 + 回查"。
// 自启的三种模式各自对应一个真实机制，不发明第四种：
//   不注册 / 登录时（HKCU Run，免管理员，但要随登录起仪表盘才不闪黑框）/
//   开机时（计划任务 SYSTEM，需管理员；客户端 Windows 常被策略拒 → rc 4 降级为登录自启并明说）
// 实测过的那条也在：本机非提权连 schtasks /sc onlogon 都被拒，所以登录态一律走 Run 键。
// ============================================================================
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const core = require('./core.cjs');

const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const RUN_VALUE = 'BianwangDashboard';

function sameDir(a, b) {
  return String(a).replace(/[\\/]+$/, '').toLowerCase() === String(b).replace(/[\\/]+$/, '').toLowerCase();
}

function rememberTarget(st) {
  try {
    fs.writeFileSync(path.join(st.pkgInstaller, 'target.txt'), st.target + '\n', 'utf8');
    return true;
  } catch (e) {
    return false;
  }
}

// 端口由 autostart.cmd 记（port.txt 的格式归它管），这里只在登录自启时补写一份
function writePortFile(dir, port) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'port.txt'), String(port) + '\n', 'utf8');
    return true;
  } catch (e) {
    return false;
  }
}

async function install(st, installNode, line) {
  line('[*] 环境体检：installer\\env.cmd（只检测，不动系统）');
  let rc = (await core.runEngine('env.cmd', '', line)).rc;
  if (rc !== 0) {
    if (rc === 2 && installNode) {
      line('[*] 按要求装/更新 Node.js（走 winget，需要网络）');
      rc = (await core.runEngine('env.cmd', '/install', line)).rc;
      if (rc !== 0) {
        line('[X] 运行时还是不可用（退出码 ' + rc + '）。按上面的指引装完再回来点安装。');
        return 10;
      }
    } else if (rc === 2) {
      line('[-] 缺运行时。离线包本不该走到这里——自检的「运行时」那项说明谁在供 node。');
      line('    要装系统 Node：勾选"顺手装 Node.js"再点一次安装。');
      return 11;
    } else {
      line('[X] 环境这一步没过去（退出码 ' + rc + '）');
      return 12;
    }
  }

  const inplace = sameDir(st.target, st.pkgRoot);
  line('[*] 部署：installer\\deploy.cmd "' + st.target + '"' + (inplace ? ' /inplace' : ''));
  const d = await core.runEngine('deploy.cmd', '"' + st.target + '"' + (inplace ? ' /inplace' : ''), line);
  if (d.rc !== 0) {
    line('[X] 部署没完成（退出码 ' + d.rc + '）。上面 deploy.cmd 已说明原因。');
    return d.rc;
  }
  rememberTarget(st);
  line('[i] 落点已记在 installer\\target.txt（换地方就在上面那栏改）');
  if (inplace) {
    line('[i] 就地安装：包所在目录就是站点目录，deploy 只做了核对、播种与现编仪表盘');
  }
  return 0;
}

async function startOnce(st, line) {
  if (!(st.port > 0)) {
    line('[X] 没给端口。自启要在没人能填端口的时刻起站，猜一个比不装更糟。');
    return false;
  }
  const r = await core.runEngine('autostart.cmd', '/port ' + st.port + ' /site:none /dash:off', line);
  if (r.rc !== 0) {
    line('[X] 端口没能记下（autostart.cmd 退出码 ' + r.rc + '），也没起站。');
    return false;
  }
  return startSiteDetached(st, line);
}

// run-site.cmd 会一直跟着 node 不返回，所以要脱离本进程起一个会话；
// 它自己把输出写进 installer\run-site.log，这里不需要再管管道
function startSiteDetached(st, line) {
  const runSite = path.join(st.engineDir, 'run-site.cmd');
  if (!fs.existsSync(runSite)) {
    line('[X] ' + runSite + ' 不在');
    return false;
  }
  try {
    const child = spawn('cmd.exe', ['/d', '/c', '"' + runSite + '"'], {
      detached: true,
      windowsHide: true,
      windowsVerbatimArguments: true,
      stdio: 'ignore',
      cwd: st.engineDir
    });
    child.unref();
  } catch (e) {
    line('[X] 起站会话没开起来：' + e.message + '（也可以手跑 installer\\run-site.cmd）');
    return false;
  }
  line('[*] 已在独立会话里起站，日志 installer\\run-site.log');
  return true;
}

function regAddRun(value) {
  const res = spawnSync('reg', ['add', RUN_KEY, '/v', RUN_VALUE, '/t', 'REG_SZ', '/d', value, '/f'],
    { windowsHide: true, encoding: 'utf-8', timeout: 10000 });
  return !res.error && res.status === 0;
}

function regDeleteRun() {
  const res = spawnSync('reg', ['delete', RUN_KEY, '/v', RUN_VALUE, '/f'],
    { windowsHide: true, encoding: 'utf-8', timeout: 10000 });
  return res.status === 0;
}

async function registerLogon(st, line) {
  if (!fs.existsSync(st.targetDashExe)) {
    line('[X] ' + st.targetDashExe + ' 不在——登录自启要指向它。先跑安装段（安装时会在本机现编它）。');
    return 6;
  }
  line('[*] 注册登录自启：HKCU\\...\\Run = ' + RUN_VALUE);
  if (!regAddRun('"' + st.targetDashExe + '" --autostart')) {
    line('[X] Run 键写不进去（组策略禁注册表？）');
    return 7;
  }
  // 判"建成"要回查：写完读回来不含 --autostart 就是没成（A-14 同一类错）
  const back = core.regReadRunValue();
  if (!back || back.indexOf('--autostart') < 0) {
    line('[X] 写完读回来不对："' + back + '"');
    return 8;
  }
  if (!writePortFile(st.targetInstaller, st.port)) {
    line('[-] 端口记录没写进去；首次登录时请在仪表盘里手填');
  }
  line('[ok] 回查通过：' + back);
  line('[*] 顺带把站点现在起一次…');
  startSiteDetached(st, line);
  line('    差别：这条只在有人登录之后才起站；登录前不可达。');
  return 0;
}

// 返回 0 = 选定模式已生效；4 = 开机模式被策略拒、已降级为登录自启；其余为失败
async function applyAutostart(st, mode, withDashboard, line) {
  if (!(st.port > 0)) {
    line('[X] 没给端口。自启是要在没人能填端口的时刻起站的，猜一个比不装更糟。');
    return 3;
  }
  if (mode === 'boot') {
    line('[*] 注册开机自启：计划任务 BianwangSite（ONSTART，身份 SYSTEM）…');
    const r = await core.runEngine('autostart.cmd',
      '/port ' + st.port + ' /site:boot /dash:' + (withDashboard ? 'on' : 'off'), line);
    if (r.rc === 0) {
      line('[ok] 已注册并回查过：无人登录也能访问 ' + st.url);
      return 0;
    }
    if (r.rc === 4) {
      line('');
      line('[-] 这台机器不让任务取 SYSTEM 身份（客户端 Windows 的策略常见）。');
      line('    已自动降级：改用登录自启（HKCU Run，不需要管理员）。');
      line('    差别：登录前网站不可达；要真正开机可达得换 Windows Server。');
      const rc2 = await registerLogon(st, line);
      return rc2 === 0 ? 4 : rc2;
    }
    if (r.rc === 1) {
      line('[X] 未提权，开机任务建不了。登录自启不需要管理员——改选它就行。');
      return 1;
    }
    line('[X] 注册没完成（退出码 ' + r.rc + '）');
    return r.rc;
  }

  if (mode === 'logon') {
    if (withDashboard) return registerLogon(st, line);
    line('[X] 只勾了站点没勾仪表盘：登录态起站就是靠仪表盘带起来的'
      + '（run-site.cmd 挂在 Run 键上会闪一个黑框）。请勾"随登录起仪表盘"，或选开机自启。');
    return 5;
  }

  line('[*] 不注册任何自启：撤掉既有任务与 Run 键，站点只现在起一次…');
  // 没有任务就别去 schtasks /delete：那条在无管理员时只会打印一段提权说明，
  // 让人以为出了错（实测 mode=none 的日志被它污染过）
  if (core.taskState('BianwangSite') === 'present' || core.taskState('BianwangDashboard') === 'present') {
    await core.runEngine('autostart.cmd', '/remove', line);
  } else {
    line('    计划任务本来就没注册，无需撤。');
  }
  regDeleteRun();
  const up = await startOnce(st, line);
  line(up
    ? '[ok] 现在起着；因为没注册自启，重启后要在维护段再点一次起站'
    : '[-] 站点这次没能起来，日志见维护段');
  return up ? 0 : 9;
}

async function liveCheck(st, line) {
  if (!(st.port > 0)) {
    line('[X] 没有端口记录，无法实访。先在自启段给一个端口。');
    return 2;
  }
  const listening = await core.portListening(st.port);
  if (!listening) {
    line('[X] 端口 ' + st.port + ' 上没人听着——站点没起。维护段点"起站"。');
    return 3;
  }
  const m = await core.menuProbe(st.url);
  if (m.ok) {
    line('[ok] ' + st.url + ' 的 /api/menu 回了 ' + m.status + '；链路通');
    return 0;
  }
  line('[-] 端口开着但 /api/menu 没回 200：' + (m.status || m.error));
  if (st.scheme === 'https') {
    line('    若日志写着"证书不在，拒绝起站"，那是刻意的：它在你要 HTTPS 时不会退回明文。');
  }
  return 4;
}

async function uninstall(st, args, line) {
  // /quiet 的口径是"停进程 + 撤任务与 Run 键，文件一律留着"。删目录归控制面板里
  // 那条卸载条目（NSIS 的 UninstallString），不归这里：uninstall.cmd 只有交互输入
  // DELETE 才会真删，无人值守时它不该删任何东西。
  line('[*] 调 uninstall.cmd /quiet（停站点、撤自启，程序目录保留）');
  const r = await core.runEngine('uninstall.cmd', args || '/quiet', line);
  line('    要连程序目录一起删：控制面板 → 辨妄阁 → 卸载（那条会先跑同样的停站与撤注册，再删目录）。');
  return r.rc;
}

function credentialNote(st) {
  try {
    const hit = fs.readdirSync(st.target).find((f) => f.endsWith('.txt') && f.indexOf('口令') >= 0);
    return hit ? path.join(st.target, hit) : null;
  } catch (e) {
    return null;
  }
}

module.exports = {
  install, applyAutostart, startOnce, startSiteDetached, liveCheck, uninstall,
  registerLogon, credentialNote, rememberTarget, sameDir
};