// 渲染层：只碰 DOM，不做任何判断。所有结论来自主进程（也就是那六个 .cmd 引擎）。
'use strict';

const $ = (sel) => document.querySelector(sel);
const els = {
  log: $('#log'), checks: $('#checks'), target: $('#targetInput'), port: $('#portInput'),
  btnAudit: $('#btnAudit'), btnInstall: $('#btnInstall'), btnAutostart: $('#btnAutostart'),
  btnPick: $('#btnPick'), btnClear: $('#btnClear'), btnLive: $('#btnLive'), btnOpen: $('#btnOpen'),
  btnStart: $('#btnStart'), btnCreds: $('#btnCreds'), btnUninstall: $('#btnUninstall'),
  installBusy: $('#installBusy'), installHint: $('#installHint'), openUrl: $('#openUrl'),
  pkgNote: $('#pkgNote'), rtNote: $('#rtNote'), schemeNote: $('#schemeNote'), adminNote: $('#adminNote'),
  verdict: $('#verdictTitle'), nodeInstall: $('#nodeInstall'), dashCheck: $('#dashCheck')
};

const SEAL_GLYPH = { pass: '✓', warn: '!', fail: '✗', info: '·' };
let state = null;
let auditing = false;

function line(text) {
  els.log.textContent += (els.log.textContent ? '\n' : '') + text;
  els.log.scrollTop = els.log.scrollHeight;
}

function railState(stage, text, tone) {
  const el = document.querySelector('[data-state-for="' + stage + '"]');
  if (!el) return;
  el.textContent = text;
  el.dataset.live = tone || '';
}

function showStage(stage) {
  document.querySelectorAll('.gate').forEach((g) => {
    const on = g.dataset.stage === stage;
    g.classList.toggle('is-current', on);
    if (on) g.setAttribute('aria-current', 'step'); else g.removeAttribute('aria-current');
  });
  ['audit', 'install', 'autostart', 'maintain'].forEach((s) => {
    const pane = $('#pane-' + s);
    pane.hidden = s !== stage;
    pane.classList.toggle('is-open', s === stage);
  });
}

function applyState(next) {
  state = next;
  els.pkgNote.textContent = '包根 ' + state.pkgRoot + ' · 引擎目录 ' + state.engineDir;
  els.target.value = state.target;
  if (state.port > 0) els.port.value = String(state.port);
  els.schemeNote.textContent = state.scheme + (state.scheme === 'https'
    ? (state.tlsFrom === 'nginx' ? '（前置 Nginx）' : '（后端持证书）') : '（默认档）');
  els.adminNote.textContent = state.isAdmin ? '是' : '否（开机自启会拒）';
  railState('install', state.deployed ? '已安装' : '未开始', state.deployed ? 'ok' : '');
  if (state.deployed) railState('maintain', '可用', 'ok');
}

async function refresh() {
  applyState(await window.setup.state());
  const rt = await window.setup.runtime();
  els.rtNote.textContent = rt.kind === 'electron'
    ? (rt.text || '读不到版本') + '（包内）'
    : (rt.text || 'PATH 上没有 node');
}

function renderCheck(c) {
  const li = document.createElement('li');
  li.className = 'check';
  li.dataset.v = c.verdict;
  const seal = document.createElement('span');
  seal.className = 'seal';
  seal.setAttribute('aria-hidden', 'true');
  const glyph = document.createElement('span');
  glyph.className = 'seal-glyph';
  glyph.textContent = SEAL_GLYPH[c.verdict] || '·';
  seal.appendChild(glyph);
  const name = document.createElement('span');
  name.className = 'check-name';
  name.textContent = c.name + (c.required ? '' : '（次要）');
  const detail = document.createElement('span');
  detail.className = 'check-detail';
  detail.textContent = c.detail;
  li.append(seal, name, detail);
  if (c.fix) {
    const fix = document.createElement('p');
    fix.className = 'check-fix';
    fix.textContent = c.fix;
    li.appendChild(fix);
  }
  els.checks.appendChild(li);
}

async function runAudit() {
  if (auditing) return;
  auditing = true;
  els.checks.textContent = '';
  els.btnAudit.disabled = true;
  railState('audit', '核验中', 'busy');
  try {
    const r = await window.setup.audit();
    railState('audit', r.fails === 0 ? '通过 ' + r.total + ' 项' : r.fails + ' 项不过', r.fails === 0 ? 'ok' : 'bad');
    els.verdict.textContent = r.fails === 0 ? '自检通过' : '自检有必需项未过';
    els.verdict.dataset.verdict = r.fails === 0 ? 'pass' : 'fail';
    els.btnInstall.disabled = r.fails > 0;
    els.installHint.textContent = r.fails > 0
      ? '自检里还有 ' + r.fails + ' 项必需检查没过——按"处理"那条修完重跑自检'
      : '自检通过，可以钤印';
  } finally {
    auditing = false;
    els.btnAudit.disabled = false;
  }
}

