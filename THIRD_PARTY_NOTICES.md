# 第三方许可与来源台账（THIRD PARTY NOTICES）

本文件记录本项目**引入的依赖**、**参照过的外部仓库**，以及**明确排除**的来源。
页脚表格由 `scripts/gen-license-manifest.mjs` 从已安装依赖的 `package.json` 实测生成，本文件是其带说明的完整版。

判定原则（本次调研与实现全程遵守）：

1. **只有宽松许可（MIT / Apache-2.0 / BSD / ISC / Zlib / 0BSD / CC0）的项目才允许阅读其源码并按需引入。**
2. **AGPL / GPL / LGPL / SSPL 项目一律只读公开文档与界面思路，不复制其代码、不引入其构建产物、不链接其库。**
   例外见 §1.1：富文本基底 CKEditor 5 免费版按用户明确要求引入，其 copyleft 义务已单独核实并在页脚与 README 中声明。
3. **许可声明缺失（`NONE` / `NOASSERTION`）的项目按"不允许取码"处理**，至多参照信息架构层面的通用做法。
4. 任何项目的**美术资源、标识、商标、字体文件、CDN 素材**一律不复制、不打包。
5. **选型先找现成开源，再考虑自研**；采纳与否都要留下"许可实测值 + 为什么"，见 §2.4 与 `DEVELOPMENT.md` §三 3.4。
   已采纳的包全部**精确 pin**，并由 `scripts/pin-guard.mjs` 在构建前核对版本、许可与登记是否仍然一致。

---

## 一、作为依赖引入的组件

| 组件 | 版本 | 协议 | 位置 | 用途 |
| --- | --- | --- | --- | --- |
| vue | 3.5.43 | MIT | 前端 | 视图层 |
| vue-router | 5.3.1 | MIT | 前端 | 路由与导航守卫 |
| pinia | 4.0.3 | MIT | 前端 | 状态管理 |
| vite | 8.3.1 | MIT | 前端 | 构建与开发服务（底层 Rolldown） |
| @vitejs/plugin-vue | 6.0.9 | MIT | 前端 | SFC 编译 |
| dompurify | 3.4.16 | MPL-2.0 **或** Apache-2.0（双许可，取用其一并满足） | 前端 | 富文本二次净化 |
| sortablejs | 1.15.7 | MIT | 前端 | 重排序与菜单拖动 |
| express | 5.2.1 | MIT | 后端 | HTTP 服务与路由 |
| express-rate-limit | 8.7.0 | MIT | 后端 | 接口限流 |
| multer | 2.4.0 | MIT | 后端 | 上传接收（内存模式 + 体积上限） |
| sanitize-html | 2.17.7 | MIT | 后端 | 富文本白名单净化 |
| cookie-parser | 1.4.7 | MIT | 后端 | 会话 Cookie 解析 |
| minisearch | 7.2.0 | MIT | 后端 | 常驻内存检索索引（BM25+） |
| pdfjs-dist | 6.3.289 | Apache-2.0 | 后端 | PDF 在线阅览（书签分节 + 文字层，不做服务端光栅化） |
| diff（jsdiff） | 9.0.0 | BSD-3-Clause | 后端 | 档案版本比对的词/字级差异（`diffWords` + `maxEditLength` 熔断） |
| @rgrove/parse-xml | 5.0.0 | ISC | 后端 | EPUB 的 container/OPF/nav/NCX 严格解析（**零传递依赖**） |
| csv-parse | 7.0.3 | MIT | 后端 | 用户名册 CSV 读取（引号、内嵌换行、CRLF） |
| csv-stringify | 6.9.0 | MIT | 后端 | 用户名册 CSV 写出 |
| ckeditor5 | 48.5.2 | **GPL-2.0-or-later**（双许可，取免费档） | 前端 | 富文本编辑基底，见 §1.1 |

> **全部直接依赖已精确 pin**（`package.json` 里不出现 `^`/`~`/范围符），并由 `scripts/pin-guard.mjs` 在
> `pnpm build` 前逐条核对：声明=实装、许可落在宽松白名单（两个已单独核实的例外：CKEditor 的 GPL、DOMPurify 的
> MPL-2.0 **或** Apache-2.0 双许可）、每个包有"一句话用途"与可回指出处、同一包不在两个工作区各装一份。
> 目标机部署请用 `pnpm install --frozen-lockfile`。

### 1.1 富文本基底：CKEditor 5（copyleft 例外的核实记录）

