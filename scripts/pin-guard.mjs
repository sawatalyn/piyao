#!/usr/bin/env node
/**
 * 依赖守卫：把"精确 pin + 许可白名单 + 用途登记"三条口头约定变成会挡人的检查。
 *
 * 为什么要它：本项目交付的是"解压即放到 Nginx 上跑"的包，范围符（^ ~）会让重装拿到不同版本；
 * CKEditor 与 pdfjs 这类**大版本就换 API** 的库尤其危险（DEVELOPMENT.md §六 C-3、D-9 都是升级期踩的）。
 * 许可面同理：AGPL/SSPL/无声明的包一旦混进 dependencies，页脚与 NOTICES 就会与事实不符。
 *
 * 运行：node scripts/pin-guard.mjs（pnpm build 的 prebuild 会先跑生成器再跑本脚本）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = path.join(ROOT, 'web/src/generated/licenses.json');

/** 宽松许可（可直接引入）；CKEditor 的 GPL 与 DOMPurify 的 MPL 是两条已单独核实的例外 */
const PERMISSIVE = /^(MIT|MIT-0|Apache-2\.0|BSD-[23](\.\d)?-Clause|BSD|ISC|CC0-1\.0|0BSD|Unlicense|Python-2\.0|Artistic-2\.0)$/;
const DUAL_OK = /^\(?(MPL-2\.0 OR Apache-2\.0|Apache-2\.0 OR MPL-2\.0|MIT OR CC0-1\.0|\(?(MIT|Apache-2\.0)[^)]*OR[^)]*(MIT|Apache-2\.0)\)?)\)?$/;
const APPROVED_EXCEPTIONS = new Map([
  ['ckeditor5', 'GPL-2.0-or-later'], // 用户点名指定的富文本基底（README §八 / NOTICES §1.1）
]);

const EXACT = /^\d+\.\d+\.\d+$/;
const GROUPS = ['dependencies', 'devDependencies'];

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

const problems = [];
const checked = [];

let manifest = null;
try {
  manifest = readJson(MANIFEST);
} catch {
  problems.push(`读不到 ${path.relative(ROOT, MANIFEST)}；先跑 node scripts/gen-license-manifest.mjs`);
}

const manifestRow = (name) => (manifest?.packages || []).find((p) => p.name === name) || null;

for (const workspace of ['web', 'server']) {
  const pkgPath = path.join(ROOT, workspace, 'package.json');
  const pkg = readJson(pkgPath);
  for (const group of GROUPS) {
    for (const [name, spec] of Object.entries(pkg[group] || {})) {
      checked.push(`${workspace}/${group}/${name}@${spec}`);

      if (!EXACT.test(String(spec))) {
        problems.push(`${workspace} 的 ${name} 声明为 "${spec}"：必须精确 pin（形如 1.2.3），不允许范围符`);
      }

      const row = manifestRow(name);
      if (!row) {
        problems.push(`${name} 不在许可登记表里：生成器没抓到它，或包未安装`);
        continue;
      }
      if (row.installed !== spec) {
        problems.push(`${name} 实际装的是 ${row.installed}，与声明的 ${spec} 不一致（lockfile 或 node_modules 漂移）`);
      }
      if (!row.purpose) {
        problems.push(`${name} 缺"一句话用途"：请在 scripts/gen-license-manifest.mjs 的 PURPOSE 里补，页脚表格不能空着`);
      }

      const license = String(row.license || '');
      const allowed =
        PERMISSIVE.test(license) ||
        DUAL_OK.test(license) ||
        APPROVED_EXCEPTIONS.get(name) === license ||
        (name === 'dompurify' && /MPL-2\.0/.test(license));
      if (!allowed) {
        problems.push(`${name} 的许可是 "${license}"：不在宽松许可白名单内，也没有单独批准记录（见 DEVELOPMENT.md §三）`);
      }
      if (!row.home) {
        problems.push(`${name} 没有可回指的出处：页脚将显示"未声明"，请确认上游确实未声明（不要手写地址）`);
      }
    }
  }
}

const dupes = checked
  .map((c) => c.split('/')[2])
  .filter((n, i, arr) => arr.indexOf(n) !== i)
  .map((n) => n.split('@')[0]);
if (dupes.length) {
  problems.push(`同一包在两个工作区各装一份：${[...new Set(dupes)].join(', ')}（会导致两份实例与两份许可登记）`);
}

if (problems.length) {
  console.error(`FAIL  依赖守卫：${problems.length} 项不合格（共核对 ${checked.length} 条声明）`);
  for (const line of problems) console.error(`  · ${line}`);
  process.exit(1);
}

const runtimes = (manifest?.packages || []).filter((p) => p.kind === '运行时').length;
console.log(`PASS  依赖守卫：${checked.length} 条声明全部精确 pin、许可在册、用途已登记（其中运行时依赖 ${runtimes} 个）`);