async function runInstall() {
  els.btnInstall.disabled = true;
  els.installBusy.hidden = false;
  railState('install', '进行中', 'busy');
  try {
    const next = await window.setup.mutate({ target: els.target.value, port: parseInt(els.port.value, 10) || 0 });
    applyState(next);
    const r = await window.setup.install({ nodeInstall: els.nodeInstall.checked });
    railState('install', r.rc === 0 ? '已安装' : '退出码 ' + r.rc, r.rc === 0 ? 'ok' : 'bad');
    if (r.rc === 0) {
      applyState(r.state);
      els.verdict.textContent = '已安装';
      showStage('autostart');
    } else {
      els.btnInstall.disabled = false;
    }
  } finally {
    els.installBusy.hidden = true;
  }
}

async function runAutostart() {
  els.btnAutostart.disabled = true;
  railState('autostart', '登记中', 'busy');
  try {
    const mode = (document.querySelector('input[name="amode"]:checked') || {}).value || 'none';
    const r = await window.setup.autostart({
      mode,
      port: parseInt(els.port.value, 10) || 0,
      withDashboard: els.dashCheck.checked
    });
    if (r.rc === 0) {
      railState('autostart', mode === 'boot' ? '开机即起' : mode === 'logon' ? '随登录' : '不注册', 'ok');
      applyState(r.state);
      showStage('maintain');
    } else if (r.rc === 4) {
      railState('autostart', '已降级为随登录', 'busy');
    } else {
      railState('autostart', '退出码 ' + r.rc, 'bad');
    }
  } finally {
    els.btnAutostart.disabled = false;
  }
}

async function withBusy(btn, fn) {
  if (btn.disabled) return;
  btn.disabled = true;
  try { await fn(); } finally { btn.disabled = false; }
}

function bind() {
  document.querySelectorAll('.gate').forEach((g) => g.addEventListener('click', () => showStage(g.dataset.stage)));
  els.btnAudit.addEventListener('click', runAudit);
  els.btnInstall.addEventListener('click', runInstall);
  els.btnAutostart.addEventListener('click', runAutostart);
  els.btnClear.addEventListener('click', () => { els.log.textContent = ''; });
  els.btnPick.addEventListener('click', async () => {
    const dir = await window.setup.pickDir();
    if (dir) els.target.value = dir;
  });
  els.btnLive.addEventListener('click', () => withBusy(els.btnLive, async () => {
    const r = await window.setup.live();
    railState('maintain', r.rc === 0 ? '在运行' : '核验未过（' + r.rc + '）', r.rc === 0 ? 'ok' : 'bad');
  }));
  els.btnOpen.addEventListener('click', () => withBusy(els.btnOpen, async () => {
    const r = await window.setup.openSite();
    if (!r.ok) line('[-] 打不开：' + (r.reason === 'no-port' ? '还没有端口记录' : '端口 ' + (r.url || '') + ' 上没人听着'));
    else els.openUrl.textContent = r.url;
  }));
  els.btnStart.addEventListener('click', () => withBusy(els.btnStart, async () => {
    const r = await window.setup.start();
    applyState(r.state);
    railState('maintain', r.ok ? '已起一次' : '没起来', r.ok ? 'ok' : 'bad');
  }));
  els.btnCreds.addEventListener('click', () => withBusy(els.btnCreds, () => window.setup.creds()));
  els.btnUninstall.addEventListener('click', () => withBusy(els.btnUninstall, async () => {
    const sure = window.confirm('卸载会停任务、删计划任务与 Run 键。数据目录（api\\data，含档案与口令表）默认保留并备份到 %TEMP%。\n继续？');
    if (!sure) return;
    const r = await window.setup.uninstall();
    railState('maintain', r.rc === 0 ? '已卸载' : '退出码 ' + r.rc, r.rc === 0 ? '' : 'bad');
    await refresh();
  }));
  window.setup.onLine(line);
  window.setup.onAuditItem(renderCheck);
}

bind();
refresh().then(runAudit).catch((e) => line('[X] 初始化失败：' + e.message));
