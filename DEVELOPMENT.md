# 辨妄阁 · 开发文档

> 本文是**开发经过的纪实**：需求如何被逐条落地、用了哪些技术与框架、踩过的坑（含根因与修法）、
> 以及仍然存在的风险。它不替代 `README.md`（使用与功能说明）、`DEPLOY.md`（部署）、
> `THIRD_PARTY_NOTICES.md`（许可台账），四者分工：README 讲"是什么"，DEPLOY 讲"怎么上线"，
> NOTICES 讲"用了谁的什么"，本文讲"为什么这样写、哪里会疼"。

## 〇、项目快照

| 项 | 值 |
| --- | --- |
| 形态 | Nginx 托管的类 wiki 辟谣档案站（辨妄阁），四段式外壳：header / sidebar / main / footer |
| 规模 | 前端 29 个 `.vue` + 18 个 js/css；后端 22 个模块、41 个路由处理器；6 个自检脚本 |
| 栈 | pnpm 11.1.3 workspace + Vue 3.5.43 + Vite 8.3.1（Rolldown）+ Pinia 4.0.3 + Vue Router 5.3.1；Express 5.2.1 + JSON 文件存储 |
| 富文本 | CKEditor 5 免费版 `ckeditor5@48.5.2`（GPL-2.0-or-later）+ 本站自定义插件四枚按钮 |
| 存储 | 优先 JSON：`server/data/*.json` + `users.csv` + `media/` + `library/`；实测无需数据库 |
| 视觉 | terra-faction-ui 的 **Yan（炎国 archival）阵营语法 · 最高规格（maximal）**，根属性 `data-terra-faction="yan-archival"` |
| 安全 | 严格 CSP（无 `unsafe-inline`）、CSRF 双提交、登录与验印双维度锁定、HMAC 短时效直链、反爬 UA 门槛、5MB 单图上限 |
| 本轮验证 | 接口 31/31 · 全量 149/149 · 浏览器走查 119/119（控制台零输出、CSP 零违规）· Yan 契约审计 49 文件无告警 · 色域审计 PASS |
| 交付纪律 | 只采纳宽松许可（MIT/Apache/BSD/ISC/CC0）代码；**唯一 copyleft 例外是 CKEditor 5，按用户明确指定引入并单独核实**；不打包任何官方标识、美术、CDN 素材 |

---

## 一、需求总览与落地对照

原始需求按主题拆成 12 组，逐组给出落点与验证锚点。**状态**一列诚实区分"已实现并验证"与"刻意不做"。

| # | 需求 | 落地 | 状态 |
| --- | --- | --- | --- |
| R1 | 类 wiki 的辟谣站，参照 Wikipedia 截图**仅参考排版**、不参考内容 | `styles/layout.css` 四段式骨架 + `AppHeader/AppSidebar/AppFooter`；正文与术语全部自产 | ✅ 已验证（页脚声明"未复制其文本、图片、样式或商标"） |
| R2 | 前端风格取 terra-faction-ui 的 **Yan 风格最高规格** | `styles/tokens.css`（阵营令牌）+ `base/controls/motion/layout`（深度语法）；12 家族色域互斥实测最近对 ΔE 14.9 | ✅ 契约审计 PASS |
| R3 | 防攻击 / 防嗅探 / 防爬取 / 懒加载，全部用开源免费方式；单图 5MB | `security/`（middleware、attempts、audit、media、sanitize）+ `reveal.js` + `useWaterfall.js`；无付费组件 | ✅ 全量体检覆盖失败分支 |
| R4 | 存储优先 JSON，只有"无法动态无刷新呈现"才换数据库 | 实测：JSON + 原子写 + mtime 失效即可支撑无刷新（置顶、重排、菜单、口令吊销都即时生效） | ✅ 不换库，边界写进风险（§七 R-8） |
| R5 | 后台以 **CSV 明文**记录可登录用户与口令，默认 `admin/admin` | `store/users.js`（CSV）+ `BW_HASH_PASSWORDS=1` 可切 scrypt | ⚠️ 按需求实现，风险见 §七 R-1 |
| R6 | 游客只读，登录可写 | 路由守卫 + `requireAuth` + `requireCsrf` + 写限流；登出后写路径全断 | ✅ 走查覆盖"未登录访问编辑器被引到登录页" |
| R7 | 编辑器：标题 / 谣言（富文本 + tag 纯文本）/ 辟谣内容 / 材料源（可增删输入框 + 上传） | `EditorView.vue` 四叶折叠文书 + `RichEditor.vue`（CKEditor 基底）+ 材料源行编辑 | ✅ |
| R8 | 圈画与下划线，富文本与图片皆可，默认红色、可换色 | 富文本：`editor/yan-markup.js` 自定义插件（`yanAnno` 属性 + 四色预置 class）；图片：`AnnotationCanvas` 归一化矢量叠加 | ✅ 走查逐色、逐按钮 |
| R9 | 首页卡片瀑布流 + 懒加载；标签/标题快速模糊检索 | `WaterfallGrid`（保序轮询分列）+ 哨兵提前 480px；`/api/search` MiniSearch BM25+ 与中文 bigram | ✅ 未采用 vue-masonry-wall / lozad（理由见 §三） |
| R10 | 唯一置顶且自动释放、拖拽重排、logo 参照、菜单编辑器、页脚记录全部框架与协议 | `posts.setPinned`（转移即释放原置顶）+ sortablejs + `MenuEditorView` + 页脚登记表 | ✅ |
| R11 | 侧栏：图文重排序（登录可见）+ 菜单编辑（登录可见）+ **辟谣话题 tag 列表（所有人可见）** | `AppSidebar.vue` 三段 + 资源库块 + 镜像块 | ✅ |
| R12 | 针对**无职转生**专题：中文区访谈/翻译合集等查证载体 + 洛琪希图书馆-借书柜台 → **辟谣常用资源库**；并建 **EPUB 本地镜像站**，口令由登录用户管理，同样在侧栏呈现 | `resources.json` + `/resources` + 侧栏块（12 条实测种子）；`library.json` + `library-keys.json` + `/library` 页 | ✅ |
| R13 | （追加）镜像的 EPUB **在线阅览**，且 **10MB 以上按章节拆成多个可阅览网页** | `server/src/library/`（zipRead + epubRead）+ `/library/:id/read` | ✅ 阈值是硬边界：超限整本渲染返回 409 |
| R14 | （追加）调研 CKEditor 5，用**免费版**作富文本基底，需要加按钮就以**自定义插件**形式加 | `ckeditor5@48.5.2` + `licenseKey: 'GPL'` + `YanMarkup` 四枚按钮 | ✅ premium 件一个没用 |
| R15 | 调研 GitHub 可参照案例，**遵守仓库声明的协议** | 见 `THIRD_PARTY_NOTICES.md`：宽松许可者可对照/引入；`NONE/NOASSERTION` 只读思路；AGPL/GPL 不取码（除 R14 指定例外） | ✅ |
| R16 | （追加）**每个功能都配一份实体示例**（完整图文、默认用户、链接、可在线预览的 EPUB），且**示例均可删除或再编辑** | `server/scripts/reseed.js`（演示链接改指保留域、补 `demo` 用户与站内链接条目）+ `/about`「出厂示例」表（`AboutView.vue`） | ✅ 体检与走查逐项复核在位、可删、可恢复 |

