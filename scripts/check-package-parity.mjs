#!/usr/bin/env node
/**
 * 出包后回读：逐件比对仓库与包内树的字节，证明"包内文本＝仓库文本"。
 * 用法：node scripts/check-package-parity.mjs [包树路径]
 * 默认 outputs/package/bianwang-<package.json 的版本>-offline-win（＝NSIS 解包后的落点，含站点那半）
 *
 * 为什么要有这一步：闸门校验的是字节与清单，校不出"文字还是上一轮形态的"（A-31），
 * 也校不出改了 `server/` 却没重拷进包（本轮 E-10 就同时落在两侧）。所以出完包必须回读。
 * 不参与比对：包内的 `README-FIRST.md` 与 `MANIFEST.md`——这两份由 `rewriteDocs()` 按包形态改写，本来就该与仓库不同。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = path.resolve(import.meta.dirname, '..');
// 版本从 package.json 读，不写死：升版时如果这里还指着旧树，比的就不是当轮交付物
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const TREE = path.resolve(process.argv[2] || path.join(ROOT, 'outputs', 'package', `bianwang-${VERSION}-offline-win`));
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

// 仓库路径 → 包内路径
const PAIRS = [
  ['server/src/index.js', 'api/src/index.js'],
  ['server/src/config.js', 'api/src/config.js'],
  ['server/src/security/middleware.js', 'api/src/security/middleware.js'],
  ['server/src/security/media.js', 'api/src/security/media.js'],
  ['README.md', 'docs/README.md'],
  ['DEPLOY.md', 'docs/DEPLOY.md'],
  ['USAGE.md', 'docs/USAGE.md'],
  ['DEVELOPMENT.md', 'docs/DEVELOPMENT.md'],
  ['THIRD_PARTY_NOTICES.md', 'docs/THIRD_PARTY_NOTICES.md'],
  ['installer/setup.cmd', 'installer/setup.cmd'],
  ['installer/runtime.cmd', 'installer/runtime.cmd'],
  ['installer/env.cmd', 'installer/env.cmd'],
  ['installer/deploy.cmd', 'installer/deploy.cmd'],
  ['installer/autostart.cmd', 'installer/autostart.cmd'],
  ['installer/run-site.cmd', 'installer/run-site.cmd'],
  ['installer/creds.cmd', 'installer/creds.cmd'],
  ['installer/uninstall.cmd', 'installer/uninstall.cmd'],
  ['installer/startup-imports.json', 'installer/startup-imports.json'],
  ['installer/offline.nsi', 'installer/offline.nsi'],
  ['installer-app/core.cjs', 'runtime/resources/app/core.cjs'],
  ['installer-app/main.cjs', 'runtime/resources/app/main.cjs'],
  ['installer-app/actions.cjs', 'runtime/resources/app/actions.cjs'],
  ['installer-app/audit.cjs', 'runtime/resources/app/audit.cjs'],
  ['installer-app/preload.cjs', 'runtime/resources/app/preload.cjs'],
  ['installer-app/package.json', 'runtime/resources/app/package.json'],
  ['installer-app/ui/index.html', 'runtime/resources/app/ui/index.html'],
  ['installer-app/ui/app.js', 'runtime/resources/app/ui/app.js'],
  ['installer-app/ui/styles.css', 'runtime/resources/app/ui/styles.css'],
  ['dashboard/Dashboard.cs', 'dashboard/Dashboard.cs'],
  ['nginx/bianwang-http.conf', 'nginx/bianwang-http.conf'],
  ['nginx/bianwang-proxy.inc', 'nginx/bianwang-proxy.inc'],
  ['nginx/bianwang.conf', 'nginx/bianwang.conf'],
  ['ops-extras/verify-deploy.mjs', 'ops/verify-deploy.mjs'],
];

if (!fs.existsSync(TREE)) {
  console.error(`✗ 包树不存在：${TREE}\n  先跑 node scripts/make-offline-package.mjs --write 再回读。`);
  process.exit(1);
}

const bad = [];
for (const [a, b] of PAIRS) {
  const pa = path.join(ROOT, a);
  const pb = path.join(TREE, b);
  if (!fs.existsSync(pa)) { bad.push(`仓库侧缺件  ${a}`); continue; }
  if (!fs.existsSync(pb)) { bad.push(`包内缺件      ${b}（应等于 ${a}）`); continue; }
  const same = sha(pa) === sha(pb);
  console.log(`${same ? 'SAME' : 'DIFF'}  ${a} ↔ ${b}`);
  if (!same) bad.push(`内容不同      ${a} ↔ ${b}`);
}
console.log('');
if (bad.length) {
  console.error(`✗ ${PAIRS.length} 件里有 ${bad.length} 处不一致：\n` + bad.map((x) => `  - ${x}`).join('\n'));
  console.error('  要么是没重出包，要么是出包脚本的拷贝清单漏了这一件；别拿这一轮的摘要当交付值。');
  process.exit(1);
}
console.log(`✓ ${PAIRS.length} 件逐字节一致，包内文本＝仓库文本。`);