| 事项 | 核实结论 |
| --- | --- |
| 许可文本 | 包内 `LICENSE.md`：CKEditor 5 采用双许可 —— GPL-2.0-or-later（`COPYING.GPL` 全文随包）或 CKSource 商业许可；许可文件随 `pnpm install` 落盘，未删除 |
| 使用档位 | 免费版（`ckeditor5` 伞包只含免费构件）。`SourceEditing`、`GeneralHtmlSupport`、`FindAndReplace`、`Export to PDF/Word` 等 premium 构件未安装、未引用；圈划/划线/解除标注/插图四枚按钮由 `web/src/editor/yan-markup.js` 以官方插件机制自写 |
| 授权声明 | `RichEditor` 创建编辑器时显式传 `licenseKey: 'GPL'`，不冒用商业密钥，不去除许可提示与水印逻辑 |
| 义务触发面 | GPL 的源码提供义务由**分发**触发。本站自用服务器托管、不对外交付构建物或源码包 → 义务限于随源码保留许可文本与本台账。**若日后开源整站或对外交付安装包，整份前端源码须以 GPL-2.0-or-later 释出**，届时须先与负责人确认 |
| 与净化链路的关系 | 编辑器的 HTML 由本站 `server/src/security/sanitize.js` 白名单二次净化后落库；不依赖 CKEditor 的 `GeneralHtmlSupport`（付费件）来放开自定义 class，批注形制走 `span.anno-*` + `c-*` 预置 class，因此严格 CSP 下无需行内样式 |
| 界面语言 | 取包内自带简体词典 `ckeditor5/dist/translations/zh-cn.js`（同属 GPL-2.0-or-later 的许可范围内数据，非独立第三方作品），随编辑页分包打进构建物；该文件是纯数据默认导出，需在创建实例前并入 `window.CKEDITOR_TRANSLATIONS`，故 `RichEditor` 里有一处显式挂载 |

### 运行时与部署件

| 名称 | 版本 | 协议 | 角色 |
| --- | --- | --- | --- |
| Node.js | 24.14.1（开发机） | MIT | 后端运行时 |
| Nginx | 1.24+（部署机） | BSD-2-Clause | 静态托管、TLS 终止、限流、数据目录防护 |
| pnpm | 11.1.3 | MIT | monorepo 依赖管理 |

> 上述依赖各自的传递依赖（如 `rolldown`、`path-to-regexp`、`htmlparser2` 等）随 `pnpm install` 落盘，
> 许可以其自身 `package.json` 为准；重跑 `node scripts/gen-license-manifest.mjs` 会把直接依赖刷新到
> `web/src/generated/licenses.json` 并同步到页脚。
>
> 页脚「官网 / 仓库」列的链接同样**只取包自己声明的 `homepage` / `repository`**（`git+…`、`git://…`、
> `.git` 后缀与 `owner/repo` 简写会被归一化），包内未声明就显示"未声明"，不手写、不猜测地址；
> 参照项的名字本身就是 GitHub 的 `owner/repo` 时，出处由该名字直接得出。链接一律 `target="_blank"`
> 且带 `rel="noopener noreferrer nofollow"`。

---

## 二、参照过的外部仓库（许可与使用边界）

### 2.1 已引入代码 → 仅 MiniSearch

| 仓库 | 许可 | 使用方式 |
| --- | --- | --- |
| `lucaong/minisearch` | MIT | **作为 npm 依赖引入**，用于后端常驻检索索引。注入自研中文"单字 + 相邻二字组"分词函数，字段加权为 话题 6 / 标题 4 / 辟谣 1.4 / 谣言 1。 |

### 2.2 仅算法或细节对照，未采用任何代码

| 仓库 | 许可 | 参照内容 | 未采用的原因 |
| --- | --- | --- | --- |
| `fuxingloh/vue-masonry-wall` | MIT | 瀑布流"最短列优先"分列与列宽计算思路 | 其 `peerDependencies` 为 `vue ^2.6.10`（Vue 2 only），且按列分组渲染会破坏本站"置顶唯一 + 用户自定义顺序"的排序语义；改为自研 `useWaterfall`：DOM 顺序恒等于输入顺序，仅坐标由最短列决定 |
| `ApoorvSaxena/lozad.js` | MIT | 懒加载四个细节：命中即 `unobserve`、`data-loaded` 幂等标记、占位预载、卸载时清理 | 其 observer 每实例新建且无 `disconnect` API，不便与 Vue 生命周期集成；改为共享单例 observer 的 `v-reveal` 指令 |
| `paulcollett/vue-masonry-css` | MIT | 纯 CSS 列布局的取舍对照 | CSS `column-count` 会纵向重排条目，与排序需求冲突，仅作对照阅读 |
| `AFP-Medialab/verification-plugin` | MIT | 核查类站点的"声明—证据—结论"信息层级与措辞（结论分级、来源平台、抓取存证时刻、多机构判定） | 其形态是记者工作台插件，与本站档案库定位不同；仅把分级与出处字段落到 `verdict.rating` 与 `rumor.source` |
| `typemill/typemill` | MIT | 防暴力破解（按用户名维度计数并持久化）、统一失败文案 + 固定延迟防枚举/计时、数据目录 `.htaccess` 保护、上传二次嗅探与重命名 | PHP 栈与本站不同，不取代码；据此补齐了本站缺失的按用户名锁定 + 持久化、审计日志与显式 CSP |