**刻意不做的三件事**（避免把"备份镜像站"做成侵权分发站）：
1. 不代抓网盘、不下载小说/EPUB/翻译稿/漫画扫描，不绕过百度盘与登录门槛；镜像只伺服馆员自行放入 `server/data/library/` 的文件。
2. 不在页面里嵌入任何官方标识、角色美术、关键视觉或 CDN 资源。
3. 不为 `sanitize-html` 之外的付费能力（`GeneralHtmlSupport`）放宽白名单——批注形制改用预置 class 表达。

---

## 二、架构与数据流

```
浏览器 ──HTTPS──> Nginx（TLS/HSTS/限流/静态/数据目录 deny）
                    ├── /            → web/dist（SPA history 回退）
                    ├── /assets/     → 带哈希产物，1y immutable
                    ├── /api/library/files/     → 流式取书（关缓冲、长超时）
                    ├── /api/library/*/reader|asset → 逐章取页与插图（复用 bw_media 频控）
                    ├── /api/media/  → HMAC 签名短时效直链
                    └── /api/        → Node（Express 5，仅监听 127.0.0.1）
                                          ├── store/jsonStore.js  原子写 + mtime 失效 + 常驻索引
                                          ├── security/*          头、CSRF、会话、限次、审计、净化、签名
                                          ├── library/*           ZIP 中央目录 + EPUB spine 分页
                                          └── search/vectorIndex  MiniSearch + 中文 bigram
```

**一次写入的路径**（以建档为例）：`EditorView` → `POST /api/posts`（`botGuard → apiLimiter → attachSession → requireCsrf → writeLimiter`）
→ `sanitizeRichText` 白名单净化 → `posts.create` 原子落 JSON → 索引增量更新 → 返回摘要 → Pinia 就地合并（无需刷新）。

**一次读图的路径**：档案里只存**无签名**的 `/api/media/<id>`；读取详情时服务端按媒体号现签 `?exp&sig`；
前端把 DOM 原样 PUT 回来时，净化器**再剥一次查询串**——这一条是早期真实缺陷（签名被永久写回库 → 30 分钟后全站插图 403）。

**目录要点**

```
web/src/
  styles/     tokens / base / controls / motion / layout —— 阵营语法与深度语法分层
  editor/     yan-markup.js（CKEditor 自定义插件：命令、转换、widget、按钮）
  components/ layout/ cards/ editor/ paper/（RichHtml、EpubHtml、ConfirmDialog…）
  stores/     ui / auth / catalog / menu / resources / library（Pinia setup store）
  views/      13 个路由视图（含 LibraryView、ReaderView）
server/src/
  store/      jsonStore / posts / menu / users / sessions / resources / library
  security/   middleware / attempts / audit / media / sanitize
  library/    zipRead（ZIP 定点随机读） / epubRead（spine 解析 + 分页 + 净化）
  routes/     auth / content / media / resources / library
```

---

## 三、技术选型与框架清单（含许可与"为什么是它"）

### 3.1 作为依赖引入

| 组件 | 版本 | 协议 | 为什么选它 / 为什么不是别的 |
| --- | --- | --- | --- |
| vue | 3.5.43 | MIT | 需求指定栈；`<script setup>` + Pinia setup store 一致 |
| vue-router | 5.3.1 | MIT | 需求指定；注意 v5 守卫返回值语义（见 §六 B-9） |
| pinia | 4.0.3 | MIT | 需求指定；比 Vuex 轻，store 即组合式函数 |
| vite | 8.3.1 | MIT | 需求指定；Rolldown 分包下 CKEditor 只进懒加载 chunk（§四 4.3） |
| @vitejs/plugin-vue | 6.0.9 | MIT | SFC 编译 |
| ckeditor5 | 48.5.2 | **GPL-2.0-or-later**（双许可，取免费档） | 用户明确指定为富文本基底；四枚本站按钮以官方插件机制补齐 |
| dompurify | 3.4.16 | MPL-2.0 **或** Apache-2.0 | 前端二次净化，与服务端白名单形成双保险 |
| sortablejs | 1.15.7 | MIT | 重排与菜单拖动；比自写指针事件稳 |
| express | 5.2.1 | MIT | 与 Node 同构，无额外运行时 |
| express-rate-limit | 8.7.0 | MIT | v8 的 `keyGenerator` 与 IPv6 归一（§六 E-7） |
| multer | 2.4.0 | MIT | 内存模式 + 体积上限，先过魔数再落盘 |
| sanitize-html | 2.17.7 | MIT | 服务端白名单净化；`transformTags` 负责改写 href/src |
| cookie-parser | 1.4.7 | MIT | 会话 Cookie 解析 |
| minisearch | 7.2.0 | MIT | 常驻内存 BM25+，可注入自定义分词（中文 bigram），免部署额外搜索引擎 |

### 3.2 运行时与部署件

Node.js 24.14.1（MIT）· Nginx 1.24+（BSD-2-Clause）· pnpm 11.1.3（MIT）。

### 3.3 只对照、不取码（或仅取思路）

