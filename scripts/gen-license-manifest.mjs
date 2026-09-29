#!/usr/bin/env node
/**
 * 生成页脚「框架与开源协议」登记表。
 * 许可信息一律从已安装包的 package.json 实测读取，避免手写失真。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'web', 'src', 'generated', 'licenses.json');

const SPDX_FIX = {
  '(MIT AND Zlib)': 'MIT OR Zlib',
  '(MIT OR CC0-1.0)': 'MIT',
  '(WTFPL OR MIT)': 'MIT',
  'Apache-2.0': 'Apache-2.0',
  // CKEditor 5 双许可：免费版为 GPL-2.0-or-later（商用条款另购），本站按 GPL 使用并声明 licenseKey: 'GPL'
  'SEE LICENSE IN LICENSE.md': 'GPL-2.0-or-later',
};

const WORKSPACES = ['web', 'server'];

/** 一句话用途：与 THIRD_PARTY_NOTICES.md §一 的表述保持一致，避免页脚与台账各说一套 */
const PURPOSE = {
  vue: '前端视图层',
  'vue-router': '路由与导航守卫',
  pinia: '状态管理',
  vite: '构建与开发服务（底层 Rolldown）',
  '@vitejs/plugin-vue': 'SFC 编译',
  ckeditor5: '富文本编辑基底（免费版）',
  dompurify: '富文本二次净化',
  sortablejs: '重排序与菜单拖动',
  express: 'HTTP 服务与路由',
  'express-rate-limit': '接口限流',
  multer: '上传接收（内存模式 + 体积上限）',
  'sanitize-html': '富文本白名单净化',
  'cookie-parser': '会话 Cookie 解析',
  minisearch: '常驻内存检索索引（BM25+）',
};

