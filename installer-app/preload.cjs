// 界面侧唯一的通道：不暴露 fs/child_process，只暴露这几个动词。
// 装到一半的机器上，能少一个可被页面脚本调用的原生能力就少一个。
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('setup', {
  state: () => ipcRenderer.invoke('site:state'),
  mutate: (patch) => ipcRenderer.invoke('site:mutate', patch),
  audit: () => ipcRenderer.invoke('audit:run'),
  install: (opt) => ipcRenderer.invoke('action:install', opt),
  autostart: (opt) => ipcRenderer.invoke('action:autostart', opt),
  live: () => ipcRenderer.invoke('action:live'),
  start: () => ipcRenderer.invoke('action:start'),
  uninstall: (opt) => ipcRenderer.invoke('action:uninstall', opt),
  creds: () => ipcRenderer.invoke('action:creds'),
  openSite: () => ipcRenderer.invoke('action:open-site'),
  pickDir: () => ipcRenderer.invoke('dialog:pick-dir'),
  runtime: () => ipcRenderer.invoke('runtime:info'),
  onLine: (fn) => ipcRenderer.on('log:line', (_e, text) => fn(text)),
  onAuditItem: (fn) => ipcRenderer.on('audit:item', (_e, item) => fn(item))
});