| 参照 | 许可 | 结论 |
| --- | --- | --- |
| `fuxingloh/vue-masonry-wall` | MIT | Vue 2-only，且"最短列"调度会破坏置顶与自定义顺序 → 自实现**保序轮询分列** |
| `ApoorvSaxena/lozad.js` | MIT | 只借鉴"命中即 unobserve、loaded 幂等、占位预载、卸载 disconnect" |
| `lucaong/minisearch` | MIT | 已作为依赖引入，分词器自写 |
| `AFP-Medialab/verification-plugin` | MIT | 只借"声明—证据—结论"字段层级与措辞 |
| `typemill/typemill` | MIT | 只借 flat-file CMS 的防暴力/CSRF/数据目录保护思路 |
| 中文维基百科首页版式 | 文本 CC BY-SA 4.0，标识为 Wikimedia 注册商标 | **只**借四段式信息架构与 logo 位置 |
| `terra-faction-ui`（技能包） | ISC | 提供 Yan 阵营证据化界面语法；无公开 URL，故页脚该行为"未声明" |
| EPUB 3 / ZIP 结构 | 规范文档 | 解析层**全自写**，未引入 `epub.js`/`adm-zip`，零新增许可面 |

### 3.4 页脚出处链接的取法

`scripts/gen-license-manifest.mjs` 从**已安装包的 `package.json` 实测**读取版本、许可与出处：
`homepage → repository.url → repository（"owner/repo" 简写）→ bugs.url`，并归一化 `git+`、`git://`、`.git`、`#readme`。
包内没声明就渲染"未声明"，**不手写、不猜测地址**；参照项的名字本身就是 GitHub `owner/repo` 时，出处由名字直接得出。
链接一律 `target="_blank" rel="noopener noreferrer nofollow"`。

---

## 四、关键子系统设计

### 4.1 安全链路

| 环节 | 做法 | 失败分支的实测行为 |
| --- | --- | --- |
| 会话 | `bw_sid` HttpOnly + SameSite=Strict（生产加 Secure），服务端存 `sessions.json`，12 小时 TTL | 用户被删 → 该会话立即失效（`/api/auth/me` 返回 `user: null`） |
| CSRF | 双提交：登录时下发令牌，写操作必须带 `x-bw-csrf` | 缺令牌 → 403 |
| 限次 | 登录按 IP **与** 用户名双维度，5 次锁 10 分钟，计数落盘（重启不清零）；镜像验印 6 次/15 分钟、冷却 3 分钟 | 锁定期内即使口令正确也拒（统一 `bad-credentials` 口径，不泄露"口令对但被锁"） |
| 限流 | 全站 `/api` 600 次/分（一次整页加载约 5 个请求，故放宽到不伤自访）；写操作另计 40 次/分 | 429 + 中文提示 |
| 反爬 | 脚本型 UA（curl/wget/scrapy/python-requests/…）与空 UA 在无会话时直接拒；游客深翻页 >20 页需登录 | 403；`BW_ALLOW_TOOL_UA=1` 仅本机调试放行 |
| 图片 | HMAC 签名直链，默认 30 分钟；`exp`+`sig` 定长比较 | 伪造 403、过期 403、文件缺失 404 |
| 上传 | 内存模式 → 魔数识别（不信扩展名与 Content-Type）→ 5MB 上限 → 落盘改名 | 413 / 415 |
| 净化 | 服务端 `sanitize-html` 白名单 + 前端 DOMPurify 二道；批注颜色只允许预置 class | 危险标签与事件属性被剥；`data-cke-*` 之类编辑器私有不进库 |
| 审计 | `data/security.log`（JSONL，超 512KB 轮转），记录登录、吊销、越权、下载、阅览 | 全链路可回溯 |
| 头 | 严格 CSP（`default/script/style/img/connect/form-action 'self'`，无 `unsafe-inline`）、HSTS、nosniff、`x-powered-by` 关闭 | 生产实例逐头实测 |

### 4.2 检索

MiniSearch 常驻内存 + 自写中文 bigram 分词（单字与双字并存），字段加权：标题 > 话题 tag > 谣言正文 > 辟谣正文；
支持前缀与模糊，故"快速模糊搜索"无需用户打全词。索引随 `posts.json` mtime 增量重建，重启即重建（无持久化索引文件）。

### 4.3 富文本与批注（CKEditor 5 + 自定义插件）

- **基底**：`ClassicEditor` + Essentials/Autoformat/Paragraph/BlockQuote/Bold/Italic/Underline/Strikethrough/List/Link，
  `licenseKey: 'GPL'`；premium 件（SourceEditing、GeneralHtmlSupport、导出 Word/PDF）一律不用。
- **自定义插件 `YanMarkup`**（`web/src/editor/yan-markup.js`）四枚按钮，图标为自写 20×20 SVG：
  - `yanAnnotationCircle` / `yanAnnotationLine`：给选区加/去 `yanAnno` 模型属性，值形如 `kind:color`；
    downcast 成 `span.anno.anno-<kind>.c-<color>`，upcast 反向解析，**一个属性只承载一种形制**（后加的会替换先加的）。
  - `yanAnnotationClear`：折叠选区时也能"停在字上点解除"（清掉整段同色批注）。
  - `yanImagePicker`：按钮只喊话（`fire(PICK_IMAGE_EVENT)`），真正的上传由 Vue 侧走站内既有 `/api/media` 通道，
    成功后 `insertImage({src, alt, mid})` → `model.insertObject`。
- **图片是 widget**：`yanImage` 对象型块元素，编辑视图 `toWidget` 包 `figure.rich-fig`，数据视图输出
  `figure > img.rich-img[data-mid] + figcaption.rich-cap`，与后端白名单完全对齐。
- **为什么不用行内样式**：严格 CSP 下 `style=""` 不生效，且会把不可控声明写进库；颜色一律预置四色 class。
- **中文界面**：伞包自带 `dist/translations/zh-cn.js` 是**纯数据默认导出**，Vite 下没有构建插件替它挂载，
  因此创建实例前手动并入 `window.CKEDITOR_TRANSLATIONS` 并设 `language.ui = 'zh-cn'`（详见 §六 C-8）。
- **分包事实**：CKEditor 的 JS/CSS 只进 `EditorView` 懒加载 chunk（782.55 kB / gzip 211.62 kB；CSS 232.05 kB / gzip 36.39 kB），
  游客与只读用户永不下载；阅览页 `ReaderView` 独立 chunk 8.07 kB / gzip 3.91 kB。