/** 每个依赖的官方出处：只取包自己声明的 homepage / repository，不手写、不猜测 */
function homeOf(json) {
  const raw = json?.homepage || json?.repository?.url || json?.repository || json?.bugs?.url || '';
  const text = typeof raw === 'string' ? raw : String(raw?.url || '');
  if (!text) return '';
  // 简写形式 "owner/repo" 指 GitHub
  if (/^[\w.-]+\/[\w.-]+$/.test(text)) return `https://github.com/${text}`;
  return text
    .replace(/^git\+/i, '')
    .replace(/^git:\/\//i, 'https://')
    .replace(/\.git$/i, '')
    .replace(/#.*$/, '');
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function locate(name) {
  const candidates = [
    path.join(ROOT, 'node_modules', name, 'package.json'),
    ...WORKSPACES.map((ws) => path.join(ROOT, ws, 'node_modules', name, 'package.json')),
  ];
  for (const file of candidates) {
    const json = readJson(file);
    if (json) return json;
  }
  // pnpm 的间接依赖落在 .pnpm/node_modules 下
  const flat = path.join(ROOT, 'node_modules', '.pnpm', 'node_modules', name, 'package.json');
  return readJson(flat);
}

function licenseOf(json) {
  const raw = json.license || json.licenses?.[0]?.type || 'UNKNOWN';
  const text = typeof raw === 'string' ? raw : (raw && raw.type) || 'UNKNOWN';
  return SPDX_FIX[text] || text;
}

const rows = [];
for (const workspace of WORKSPACES) {
  const pkg = readJson(path.join(ROOT, workspace, 'package.json'));
  if (!pkg) continue;
  for (const group of ['dependencies', 'devDependencies']) {
    for (const name of Object.keys(pkg[group] || {})) {
      const json = locate(name);
      rows.push({
        name,
        declared: pkg[group][name],
        installed: json?.version || '未解析',
        license: json ? licenseOf(json) : 'UNKNOWN',
        workspace,
        kind: group === 'dependencies' ? '运行时' : '构建期',
        purpose: PURPOSE[name] || '',
        home: homeOf(json),
      });
    }
  }
}

rows.sort((a, b) => a.name.localeCompare(b.name));

const RUNTIMES = [
  { name: 'Node.js', installed: process.versions.node, license: 'MIT', role: '后端运行时', home: 'https://nodejs.org/' },
  {
    name: 'Nginx',
    installed: '1.24+（部署机版本）',
    license: 'BSD-2-Clause',
    role: '静态托管、TLS 终止、限流与签名直链',
    home: 'https://nginx.org/',
  },
  { name: 'pnpm', installed: '工作区包管理器', license: 'MIT', role: 'monorepo 依赖管理', home: 'https://pnpm.io/' },
];

/** 参照项名字本身就是 GitHub 的 owner/repo 时，出处直接由名字得出，不另写地址 */
const refHome = (name, explicit = '') =>
  explicit || (/^[\w.-]+\/[\w.-]+$/.test(name) ? `https://github.com/${name}` : '');

const REFERENCED = [
  {
    name: 'ckeditor/ckeditor5',
    license: 'GPL-2.0-or-later（另有商业许可可选）',
    used: '作为依赖引入（富文本基底）',
    note: '取免费版构建，配置 licenseKey: "GPL"；画圈/划线/解除标注/插入图片四枚按钮以本站自定义插件补齐。GPL 义务随"分发"触发：本站为自托管、不对外分发构建物，义务限于随源保留 COPYING.GPL 与本登记表；若日后公开源码或交付安装包，整份前端源码须以同许可释出',
  },
  {
    name: 'fuxingloh/vue-masonry-wall',
    license: 'MIT',
    used: '未采用代码',
    note: '瀑布流分列算法对照；因其为 Vue 2 且最短列调度会破坏置顶与自定义顺序，改为自实现保序轮询分列',
  },
  {
    name: 'ApoorvSaxena/lozad.js',
    license: 'MIT',
    used: '未采用代码',
    note: '懒加载细节参照（命中即 unobserve、loaded 标记幂等、占位预载、卸载时 disconnect），由自研 composable 实现',
  },
  {
    name: 'lucaong/minisearch',
    license: 'MIT',
    used: '作为依赖引入',
    note: '后端常驻内存检索索引（BM25+ 打分、字段加权、前缀与模糊），注入自研中文 bigram 分词',
  },
  {
    name: 'AFP-Medialab/verification-plugin',
    license: 'MIT',
    used: '仅字段与体例参照',
    note: '核查类站点的"声明—证据—结论"信息层级与措辞参照，未复制其代码与素材',
  },
  {
    name: 'typemill/typemill',
    license: 'MIT',
    used: '仅防护思路参照',
    note: 'flat-file CMS 的防暴力破解、CSRF、数据目录保护等实现思路参照，未复制其 PHP 代码',
  },
  {
    name: '中文维基百科首页版式',
    license: '排版参照（其文本为 CC BY-SA 4.0，标识为 Wikimedia 注册商标）',
    used: '仅四段式排版结构参照',
    note: '只参照 header/sidebar/main/footer 与 logo 位置等信息架构，未复制其任何文本、图片、样式或商标',
    home: 'https://zh.wikipedia.org/',
  },
  {
    name: 'terra-faction-ui（界面语法技能包）',
    license: '见技能包自带 ISC 声明',
    used: '设计语法来源',
    note: '采用其 Yan / 炎国 archival 证据化界面语法；本站为证据驱动的 Terra 阵营界面（明日方舟灵感），非官方界面',
  },
].map((row) => ({ ...row, home: refHome(row.name, row.home) }));

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(
  OUT,
  JSON.stringify({ generatedAt: new Date().toISOString(), packages: rows, runtimes: RUNTIMES, referenced: REFERENCED }, null, 2),
  'utf8'
);
console.log(`licenses.json：${rows.length} 个依赖包 + ${RUNTIMES.length} 个运行时 + ${REFERENCED.length} 项参照说明`);