### 2.4 选型回头补账：按"先找现成开源"新增的引入与核实后排除

原则（用户指定）：**选型时先找开源、符合需求、可二次开发的仓库，再考虑自主开发**；许可一律落到
**包自带的 LICENSE / `package.json` 实测**（不看 README 的口头声明，不看搜索摘要）。
下表许可列写的是本次实测取到的值，registry / GitHub API 的原始响应留档在项目内 `.scratch-oss-select-a7x2/`
（`n-*.latest.json`、`gh-*.json`、`m-*.json`），可逐条回指。

**因此新增的引入**（同时替换掉了原先的自研实现，逐条理由见 `DEVELOPMENT.md` §三 3.4）：

| 包 | 版本 | 许可（实测） | 替掉的自研 | 换的过程中发现的真实缺陷 |
| --- | --- | --- | --- | --- |
| `diff` | 9.0.0 | BSD-3-Clause | 整段对比 | —— |
| `@rgrove/parse-xml` | 5.0.0 | ISC | 正则"解析" EPUB 的 XML | 目录次序与父级标题静默丢失、坏 XML 静默变空页（改为严格解析后可诊断，返回 422 并指明是哪一个文件） |
| `csv-parse` / `csv-stringify` | 7.0.3 / 6.9.0 | MIT | 自写 `parseCsvLine` + 转义 | **口令里含 `\n` 会在 `users.csv` 里造出一条谁都没登记的"幽灵身份行"**（写侧还需 `quoted_match: /[",\r\n]/`，因为 CRLF 分隔下裸 `\n` 不会被自动加引号） |
| `pdfjs-dist` | 6.3.289 | Apache-2.0 | ——（PDF 无从自研） | v6 移除了 `PDFDocumentProxy.destroy()`，须改用 `loadingTask.destroy()`（否则每个 PDF 请求 422） |

**核实后明确不引入**（保留自研，附理由）：

| 候选 | 许可（实测） | 不引入的理由 |
| --- | --- | --- |
| `pino` + `pino-roll` | MIT / MIT | 本站日志是封顶 512KB、轮 5 份的 JSONL，聚合口径固定；引日志栈要改写全部审计写点而收益为负。`audit()` 的事件名与字段是稳定契约，将来外接采集器不动业务代码 |
| `grafana/loki`、`grafana/grafana`、`grafana/tempo` | **AGPL-3.0**（GitHub API 实测） | 强 copyleft 服务端许可，触发面超出本站承受范围 |
| `vectordotdev/vector` | **MPL-2.0**（GitHub API 实测） | 文件级 copyleft，属需单独批准的一类；且它是独立进程，不解决"页内看台账" |
| `Graylog2/graylog2-server` | **NOASSERTION**（GitHub API 实测，即自定义许可） | 按本台账判定原则第 3 条：许可未明确即不允许取码 |
| `fast-xml-parser` | MIT（另有 6 个传递依赖，逐个查过均 MIT） | 许可合规但语义不符：对象映射丢**节点次序**（NCX 文档序即目录序），也无法回答"是哪一份 XML 坏了" |
| `yauzl` / `fflate` / `adm-zip` / `jszip` | MIT / MIT / MIT / `(MIT OR GPL-3.0-or-later)` | 本站要的是"只取一个条目 + 自己握三道闸（条目名越界、解压长度上限、下发前按魔数复核）"；现成库要么是全量解压 API，要么仍需在其上再写这层校验 |
| `steno` / `lowdb` | MIT / MIT | 原子写与现有实现等价；"带外改文件也要失效缓存"这件事现成库给不了（靠数据代次实现） |
| `express-brute` | 包声明为 `BSD`（未细化条款） | 需求要求锁定计数**落盘、重启不清零**，其默认存储模型不符；许可声明笼统也增加核实成本 |
| `file-type` | MIT | ESM-only、内含数十种格式表；且嗅探结果不能替代白名单（判为 SVG 的仍不能下发，可携带脚本） |
| `jsondiffpatch` | MIT | 输出面向"程序回放"的结构 delta；版本比对要的是人可读的逐词 `<ins>/<del>` |
| `isbot` | `Unlicense`（公有领域） | 语义与需求相反：它把空 UA/已知爬虫特征判为 bot 供调用方**放行或降级**，本站要"无会话即拒"，且不能被无头浏览器误伤 |
| `pngjs` / `pdfkit` | MIT / MIT | 候选均合规但未引入：演示件只需"一小片形状固定的字节"，`pdfkit` 会把一个 PDF **生成器**带进生产依赖面，而本站对 PDF 只读不写 |