### 4.4 洛琪希图书馆镜像与 EPUB 在线阅览

**门控链**（下载与阅览完全一致）：`grants.verify(k,exp,sig)` → 书在架 → `libraryKeys.covers(key, bookId)` →
类型是 EPUB → 磁盘文件在位。口令表 `library-keys.json` 明文存（与名册同一取舍），可指定范围（`all` / `files`）、
可到期、可停用、可吊销；**吊销后已发令牌立即失效**（令牌只签 `keyId.exp`，校验时回查活性）。

**分页模型**：`container.xml → OPF manifest/spine →（EPUB3 nav | EPUB2 ncx）` 得到"章节 = spine 条目 + 目录标题"；
一章一个可阅览网页（`/library/:id/read?c=章&p=小节`）；单章正文超过 128KB 时**再按一\~三级标题切小节**，
切块用 `split(/(?=<h[1-3]\b)/i)` 保证每页都是完整标签。**10MB 是硬边界**：超过阈值的书 `splitRequired=true`，
整本渲染接口直接 409 并说明原因；阈值以下另给"全本通读"（单次输出再限 1MB）。

**内存纪律**：ZIP 只读中央目录（含 Zip64 表头），正文按 local header 偏移**定点读+解压**，整本书从不进内存；
解析结果按 `路径+mtime+size` 有界缓存 8 本，**正文不缓存**。

**资产改写**：`<img src>` 改写为 `/api/library/:id/asset?p=<包内路径>&k&exp&sig`（浏览器直接取，带不了头）；
`p` 只能命中包内既有条目（`../`、绝对路径、带协议一律拒），下发前再按魔数复核，
只放行位图（PNG/JPEG/GIF/WebP/AVIF）——**SVG 即使包内声明也不下发**，因为它可携带脚本。
跨章链接改写为站内路由 `/library/:id/read?c=N#锚点`，前端拦截点击走单页路由（不整页闪白）；外链保留但强制
`rel="noopener noreferrer nofollow"`。

**令牌活过刷新**：阅览要翻页与刷新，令牌存 `sessionStorage`（随标签页关闭即清）；接口回 403 时前端立即收回解锁态、
回到口令门，避免"看起来已解锁却反复失败"。

### 4.5 资源库（无职转生专题）

`resources.json` 五组分类（官方一手出处 / 中文区查证载体 / 访谈与翻译合集 / 事实核对工具 / 常见误传题材），
每条记名称、入口、**能核实什么**、可信度与可见性；游客可读、登录可增删改；危险协议（`javascript:`）在写入层就拒。
13 条种子里 12 条外链逐条核过可访问性，其中"借书柜台"是网盘入口（其主站当前返回 404/522 已如实记在 note 里），
镜像站因此只备份**馆员自行放入**的文件，不代抓内容。

### 4.6 出厂示例（每项功能都带一份可删可改的实体）

需求 R16 的落点是 `server/scripts/reseed.js`，四条约束：

1. **演示出处不冒充真实文献**。档案的"原始载体链接"与首条材料源链接一律取 RFC 2606 保留域
   （`https://example.org/rumor/n01`、`/evidence/n01-1`），字段名、写入校验、渲染链路全是真的，
   只有域名不指向任何作品或机构；`/about` 表尾明写"不可作为辟谣依据"。
2. **链接形态覆盖两种**：资源库既有 12 条外链，也有一条站内路径示例（`/library`）——
   `store/resources.js` 的 `cleanUrl()` 与前端 `safeHref()` 都放行站内路径，页脚与侧栏据此渲染。
3. **可登录用户有两个而不是一个**。`admin` 是需求指定的出厂账号（不可删）；
   另补 `demo`（角色 editor，显示名「示例馆员（可删除）」），使名册的"改密/移除/新增"三条链路在出厂状态就有对象。
   种子**只在缺失时补这一行**，绝不覆盖任何已存在口令，所以管理员改过 admin 密码后重跑 seed 安全。
4. **阅览链路自带可翻的书**。除下载演示册外，`multiChapterEpub({ chapters: 5 })` 生成一本五章自产正文册，
   含 `<script>`／`style=""`／`<svg onload>`／外链／跨章锚点等"必须被净化掉"的东西，
   既是示例也是活体测试样本；两本都 <10MB，因此默认走逐章而不触发强制拆分。

清单在公开页 `/about` 的「出厂示例」表里（6 行 × 功能/示例/在哪编辑或删除）。
**该表刻意不写任何口令值**——口令属 `users.csv` 与镜像口令表，公开页只说"在哪改"。
恢复出厂演示内容用 `pnpm seed`；它的逐文件行为差异见 README「一、快速开始」的注记。

---

## 五、决策记录（ADR 摘要）

| # | 决策 | 备选项 | 取舍依据 |
| --- | --- | --- | --- |
| D-1 | 存储用 JSON 文件，不引数据库 | SQLite/Postgres | 需求要求"优先 JSON"；实测置顶/重排/菜单/口令吊销都能无刷新生效（原子写 + mtime 失效 + 常驻索引）。上千档案再评估 |
| D-2 | 瀑布流自实现保序轮询分列 | vue-masonry-wall | 该库 Vue 2-only，且"最短列"会打乱置顶与自定义顺序——顺序在本站是**语义**（置顶、重排） |
| D-3 | 懒加载自实现 composable | lozad.js | 只借其细节做法；自研可复用同一 IntersectionObserver 并与 Vue 生命周期对齐 |
| D-4 | 富文本基底取 CKEditor 5 免费版（GPL） | TipTap(MIT)/Quill(Apache) 等宽松许可件 | 用户明确指定 CKEditor 5；相应地 copyleft 义务被单独核实、登记并在页脚声明 |
| D-5 | 批注形制用预置 class 而非行内样式 | 放宽 CSP 或引 GeneralHtmlSupport（付费） | 保持严格 CSP；不为样式引入付费件 |
| D-6 | EPUB/ZIP 解析全自写 | epub.js、adm-zip | 只需"读目录 + 取单条目 + 解析 OPF/spine"，自写约 300 行且零新增许可面、可精确控制安全边界 |
| D-7 | 阅览与下载共用同一枚口令令牌 | 为阅览另发一套凭证 | 少一套密钥与生命周期；代价是令牌出现在 URL 与访问日志中（记为风险 R-4） |
| D-8 | 页脚出处只取包内声明 | 手写官网地址 | 手写会失真与猜测；实测生成，缺声明就显示"未声明" |
| D-9 | 明文口令 CSV 保留为默认，另给哈希开关 | 直接强制哈希 | 需求明确指定明文；用 `BW_HASH_PASSWORDS=1` + 文档 + 页脚提示把风险显式化而不是偷偷改掉行为 |

