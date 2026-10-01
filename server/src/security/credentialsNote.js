import fs from 'node:fs';
import path from 'node:path';
import { config, ROOT } from '../config.js';
import { users } from '../store/users.js';
import { libraryKeys } from '../store/library.js';

/**
 * 启动时在根目录写一份「口令.txt」，方便本地馆员速查登录口令与镜像入馆口令。
 * 这是**便利文件、含明文口令**：.gitignore 已排除它，打包 FORBIDDEN 也已排除，
 * 绝不进仓库、绝不进部署包。设 BW_CRED_FILE=0 可关掉。
 *
 * 落点：自定义了 BW_DATA_DIR（自检隔离实例、打包 api 首启）就写进那个数据目录本身，
 * 免得多个实例抢写同一个仓库根；否则写进项目根目录（用户从源码启动看到的位置）。
 */
export function credentialsPath() {
  if (process.env.BW_DATA_DIR) return path.join(path.dirname(config.paths.posts), '口令.txt');
  return path.resolve(ROOT, '..', '口令.txt');
}

const clock = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString('zh-CN', { hour12: false });
};

export function renderCredentials(scheme = 'http') {
  const lines = [];
  lines.push('辨妄阁 · 本地口令速查（启动时自动生成）');
  lines.push('='.repeat(48));
  lines.push(`生成时间：${new Date().toLocaleString('zh-CN', { hour12: false })}`);
  lines.push(`访问协议：${scheme}（本次启动实际监听的协议；改协议在仪表盘第 1 栏或设 BW_TLS_*）`);
  lines.push(`数据目录：${path.dirname(config.paths.posts)}`);
  lines.push(`口令存储：${config.hashPasswords ? 'scrypt 哈希（BW_HASH_PASSWORDS=1）' : 'CSV 明文（按需求指定）'}`);
  lines.push('');

  lines.push('【登录账号】（用于后台编辑、馆务台账等，访问 /login）');
  const rows = users.all();
  if (!rows.length) lines.push('  （名册为空）');
  for (const row of rows) {
    const raw = users.find(row.username)?.password ?? '';
    const shown = String(raw).startsWith('scrypt$') ? '（已哈希，无法回显）' : raw;
    lines.push(`  - ${row.username}  口令：${shown}  角色：${row.role}  显示名：${row.displayName}`);
  }
  lines.push('');

  lines.push('【洛琪希图书馆镜像 · 入馆口令】（在 /library 输入以阅览或取书）');
  const keys = libraryKeys.all();
  if (!keys.length) lines.push('  （尚未登记任何口令）');
  for (const key of keys) {
    const scope = key.scope === 'files' ? `指定文件 ${(key.fileIds || []).length} 本` : '全部在架书';
    const status = key.active === false ? '已停用' : key.expiresAt && key.expiresAt < Date.now() ? '已过期' : '启用中';
    const expiry = key.expiresAt ? clock(new Date(key.expiresAt).toISOString()) : '永久';
    lines.push(`  - 口令：${key.code}  名称：${key.label}  范围：${scope}  状态：${status}  到期：${expiry}`);
    if (key.hint) lines.push(`      提示：${key.hint}`);
  }
  lines.push('');

  lines.push('⚠ 安全提醒');
  lines.push('  1) 本文件含明文口令，仅供本机查阅。它已被 .gitignore 与打包排除，请勿手动提交或分发。');
  lines.push('  2) 上生产前请删除本文件、改掉默认 admin/admin，并按需用 BW_HASH_PASSWORDS=1 切哈希。');
  lines.push('  3) 关掉此功能：设环境变量 BW_CRED_FILE=0。');
  if (scheme === 'http') {
    lines.push('  4) 本次以 **明文 HTTP** 起站（当前无证书的已知取舍）：口令与会话在内网链路可被读到，'
      + '请只在受信网段放行；拿到证书后设 BW_TLS_PFX（或 BW_TLS_KEY + BW_TLS_CERT）重启即切 https。');
  }
  lines.push('');
  return `${lines.join('\r\n')}\r\n`;
}

export function writeCredentialsNote(scheme = 'http') {
  if (process.env.BW_CRED_FILE === '0') return null;
  const target = credentialsPath();
  try {
    fs.writeFileSync(target, renderCredentials(scheme), { encoding: 'utf8', mode: 0o600 });
    return target;
  } catch (err) {
    console.warn('[api] 未能写入口令速查文件：', err?.message || err);
    return null;
  }
}