**镜像站的内容来源边界**（与许可无关，但一并记在这里免得日后误读）：
镜像只伺服馆员自行放入 `server/data/library/` 的文件；本项目**不代抓网盘、不下载小说/EPUB/翻译稿/漫画扫描等
受版权保护作品、不绕过百度网盘与任何登录门槛**；三本演示册（占位 EPUB、五章 EPUB、带书签 PDF）全部由
`server/scripts/` 下的自写生成器现场产出。在线阅览另受**逐本勾选的预览白名单**约束：登记在册不等于可公开渲染正文。

### 2.5 此前一轮的明确排除（许可不允许取码，或许可未声明）

| 仓库 | 声明许可 | 处置 |
| --- | --- | --- |
| `Wikiteam/wiki.js`、`caracal`、`docmost` | AGPL-3.0 | **只读公开文档**了解 wiki 站点功能面，未阅读其源码以借鉴实现，未复制任何代码 |
| `danpros/htmly` | GPL-2.0 | 同上，databaseless 博客的通用做法不作为代码来源 |
| `hypothesis/client` | `NOASSERTION`（未明确） | 标注锚定思路属通用知识，未取码 |
| `szabyg/annotate.js` | 无许可声明 | 未取码，未参照其内部实现 |
| `yabwe/medium-editor`、`jakiestfu/Medium.js` | `NOASSERTION` / 无声明 | 未取码；contenteditable 相关做法按 W3C 规范自行实现 |
| `thunlp/Chinese_Rumor_Dataset` 等谣言数据集 | 无许可声明 | **未使用其任何数据**；演示档案全部为本次自写的说明性样例文本 |
| 中文维基百科（界面） | 文本 CC BY-SA 4.0；Wikipedia 标识为 Wikimedia 注册商标 | 仅参照"页眉 + 侧栏 + 正文 + 页脚 + logo 位置"的四段式信息架构；**未复制**其文本、图片、样式、脚本或商标 |
| `terra-faction-ui` 技能包 | 包内自带 ISC 声明（图标为 Lucide，ISC） | 作为**设计语法来源**使用其阵营契约文档与色板种子；未复制其示例产物页面，未打包其图标（本站图标均为手写内联 SVG） |

---

## 三、字体与图标

- **字体**：使用本机字体栈（`Songti SC / STSong / Noto Serif SC / SimSun` 与 `PingFang SC / Microsoft YaHei / Noto Sans SC`），
  **不加载任何第三方字体文件**，因此不产生字体许可义务。若日后改为随包分发 Noto 系列，须随附其 SIL Open Font License 1.1 文本。
- **图标**：全部为本次手写的内联 SVG（放大镜、界尺把手、折角、版框标识等），未引入图标库，未使用任何官方阵营徽记。
- **图片**：演示图片由 `server/scripts/png.js` 的最小 PNG 编码器现场生成，无外部素材来源。
- **演示 PDF**：由 `server/scripts/pdf.js` 的裸对象写入器现场生成（含三枚书签与一块不可压缩填充），
  用于验"按节翻页 + 文字层 + 体积阈值"，同样无外部素材来源。
- **演示 EPUB**：由 `server/scripts/epub.js` 生成（含 store 与 deflate 两种条目、跨章锚点、必须被净化掉的样本标记），
  三本演示册全部自产，本站不抓取、不收录任何受版权保护的作品。

## 四、归属与免责表述

界面语法属于**证据驱动的 Terra 阵营界面（受《明日方舟》世界观启发）**，与上海鹰角网络科技有限公司或任何官方产品**无关**；
本项目未使用、未复制、未分发任何官方标识、阵营徽记、角色美术、关键视觉、游戏截图、生产包或 CDN 资源。
该表述同时出现在站点页脚。

演示档案中的辟谣文本为本次自写的说明性样例，用于展示对勘与批注流程，**不构成事实核查结论**；
其材料源条目已逐条标注"演示材料"。