---

## 六、踩坑实录

按"现象 → 根因 → 修法"记，只记真实撞过的。编号可引用。

### A · 构建与工具链

- **A-1 构建"exit 0"不可信**。把构建 stdout 直接管道给 `tail`，shell 报的是 `tail` 的退出码，真实失败被吞。
  改法：`<cmd> > build.log 2>&1; echo "exit=$?"` 同行回显，再 `grep -c ERROR` 并**确认产物存在且体积合理**。
- **A-2 超长文件单次 Write 会被静默截断**。大改文档/大组件时分段写、用锚点续写，写完回读尾部确认闭合。
- **A-3 `sed` 替换含 `|` 的 Markdown 表格行失败**（`|` 既是内容又是 `s|||` 的分隔符）。这类改用编辑工具做字符串替换。
- **A-4 重复工具调用把同一行 import 写了两遍**（`import zhCn ...` 出现两次 → 构建期才炸）。同一处改动不重复下发；
  改完看 diff 而不是"再发一次保险"。
- **A-5 脚本名要先核实存在**。`pnpm audit:ui` 定义在根 `package.json`，不在 `web/`；猜命令会静默失败。

### B · Vue 与前端

- **B-1 `<input type="date">` 只认 `yyyy-MM-dd`**。档案里存过完整 ISO 时间戳时，编辑页字段**静默显示为空**并伴控制台告警。
  修法：载入与种子都裁 `slice(0, 10)`（`toDateValue()`），别让脏数据流到控件。
- **B-2 两个编辑器共用同一 `name` 的 radio 组** → 谣言面与辟谣面的笔色互相串。按实例生成 `anno-color-<label>`。
- **B-3 宽表在 390px 顶破整页**（实测溢出 18–66px）。`.table-scroll` 原先只在两个视图里各写一份，
  提升为 `styles/base.css` 全局工具类后，页脚/名册/镜像/资源库共用。
- **B-4 隐私浏览下 `setItem` 会抛**。读侧有兜底还不够，**写侧同样不能裸奔**；阅览令牌存 `sessionStorage` 时同规则。
- **B-5 删档后媒体文件永久残留**。没有 GC 入口就是一直涨；现在删档即回收索引与文件（走查断"文件残留 false / 索引残留 false"）。
- **B-6 服务端默认菜单 id 与前端注册表不一致** → 首次部署"检索"入口直接消失。菜单是注册表驱动的，
  id 必须同源；服务端 seed 与 `modules/registry.js` 一起改。
- **B-6b 只在"文件为空"时播种默认菜单 → 后加的功能对老装机永远不可见**。
  本地 `menu.json` 是资源库/镜像站加进注册表**之前**生成的（8 项），`menu.get()` 见文件非空就原样返回，
  于是这两项既不出现在页眉，也不出现在菜单编辑器（保存时又按"提交什么存什么"写回 8 项）——**只有全新装机正常**，
  自检因此全绿。修法：`get()` 遇到"注册表里有、文件里没有"的模块时**追加到末尾**并落盘（不重排已有项，
  运维的手工排序不受影响）；`full-sweep` 加一条"删掉一项再 GET，应自动补回且次序不变"。
  教训同 B-6：**加功能要同时想"老数据文件缺这一字段时谁来补"**，只在首次生效的播种逻辑不够。
- **B-7 置顶唯一性**：转移时不释放原置顶就会出现两个置顶；前端还要**就地合并**返回的 `list`，否则要刷新才对齐。
- **B-8 签名直链被写回库**（真实缺陷）：编辑器把带 `?exp&sig` 的 DOM 原样 PUT 回来，30 分钟后全站插图集体 403。
  修法：净化器把 `/api/media/<id>` 之后的查询串剥掉，读取时再现签。
- **B-9 Vue Router 5 守卫语义**：守卫的返回值会被当作**重定向目标**，返回普通对象会立刻触发新一轮导航形成死循环。
  守卫里只做副作用（设 `document.title`），不返回任何东西。
- **B-10 外部换掉 `posts.json` 后，检索恒为 0 命中而列表正常**（真实缺陷，跑自检时撞到）。
  索引只在**本进程写入**时标脏（`markDirty`），而 `reseed` / 恢复备份 / 手工编辑是绕过进程直接换文件：
  `store.read()` 靠 mtime 重读到了新数据，列表因此是对的，但索引里留着**上一批文档 id**；
  `/api/search` 又用 `byId`（新数据）去查 `hits`（旧 id）→ 交集为空。
  修法：把失效信号从"写入动作"改成"**数据代次**"——`jsonStore` 每次真正重读或写入都 `bump(name)`，
  `posts.index()` 比较代次决定是否重建；`markDirty` 随之三处删除（避免两套真相）。
  `full-sweep` 补两条：直接换掉 `posts.json` 后 ① 检索必须命中新 id 且只命中它，② 列表与索引口径一致。
  教训：**派生缓存（索引/物化视图）的失效条件必须挂在"数据来源变了"上，而不是挂在"我 Did 写入"上**；
  只要存在带外改文件的途径（本项目明确支持 reseed 与手工恢复），基于写入事件的失效就一定是漏的。

### C · CKEditor 5 免费版

- **C-1 忘记 `onMounted(create)`**：编辑器容器一片空白、**没有任何报错**——最难发现的一类，因为库本身是好的。
- **C-2 配置对象用 `],` 收尾**（`toolbar: { items: [...] },` 写成 `],`）→ Vite 解析错误。
- **C-3 v48 的 `Selection` 没有 `lastPosition` getter** → 运行期 `CKEditorError: unexpected-error … Cannot read properties of undefined (reading 'getAncestors')`。
  改 `getLastPosition()` / `getFirstPosition()`（方法是新的，属性式写法是旧的），命令体一律走
  `model.change(writer => …)` + `model.schema.getValidRanges(...)`。
