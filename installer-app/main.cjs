// ============================================================================
// 窗口与 IPC：界面只管呈现，做事的一直是 core.cjs / audit.cjs / actions.cjs，
// 而那三个又只是 installer\*.cmd 的前置。层数到此为止，不再加抽象。
// ============================================================================
'use strict';

const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const core = require('./core.cjs');
const auditMod = require('./audit.cjs');
const actions = require('./actions.cjs');

let win = null;
const log = [];

// 站点、仪表盘与安装器共用 %APPDATA%\Bianwang：协议与端口就存在那儿的 dashboard.cfg
app.setName('BianwangSetup');
try { app.setPath('userData', core.appDataBianwang()); } catch (e) { /* 拿不到就按默认，不挡安装 */ }

function sendLine(text) {
  log.push(text);
  if (win && !win.isDestroyed()) win.webContents.send('log:line', text);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 780,
    minWidth: 880,
    minHeight: 620,
    title: '辨妄阁 · 一键安装',
    backgroundColor: '#fbf8f1',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });
  win.loadFile(path.join(__dirname, 'ui', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => { win = null; });
  // 界面里任何链接都不该开内嵌浏览器：装完就走的机器上没那个必要
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

// 装成一次就落一份带日期的取证文件；口径沿用 C# 版：报告不靠猜编码，写 BOM
function writeReport(st, kind) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = path.join(st.pkgInstaller, 'setup-report-' + kind + '-' + stamp + '.txt');
  try {
    fs.writeFileSync(file, '\ufeff' + log.join('\r\n') + '\r\n', 'utf8');
    return file;
  } catch (e) {
    return null;
  }
}

ipcMain.handle('site:state', () => core.site());

ipcMain.handle('site:mutate', (_e, patch) => {
  // 目标目录/端口可以在界面上改；端口仍按"命令行 > port.txt > dashboard.cfg"的次序回落
  const st = core.site();
  if (patch && typeof patch.target === 'string' && patch.target.trim()) {
    core.setTargetOverride(patch.target.trim());
  }
  if (patch && Number.isInteger(patch.port) && patch.port > 0) core.setPortOverride(patch.port);
  return core.site();
});

ipcMain.handle('audit:run', async () => {
  const st = core.site();
  sendLine('==== 自检 · 包根 ' + st.pkgRoot + ' ====');
  const items = await auditMod.audit(st);
  items.forEach((c) => win && !win.isDestroyed() && win.webContents.send('audit:item', c));
  const fails = items.filter((c) => c.verdict === 'fail' && c.required).length;
  sendLine(fails === 0 ? '结论：可以安装。' : '结论：有 ' + fails + ' 项必需检查没过，先按"处理"那条来。');
  const file = writeReport(st, 'selfcheck');
  if (file) sendLine('[i] 报告已落盘：' + file);
  return { fails, total: items.length };
});

ipcMain.handle('action:install', async (_e, opt) => {
  const o = opt || {};
  const st = core.site();
  sendLine('==== 安装 -> ' + st.target + ' ====');
  const rc = await actions.install(st, !!o.nodeInstall, sendLine);
  writeReport(st, 'install');
  return { rc, state: core.site() };
});

ipcMain.handle('action:autostart', async (_e, opt) => {
  const o = opt || {};
  if (Number.isInteger(o.port) && o.port > 0) core.setPortOverride(o.port);
  const st = core.site();
  sendLine('==== 自启：' + o.mode + ' · 目标 ' + st.target + ' · 端口 ' + st.port + ' ====');
  const rc = await actions.applyAutostart(st, String(o.mode || 'none'), o.withDashboard !== false, sendLine);
  writeReport(st, 'autostart');
  return { rc, state: core.site() };
});

ipcMain.handle('action:live', async () => {
  const st = core.site();
  return { rc: await actions.liveCheck(st, sendLine), url: st.url };
});

ipcMain.handle('action:start', async () => {
  const st = core.site();
  sendLine('==== 现在起一次（不注册任何自启）====');
  return { ok: await actions.startOnce(st, sendLine), state: core.site() };
});

ipcMain.handle('action:uninstall', async () => {
  const st = core.site();
  sendLine('==== 卸载 · 目标 ' + st.target + ' ====');
  const rc = await actions.uninstall(st, '/quiet', sendLine);
  writeReport(st, 'uninstall');
  return { rc };
});

ipcMain.handle('action:creds', () => {
  const st = core.site();
  const note = actions.credentialNote(st);
  if (!note) {
    sendLine('[-] 口令记录还没生成：' + st.target + ' 下没有那个文件（站点没起过）');
    return { ok: false };
  }
  sendLine('[ok] ' + note);
  shell.openPath(note);
  return { ok: true, path: note };
});

ipcMain.handle('action:open-site', async () => {
  const st = core.site();
  if (!st.url) return { ok: false, reason: 'no-port' };
  const up = await core.portListening(st.port);
  if (!up) return { ok: false, reason: 'down', url: st.url };
  shell.openExternal(st.url);
  return { ok: true, url: st.url };
});

ipcMain.handle('dialog:pick-dir', async () => {
  if (!win) return null;
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('runtime:info', () => {
  const rt = core.resolveRuntime();
  return { kind: rt.kind, text: rt.text, exe: rt.exe };
});

// 一台机器同时只开一个安装器：装到一半再开一个，第二份会看见第一份写到一半的目录
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => app.quit());
}