- **C-4 插入对象型元素**要用 `model.insertObject(el, null, null, { setSelection: 'after' })`，
  裸 `writer.insert()` 会让 widget 选区与后续输入错乱。
- **C-5 无头页没有焦点/光标**：`Input.insertText` 什么都不写入，`document.execCommand('insertText')` 也不生效，
  `activeElement` 恒为 BODY。要 `Emulation.setFocusEmulationEnabled` + 真实 `Input.dispatchMouseEvent` 点进正文再插字。
- **C-6 设了 DOM Range 但工具条按钮仍 `ck-disabled`**：SelectionObserver 在 `view.document.isFocused === false` 时挂起变更。
  先在可编辑区派发 `new FocusEvent('focusin', { bubbles: true })`。
- **C-7 `getSelection().toString()` 在 headless 里返回空**（选区其实有效）——这是**误导性的探针信号**。
  断言要看结果 DOM（加粗后有没有 `<strong>`），不要看选区文本。
- **C-8 `language: { ui: 'zh-cn' }` 单独不起作用**：伞包的 `dist/translations/zh-cn.js` 是**纯数据默认导出**，
  Vite 下没有 CKEditor 的构建插件替它挂载。手动并入 `window.CKEDITOR_TRANSLATIONS` 后生效。
  连带影响：测试里 `data-cke-tooltip-text^="Bold"` 一类选择器全部失效 → 改中文前缀匹配，
  并加一条"原生按钮提示已转中文"的断言，防止将来有人删掉挂载而测试还全绿。
- **C-9 一个属性只承载一种形制**：先画圈再划线是**替换**不是叠加（值形如 `kind:color`）。文档、测试都按替换写。
- **C-10 白名单会把 `transformTags` 新加的属性再删一遍**：`rel/target` 不在 `allowedAttributes` 里就被剥掉；
  同类问题在阅览净化里是漏了 `h1..h6: ['id']` → 包内锚点跳不动。改净化器时"改写"和"放行"必须成对检查。

### D · EPUB / ZIP 阅览

- **D-1 `repository: "owner/repo"` 简写**：`repository.url` 取不到 → 页脚链接列为空（`cookie-parser`）。生成器要兼容简写。
- **D-2 Zip64 扩展字段切片下标算错**（游标已前进却漏减 `commentLen`）→ 解析到错误字节。先记 `extraStart` 再移动游标。
- **D-3 三元表达式漏 else**：`new ZipError(cond ? '消息', 413)` 直接把逗号留给语法解析器 → 编译期才炸。
- **D-4 把 entry 对象当 name 传**：错误信息变成"EPUB 内缺少 [object Object]"，看不出真因。命名严格区分 `name` / `entry`。
- **D-5 演示"10MB 以上"必须塞不可压缩数据**：重复文本经 deflate 只剩几 KB，阈值分支根本没进。
  用随机字节 + store（method 0）做填充条目，才真正 >10MB。
- **D-6 整本 inflate 会让大书占满内存**：只读中央目录、按偏移定点取条目、`maxOutputLength` 兜底；解析缓存只存元数据。
- **D-7 资产类型只认魔数**：SVG/PDF 可携带脚本，即使包内 `manifest` 声明为 `image/svg+xml` 也不下发；
  代价是正文里的 SVG 图形/数学式会被丢弃（页面上留图注占位），这是**明示的取舍**不是 bug。
- **D-8 图片地址带令牌** → 会进 Nginx `access_log`。时效 10 分钟 + 可吊销 + `no-store`，仍要在部署文档提醒日志权限（见 R-4）。

### E · 安全与净化

- **E-1 编辑器私有属性不得进库**：`data-cke-*` 之类必须被剥；同时断言"加粗/清单/引文等**形制**不被误删"——
  两个方向都要测，只测一个会越改越松或越改越狠。
- **E-2 链接与 URL 字段统一协议白名单**（`javascript:` / `data:` 直接 400），外链强制 `rel="noopener noreferrer nofollow"`。
- **E-3 验印穷举**：按 IP 冷却（6 次/15 分钟，冷却 180s），错口令统一 `bad-key`，不区分"不存在/已停用/已到期"。
- **E-4 越权面逐个覆盖**：`/api/resources/all`、`/api/library/keys`、`/api/users`、写路径全部要鉴权；
  公开目录**刻意**不含磁盘文件名与口令（体检直接扫整段 JSON 断言不含 `.epub` / `roxy-guest`）。
- **E-5 限流阈值定太低会自伤**：一次整页加载要发 5 个请求，`/api` 最后放宽到 600 次/分（≈48 次刷新），
  抓取与爆破交给登录限次、验印冷却、深翻页门槛与签名直链去挡。
- **E-6 明文/哈希两种口令存储都要能登录**：`BW_HASH_PASSWORDS=1` 作为独立实例纳入全量体检，别只测默认档。
- **E-7 express-rate-limit v8 的键生成**：`keyGenerator` 必须返回**字符串**，IPv6 要经 `ipKeyGenerator` 归一；
  写限流按 `u:<用户名>` 或 `ip:<地址>` 分组。`app.set('trust proxy', 1)` 的前提是 Nginx 为**唯一**反代跳，
  多一跳就会误判来源地址、限流形同虚设。

### F · 验证脚本自身（最阴险：绿灯 ≠ 覆盖）

- **F-1 请求 helper 的"选项 vs 载荷"错配**。`call(method, path, { body, cookie, csrf })` 第三参是**选项对象**，
  把业务字段摊平传进去不会报错——`body` 是 undefined，请求以空 body 发出。
  后果：资源库"隐藏条目"断言实际拿到 400；而"修订不存在的资源返回 404"一直是绿的，因为路由**先**查存在性。
  教训：断状态码不够，要**断回读结果**（再 GET 一次确认字段真变了、并能变回去）。
- **F-2 断言锚死种子数据的条数与位置**（`items[0].url`、"共 N 条"）。种子从 1 条扩到 12 条后静默失真 → 改成按内容查找。
- **F-3 在 Node 侧写 `location.origin`** → 走查中断 `location is not defined`。页面内与脚本内是两个世界，
  页面里取 `location`，脚本里用 `SITE` 常量。
- **F-4 同一作用域重复 `const jumped`** → 走查启动即 SyntaxError。新增断言前先扫命名冲突，`node --check` 一下很快。
- **F-5 二进制断言不能用文本响应**：helper 的 `raw` 是 `res.text()`，`Buffer.subarray` 不存在且字节已被解码毁掉
  → 单独 `fetch` + `arrayBuffer()` 再验魔数。
- **F-6 走查/自检与数据变更并发** → 幻影失败。曾在走查进行中跑 `reseed`，冒出两条"失败"其实是数据被换掉。
  **串行执行**，一条跑完再动数据。
- **F-7 `<dialog>` 选择器要限定打开态**：`.paper-dialog footer button:last-child` 会命中**未打开**的另一个对话框
  → 一律 `.paper-dialog[open] …`。
- **F-8 headless 里懒加载图片不进视口就不加载**：断言 `naturalWidth` 前先 `scrollIntoView()`。
- **F-9 转场/动画期间用同名类断言**会命中即将移除的旧节点 → 等稳定态再取。
- **F-10 后台任务与子代理必须给独立 scratch 目录、禁止越界删除**。本项目历史上有一次后台调研代理
  `rm -rf` 误删 28 个成品页的事故，规则（独立目录名、只允许逐个 `rm` 自己创建的文件、删除前不看截断输出）
  已固化为全局约束；本仓库所有探针只写 `.scratch-verify/`。
- **F-11 "删掉会话再断言失效"其实从没带上过那个会话**。helper 里 `cookie: 'none'` 会 `delete headers.cookie`，
  于是同时把调用方**显式传入**的 `headers: { cookie }` 也删了：请求以"完全无会话"发出，
  `body.user === null` 永远成立——"被删用户的会话立即失效"这条断言是**假绿灯**。
  补示例用户断言（要求 `user.username === 'demo'`）时它才暴露出来（返回 null 而不是 demo）。
  修法与 F-1 同型：helper 先探测调用方是否给了该头（`gaveCookie`），给了就以调用方为准、也不回写实例会话。
  教训：**"断言为 null/为空"的测试必须同时有一条"断言为具体值"的姊妹测试**，否则删掉传参也能过。

---

## 七、风险警示

按"会不会咬人"排序。每条给**现状 / 后果 / 缓解 / 上线前动作**。

| # | 风险 | 现状 | 后果 | 缓解 | 上线前必做 |
| --- | --- | --- | --- | --- | --- |
| R-1 | **口令明文存 CSV**（需求指定） | 默认 `users.csv` 明文；`BW_HASH_PASSWORDS=1` 可切 scrypt | 备份、误暴露、内部人员可读全部口令 | 名册接口默认剔除口令列；`BW_SHOW_PASSWORDS` 才回显；数据目录 Nginx `deny` | 改默认口令 + 开哈希模式 + 确认 `data/` 不在 web root 下 |
| R-2 | **默认账号 `admin/admin`** | 首次启动即存在 | 公网直接被试出 | 登录限次 + 锁定落盘 | 部署第一步就改名改密（DEPLOY §四 第 1 条） |
| R-3 | **CKEditor 5 是 GPL-2.0-or-later**（唯一 copyleft 例外） | 免费版 + `licenseKey: 'GPL'`，`COPYING.GPL` 随包 | 义务由**分发**触发：一旦开源整站或对外交付安装包/源码包，**整份前端源码须按同许可释出** | 自托管、不分发构建物；README §八与 NOTICES §1.1 已核实登记 | 任何"开源整站 / 交付源码"决定前先与负责人确认；或改购商业许可 |
| R-4 | **口令令牌出现在 URL**（取书与阅览插图） | 10 分钟时效、可吊销、`no-store` | 令牌会进 Nginx `access_log`，日志泄露即短时读权 | 时效短 + 吊销即废 + 范围口令 | 日志 `chmod 640`；或对 `/api/library/` 单设 `access_log off` |
| R-5 | **镜像站的版权红线** | 只伺服馆员放入 `server/data/library/` 的文件；不代抓网盘、不绕过登录门槛 | 收录他人翻译/扫描本即侵权分发 | 登记时强制"权利声明"字段并在页面前端展示；演示件是自产占位书 | 每本上架都留授权依据；接到投诉即下架（下架只撤登记，原件由馆员自管） |
| R-6 | **EPUB 正文里的图形/公式会丢** | 只放行位图；SVG、MathML 被净化丢弃 | 少数书看图缺图 | 保留 `figcaption` 与占位框；资产接口按魔数复核 | 需要矢量时改用位图导出，**不要**为样式放宽 CSP |
| R-7 | **PDF 不能在线阅览** | 阅览接口对非 EPUB 明确返回 409 | 用户以为坏了 | 页面文案与链接按类型区分（PDF 行显示"仅可下载"） | 若要支持，需引渲染器（另立许可与体积评估） |
| R-8 | **JSON 存储的规模上限** | 原子写 + 常驻索引 + mtime 失效 | 档案上千本后单文件读写与索引重建变慢；并发写只有进程内序 | 单实例部署；写操作串行 | 接近上限时换库（README §三 的判据），**不要**用"重建索引"当性能手段 |
| R-9 | **反爬是减速带，不是围墙** | UA 门槛、深翻页门槛、签名直链、限流 | 已解锁口令者仍可逐页取走镜像正文 | 口令可吊销、可限范围、可到期；审计留痕 | 对外发放用**独立口令 + 指定书目范围 + 到期日**，不要发 `all` 长期口令 |
| R-10 | **`BW_SECRET` 决定会话与所有签名** | 缺失时自动生成 `.secret`（0600） | 换密钥＝全部会话与直链作废；多实例不一致会随机 403 | 文档标注 | 多实例必须显式统一；备份该文件 |
| R-11 | **无头验证环境有怪癖** | 焦点、选区、懒加载、`getSelection()` 都要特殊处理 | 误判"功能坏了"或写出永远绿的假测试 | §六 C-5\~C-9、F-5\~F-9 已固化 | 复跑前起 `chrome --headless=new --remote-debugging-port=9223`，且**串行**跑自检 |
| R-12 | **删除类操作不可逆**（撤登记、吊销口令、删档） | 撤登记保留磁盘原件；吊销口令使已发令牌立即失效 | 一次误点即影响所有持有者 | 全部走 `ConfirmDialog` 二次确认 + 审计日志 | 生产环境操作前先看 `data/security.log` 留痕能力是否可用 |

---

## 八、验证体系与复跑

三套脚本，层次不同、互不替代：

| 脚本 | 层次 | 覆盖 | 本轮 |
| --- | --- | --- | --- |
| `scripts/api-smoke.mjs` | 打活着的后端 | 权限边界、置顶唯一、HTML 净化、限流、锁定、签名直链过期、魔数与尺寸、反爬 UA、菜单读写 | 31/31 |
| `scripts/full-sweep.mjs` | **自起 5 个隔离实例**（core / shelves / prod / hash / lock） | 建档到删档全链、媒体回收、资源库增删藏、镜像口令门控与吊销、EPUB 分页阅览边界、**出厂示例实体逐项在位（演示链接 / `demo` 用户可删可恢复 / 五章册逐章 / 站内路径资源）**、生产响应头与"接口不被单页兜底吞掉"、旧菜单文件自动补齐、scrypt 模式、登录锁定 | 149/149 |
| `scripts/walkthrough.mjs` | 真实浏览器（CDP） | 登录→建档（材料源出处链接随档渲染）→CKEditor 画圈/划线/变色/解除标注→插图→用印→对勘→重排→菜单→置顶→删除→镜像口令→**在线阅览翻页/插图/跨章单页链接/全本/令牌收回**→页脚出处链接→**凡例「出厂示例」表**；窄屏溢出（含凡例三列表）；逐屏截图 | 119/119，控制台零输出、CSP 零违规 |

另有 `browser-probe.mjs`（主线程阻塞与关键节点计数）、`cpu-probe.mjs`，以及 terra-faction-ui 的
`audit-faction-ui.mjs`（49 文件 PASS）与 `audit-palette-separation.mjs`（12 家族色域互斥，最近对 lungmen/yan field ΔE 14.9）。

**复跑顺序（务必串行）**

```bash
chrome --headless=new --remote-debugging-port=9223 about:blank   # 走查用
pnpm dev                       # 或 pnpm start（8787）
node scripts/api-smoke.mjs     # 31
node scripts/full-sweep.mjs    # 149（自带隔离数据目录，跑完清理）
node scripts/walkthrough.mjs   # 119（每轮先 reseed 取确定基线，改过的顺序/菜单/置顶会复位）
pnpm build                     # 许可登记表再生 + 分包
```

**判绿的标准**：除了"失败 0 项"，还要看 ① 构建日志 `grep -c ERROR` 为 0 且产物存在；
② 走查尾部是"（无控制台输出）"；③ 新增断言要能**因真实原因**通过——把被测行为故意改坏一次，看它是否变红。

---

## 九、开发阶段与关键改动

| 阶段 | 内容 | 代表性缺陷与修复 |
| --- | --- | --- |
| 1 骨架 | pnpm workspace、Vite 8、Router 5、Pinia 4、Yan 令牌与四段式外壳 | 菜单 id 不同源（B-6） |
| 2 后端 | JSON 原子写、会话/CSRF/限次/审计、媒体签名、MiniSearch 索引 | 签名 URL 回写库（B-8） |
| 3 首页与详情 | 保序瀑布流、懒加载、话题检索、详情双栏对勘、图上圈划矢量 | 最短列调度破坏置顶（D-2 决策） |
| 4 编辑器 | 四叶文书、材料源行编辑、tag、自研批注控件 | 日期控件 ISO 串（B-1） |
| 5 管理面 | 重排、菜单编辑、用户名册、唯一置顶自动释放 | 双置顶（B-7） |
| 6 交付 | Nginx 片段、DEPLOY、README、页脚许可台账 | 构建 exit 0 掩盖失败（A-1） |
| 7 全局体检 | 三套自检补齐失败分支与从未点过的控件 | 测试自身假绿（F-1、F-2） |
| 8 专题资源 | 无职转生查证载体清单（12 条实测种子）+ 侧栏块 | 种子扩容致断言失真（F-2） |
| 9 镜像站 | 书目登记、口令签发/范围/到期/吊销、HMAC 门控下载、魔数与体积 | 口令穷举需按 IP 冷却（E-3） |
| 10 CKEditor 迁移 | 免费版基底 + `YanMarkup` 四枚自定义按钮、GPL 合规登记、中文化 | C-1\~C-10 全部在这一阶段踩过 |
| 11 在线阅览 | ZIP 定点读、spine 分页、10MB 硬阈值、图片门控、SPA 翻页 | D-1\~D-8；Nginx 频控会掐翻页 |
| 12 页脚出处 | 每行框架带官网/GitHub 链接（实测取自包声明）+ 一句话用途 | D-1（repository 简写）、C-10（rel 被白名单剥掉） |
| 13 出厂示例 | 每个功能配一份可删可改实体：演示链接改指保留域、`demo` 示例馆员、站内路径资源、五章演示册、`/about` 示例清单 | 会话断言从未带会话（F-11） |

---

## 十、待办与可扩展（未做，按性价比排序）

1. **PDF 在线阅览**：需引入渲染器，另做许可与体积评估（当前明确 409）。
2. **EPUB 矢量与公式**：若要保真，需要一条"受控 SVG 光栅化"或"仅本站可信书目放宽"的路径——不能靠放宽 CSP。
3. **阅览进度持久化**：目前书签只体现在 URL；可加"上次读到第几章"的本地记忆。
4. **镜像站检索**：口令解锁后可对包内 `content.opf` 元数据与章节标题做站内检索（正文检索会放大抓取面，需先定策略）。
5. **档案版本化**：修订只留最新正文 + 审计流水，没有逐版本 diff 视图。
6. **媒体 GC 可视化**：回收逻辑已有，但缺一个"孤儿文件"清单页。
7. **可观测性**：`security.log` 是 JSONL，没有聚合视图；量大时建议交给现成日志栈而不是自研面板。
8. **CKEditor 升级窗口**：48.x 的转换与选区 API 已改过两轮（C-3、C-4），升级前必须先跑 §八 的三套脚本。