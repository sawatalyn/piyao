# 辨妄阁 · 开发文档

> 本文是**开发经过的纪实**：需求如何被逐条落地、用了哪些技术与框架、踩过的坑（含根因与修法）、
> 以及仍然存在的风险。它不替代 `README.md`（使用与功能说明）、`DEPLOY.md`（部署）、
> `THIRD_PARTY_NOTICES.md`（许可台账），四者分工：README 讲"是什么"，DEPLOY 讲"怎么上线"，
> NOTICES 讲"用了谁的什么"，本文讲"为什么这样写、哪里会疼"。

## 〇、项目快照

| 项 | 值 |
| --- | --- |
| 形态 | Nginx 托管的类 wiki 辟谣档案站（辨妄阁），四段式外壳：header / sidebar / main / footer |
| 规模 | 前端 31 个 `.vue` + 18 个 js/css（16 个路由视图）；后端 27 个模块、56 个路由处理器；6 个自检脚本 |
| 栈 | pnpm 11.1.3 workspace + Vue 3.5.43 + Vite 8.3.1（Rolldown）+ Pinia 4.0.3 + Vue Router 5.3.1；Express 5.2.1 + JSON 文件存储 |
| 富文本 | CKEditor 5 免费版 `ckeditor5@48.5.2`（GPL-2.0-or-later）+ 本站自定义插件四枚按钮 |
| 阅览 | EPUB 与 PDF 双型在线阅览（`pdfjs-dist@6.3.289` Apache-2.0）+ 逐本勾选的预览白名单 |
| 存储 | 优先 JSON：`server/data/*.json` + `users.csv` + `media/` + `library/`；实测无需数据库 |
| 视觉 | terra-faction-ui 的 **Yan（炎国 archival）阵营语法 · 最高规格（maximal）**，根属性 `data-terra-faction="yan-archival"` |
| 安全 | 严格 CSP（无 `unsafe-inline`）、CSRF 双提交、登录与验印双维度锁定、HMAC 短时效直链、反爬 UA 门槛、5MB 单图上限 |
| 台账 | 档案逐版快照与词级比对（`diff@9` BSD-3-Clause）、媒体三方对账与点名清理、`security.log` 聚合视图 |
| 本轮验证 | 接口 **48/48** · 全量 **221/221**（比上一轮多两条：E-10 那对"HSTS/UIR 跟随真实协议"的成对断言）· 浏览器走查 **165/165**、控制台零输出（三套**串行复跑**，本轮 `server/src/security/middleware.js` 与走查脚本都动过，正是"改了后端就要复跑"的那一类）· **明文 HTTP 直连内网 IP 的浏览器实测**：修前 7 请求 / 6 条被改写成 https / 6 失败 / 接口 0 条，修后 16 请求 / 0 改写 / 0 失败 / 接口 5 条（E-10）· Yan 契约审计 52 文件无告警 · 色域审计 PASS · 依赖守卫 PASS（19 条声明 / 17 个运行时依赖）· `pnpm build` 退出 0、ERROR 行 0 · 出包**站点那半六道闸**（软链接 0 · 孤立自足性 started+200 · 批处理 CRLF+ASCII · **包内零 .exe** · zip 条目名全 `/` 且全 ASCII · 运行态扫描）＋**离线包三道**（外部二进制按 sha256 取用 · `.exe` 白名单 · 依赖清单三处同源）· Windows 侧：协议四态实跑（§4.12）＋**离线树用随包运行时真起后端后跑完 `verify-deploy`：只读 26 项 0 失败、含写 36 项 0 失败**（§4.14）· 包的可解性回环：`unzip` 解到仓库树外 → `sha256sum -c SHA256SUMS.txt` **124 条全 OK、退出码 0** → `sha256sum -c SHA256SUMS-offline.txt` **退出码 0**（这份上一轮是 CRLF，`-c` 会把 `\r` 当文件名判红，A-33）· 出完包回读 `scripts/check-package-parity.mjs`：**33 件逐字节一致、差异 0** |
| Windows 交付 | **一个离线完整安装包** `bianwang-<版本>-offline-win.exe`（NSIS 自解压，171 MB 量级）：里面是「站点 + 随带运行时 + 图形安装器」，装机机**不用装 Node.js、不用 .NET 组件、不用联网**。运行时与安装器共用同一个 `runtime\BianwangRuntime.exe`（Electron 44.5.1 改名；带 `ELECTRON_RUN_AS_NODE` 是内建 Node 24.21.0，不带就是四段窗口：自检 / 安装 / 自启选择 / 维护）。**界面只是前置，逻辑仍是那七个 `.cmd` 引擎**（本轮新增 `runtime.cmd` 统一判定运行时），脚本一律 CRLF + 纯 ASCII。仪表盘仍是自带 csc 现编的 WinForms，并同样学会用随包运行时。另带全局访问协议选择（HTTP 默认 / HTTPS 两档终结者），协议记在 `dashboard.cfg` 由后端、`run-site.cmd`、安装器三层跟随（§4.12 / R-16）。已在本机 Windows 11 实跑（含 CDP 真点界面），`ONSTART`+`SYSTEM` 与 Win10 / Server 2019 实机仍**未验**（A-15 / R-15 / R-19） |
| 交付纪律 | 只采纳宽松许可（MIT/Apache/BSD/ISC/CC0）代码；**唯一 copyleft 例外是 CKEditor 5，按用户明确指定引入并单独核实**；不打包任何官方标识、美术、CDN 素材；**选型一律"先找现成开源、核实许可、再决定自研"**（§三 3.4） |

---

## 一、需求总览与落地对照

原始需求按主题拆成 12 组（R1–R12），后续追加 10 项（R13–R22），逐组给出落点与验证锚点。**状态**一列诚实区分"已实现并验证"与"刻意不做"。

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
| R13 | （追加）镜像的 **EPUB / PDF 在线阅览**，且 **10MB 以上按章节拆成多个可阅览网页** | `server/src/library/`（zipRead + epubRead + pdfRead）+ `/library/:id/read` | ✅ 阈值是硬边界：超限整本渲染返回 409；PDF 用书签层级切节、只出文字层不做光栅化 |
| R14 | （追加）调研 CKEditor 5，用**免费版**作富文本基底，需要加按钮就以**自定义插件**形式加 | `ckeditor5@48.5.2` + `licenseKey: 'GPL'` + `YanMarkup` 四枚按钮 | ✅ premium 件一个没用 |
| R15 | 调研 GitHub 可参照案例，**遵守仓库声明的协议** | 见 `THIRD_PARTY_NOTICES.md`：宽松许可者可对照/引入；`NONE/NOASSERTION` 只读思路；AGPL/GPL 不取码（除 R14 指定例外） | ✅ 每处引入都留"排除了哪些现成方案"的证据（§三 3.5） |
| R16 | （追加）**每个功能都配一份实体示例**（完整图文、默认用户、链接、可在线预览的 EPUB），且**示例均可删除或再编辑** | `server/scripts/reseed.js`（演示链接改指保留域、补 `demo` 用户与站内链接条目）+ `/about`「出厂示例」表（`AboutView.vue`） | ✅ 体检与走查逐项复核在位、可删、可恢复 |
| R17 | （追加）镜像站**架上检索**：口令解锁后可对书名/著译者/章节标题做站内检索 | `library.searchOnShelf()` + `/api/library/search` + `LibraryView` 检索面板 | ✅ 走查覆盖"按 PDF 书签标题命中章节级结果 → 直达该节 → 收起" |
| R18 | （追加）**档案版本化**：逐版本完整快照 + 任选两版比对 | `store/revisions.js`（14 个可比字段、正文词级 diff）+ `/post/:id/revisions`（`RevisionsView.vue`） | ✅ 保留版数由 `BW_REVISION_KEEP` 控制（默认 30） |
| R19 | （追加）**媒体 GC 可视化** + **`security.log` 可观测性** | `store/mediaInventory.js`（磁盘/索引/在档引用三方对账 + 点名清理）+ `security/logInsight.js`（聚合与信号）+ `/ops`（`OpsView.vue`） | ✅ 清理**默认预演**，`confirm` 才动手；日志不引第三方栈（理由见 §三 3.5） |
| R20 | （追加）**预览白名单**：不是登记在册的书都能在线读 | `library.json` 的 `previewable`（登记时逐个勾选、管理面可开关）→ 未勾选者阅览 403 `preview-off` | ✅ 架上入口与管理面行状态同步 |
| R21 | （追加）Windows **图形仪表盘**：可开机自启或 exe 启动；启动时每次都要 GUI 填端口；协助检查/安装/更新运行环境 | `dashboard/Dashboard.cs`（自带 csc 现编的 WinForms，零新增依赖）+ `build/install/uninstall.cmd` | ✅ 手动/自启/环境体检三条路径实跑（§四 4.10）；"每次填端口"与"开机自启"冲突的取舍已写成口径 |
| R22 | （追加）**一键部署安装包**四件事：① 监测/安装/更新运行环境 ② 部署含仪表盘的完整程序（遵守启动时向根目录导出口令.txt）③ 一键卸载 ④ 一键部署开机自启；（2026-10-01 追加形态要求）**必须是"一个完整的、带自检 / 安装 / 自启选择的 exe 程序"** | `installer/`：`setup.cmd` 引导（现编 → `--ping` 确认可执行 → 开界面）+ `Installer.cs`/`build.cmd` 图形安装器（四段）+ `env.cmd` / `deploy.cmd` / `autostart.cmd` + `run-site.cmd` / `creds.cmd` + `creds.ps1` / `uninstall.cmd`（§四 4.11，用法见 `USAGE.md` §10） | ⚠️ ①②③ 全流程已在 Windows 11 上实跑（含两条分支与三条拒绝分支，见 §九 第 23、25 阶段）；**唯 ④ 的 `ONSTART`+`SYSTEM` 注册成功那一条未验证**——本机提权后 `schtasks` 仍被策略拒绝（A-15 / R-15），界面里对应"开机即起"这一档，被拒时自动降级为"登录后自动起"并写明 |
| R23 | （2026-10-01 追加）**全局网络访问协议要能在仪表盘里选 HTTP / HTTPS**；用户同时交代"生产环境暂时拿不到 SSL 证书，只能先用 HTTP"，所以**默认必须是 HTTP** | `dashboard/Dashboard.cs`（协议两档 + 「TLS 由谁终结」+ 证书框 + 自签一键生成）、`dashboard.cfg` 的 `scheme`/`tls_from`/`tls_pfx`、`server/src/index.js`+`config.js`（`BW_TLS_*` → `https.createServer`）、`installer/run-site.cmd`（同一份 cfg 决定无头起站的协议，证书不在就 rc 4 拒绝）、`installer/Installer.cs`（自检新增「访问协议」一项，探针与地址跟着协议走）、`nginx/bianwang-http.conf`（没证书时的 Nginx 装法） | ✅ 四态实跑（§4.12）：HTTP 默认 · HTTPS+本机证书（https 200 且整站可用、按 http 访问被拒）· HTTPS+前置 Nginx（后端仍明文回环）· HTTPS+证书不在（**拒绝起站**并给三条出路）。⚠️ 未验：证书路径含中文时 `run-site.cmd` 读不到（界面会警告）；重启后的自启确认与 R-15 同因 |
| R24 | （2026-10-01 追加，**当日被 R25 取代交付形态**）**提供"一键安装压缩包"，包里要含 installer 的 exe 文件与需要被它部署的源码** | `scripts/make-nginx-package.mjs` 加 `--with-exe` → 产物 `bianwang-<版本>-installer-win.zip`（2447 文件 / 26.4 MB）：默认包的全部内容 + 本次现编的 `installer\BianwangInstaller.exe` + `installer\EXE-SHA256.txt`；`Installer.cs` 的「部署包完整性」学会分辨"预置安装器 / 别的 exe / 零 exe"三态并**重算摘要比对**；`Site` 增加 `target.txt` 记忆安装落点 | ✅ 解压到仓库树外、全程用包内那个 exe 跑九步（§4.13：摘要三方一致、自检通过、安装、`--autostart logon` 不带 `--target` 也落对地方、`--live` 200、协议改成 https 后探针如实改口、`口令.txt` 在目标根）。⚠️ 未验：SmartScreen 首次拦截的完整体验（本机无签名，见 R-17）。**这一档现已下线**：`--with-exe` 开关已从出包脚本删除，形态见下一条 R25 / §4.14 |
| R25 | （2026-10-01 追加）**以 Windows 10、Windows Server 2019 为主要生产环境**，用 Electron 把一键安装所需 exe 与源码**合成一个类似 MySQL 的离线完整安装包**（同轮确认：Electron 完全替换 WinForms 安装器 / 后端跑在 Electron 内建 Node 上 / 单个自解压 exe / 旧的两种 zip 全部下线） | `installer\runtime.cmd`（运行时判定只此一处）接进六个引擎 + `deploy.cmd /inplace` + `installer-app\`（Electron 图形安装器，四段）+ `installer\offline.nsi`（NSIS 3.12，zlib 压缩）+ `scripts\make-offline-package.mjs`（外部二进制按校验值取用 + `.exe` 白名单 + 依赖清单三处同源）；产物 `bianwang-<版本>-offline-win.exe` **171.1 MB**（§4.14，取舍记 D-19，代价记 R-18） | ✅ 本机 Win11：站点那半六道闸全过（2448 文件）→ 随包运行时驱动审计十项 / 就地安装 / 起站 / `/api/menu` 200 / 口令记录在位 → 界面经 CDP 验四段与实访（零页面异常）→ NSIS 出单个 exe。⚠️ **未验**：真·双击过 UAC+SmartScreen、Win10 与 Server 2019 实机（Server Core 无图形子系统，R-19）、`ONSTART`+`SYSTEM`（R-15） |

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
                                          ├── store/jsonStore.js  原子写 + mtime 失效 + 数据代次
                                          ├── store/revisions.js  逐版完整快照 + 词级比对
                                          ├── store/mediaInventory.js 磁盘/索引/引用三方对账
                                          ├── security/*          头、CSRF、会话、限次、审计、净化、签名、日志聚合
                                          ├── library/*           ZIP 中央目录 + EPUB spine 分页 + PDF 书签分节
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
  views/      16 个路由视图（含 LibraryView、ReaderView、OpsView、RevisionsView）
server/src/
  store/      jsonStore / posts / menu / users / sessions / resources / library / revisions / mediaInventory
  security/   middleware / attempts / audit / media / sanitize / logInsight
  library/    zipRead（ZIP 定点随机读） / epubRead（spine 解析 + 分页 + 净化） / pdfRead（书签分节 + 文字层）
  routes/     auth / content / media / resources / library / ops
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
| pdfjs-dist | 6.3.289 | Apache-2.0 | PDF 在线阅览的**唯一**可行宽松许可渲染器；只取文字层与书签，不做服务端光栅化。v6 已移除 `PDFDocumentProxy.destroy()`（§六 D-9） |
| diff（jsdiff） | 9.0.0 | BSD-3-Clause | 版本比对的词/字级 `diffWords`；带 `maxEditLength` 熔断，超限降级为整段（§六 D-10 同族的性能纪律） |
| @rgrove/parse-xml | 5.0.0 | ISC | EPUB 的 `container.xml` / OPF / nav / NCX 严格解析，零传递依赖；替换原先的正则"解析"（§六 D-11） |
| csv-parse / csv-stringify | 7.0.3 / 6.9.0 | MIT | `users.csv` 的引号与换行转义；自写 `parseCsvLine` 会让口令里的 `\n` 造出幽灵身份行（§六 E-8） |

**引入即登记**：以上每一行都出现在页脚「框架与许可」表与 `THIRD_PARTY_NOTICES.md` 里，由
`scripts/gen-license-manifest.mjs` 从**已安装包的 `package.json` 实测**生成，不手写。
**生产依赖一律精确 pin**（无 `^`/`~`），因为本项目要交付"解压即用"的部署包，浮动的范围符会让重装拿到不同版本；
新增依赖忘 pin 会被 `scripts/pin-guard.mjs` 挡下（§八）。

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

### 3.4 选型台账（先找现成仓库，再决定自研）

**规则**：每一个要自研的能力，先按"是否有现成开源、是否合需求、是否可二次开发"找一轮仓库，
许可**落到包自带的 LICENSE / `package.json` 实测**（不看 README 的口头声明、不看搜索摘要），
能直接用就直接用并登记进 §3.1 与 `THIRD_PARTY_NOTICES.md`；确需自研才自研，并把**排除了哪些现成方案、为什么**留在这里。
各轮检索时的 registry / GitHub API 原始响应**曾**留档在 `.scratch-oss-select-a7x2/`（`n-*.latest.json`、`gh-*.json`、`m-*.json`），
下表每一项当时都能回指到那份原始件；**2026-10-01 按用户"清冗余"的指示连 `.scratch-*` 一起删了**（当时给过"全删含截图"的选项，你选了它）。
所以现在能复核的锚点换成了两件**不会被清掉**的：① 下面两表里逐条写明的仓库地址 + 许可写法原文，
② `scripts/pin-guard.mjs`——它对每条在册依赖**读包里实际的 `LICENSE` / `package.json`** 再判许可（`pnpm guard:deps` 一跑就重现结论）。
真要重做这轮检索，按 §3.4.0 的四步漏斗跑一遍即可，原始 JSON 不必找回。

#### 3.4.0 选型过程综述（方法论：为什么这样选，而不是选了什么）

这一节讲的是**流程**，不是清单——清单在下面两张表里。全站每一个"要不要自己写"的决定都走同一条四步漏斗，
顺序不可颠倒：**颠倒一次就会退化成"先写了自己的轮子、再回头找有没有现成的"**，那等于没找。

1. **先界定真实需求的最小面**。不是问"有没有 XML 库"，而是问"我到底要 XML 库做哪一件事"。
   EPUB 要的是**节点文档序**与"坏在哪一份能报出来"，不是"把 XML 变成 JS 对象"；ZIP 要的是
   "按偏移定点取**一个**条目并限长解压"，不是"把整包读进内存"。**需求面越小，现成库越可能过重**——
   这一步决定了后面"引入 vs 自研"的天平往哪边偏。
2. **按最小面搜现成开源仓库，并核实许可**。渠道是 npm registry 与 GitHub API，**不是搜索引擎摘要**。
   许可只认两种实测证据：包内 `LICENSE` 文件全文，或 `package.json` 的 `license` 字段——
   README 里写的"MIT"、搜索卡片上的许可徽章一律不算数（见过 README 与 `package.json` 打架的包）。
   白名单是 MIT / Apache-2.0 / BSD / ISC / CC0；**MPL-2.0 / LGPL 属"需单独批准"档**（文件级 copyleft），
   AGPL / GPL / SSPL / `NOASSERTION` / 无 LICENSE 直接出局，只能"读思路不取码"。唯一例外是用户点名的
   CKEditor 5 免费版（GPL-2.0-or-later），单独核实、单独在 §3.1 与 NOTICES 登记、并写进风险表 R-3。
   **传递依赖也要数**：`fast-xml-parser` 许可本身是 MIT，合规，但它拖 6 个传递依赖却给不了"文档序"，
   于是被 `@rgrove/parse-xml`（单包 ISC、零传递依赖）替掉——许可合规 ≠ 就该引入。
3. **判"可直接用 / 需二次开发 / 不如自研"**。三档结论都要留证据：
   - *可直接用*：接口正好覆盖最小面 → 引入并登记（`diff`、`csv-parse/stringify`、`pdfjs-dist`、`@rgrove/parse-xml`）。
   - *需二次开发*：现成库能当底座，但核心校验仍得自己写 → 算总账。ZIP 类库（`yauzl`/`fflate`）就是这档：
     即便用它，"条目名越界拒 / `maxOutputLength` 兜底 / 下发前按魔数复核"这三道闸还是得自己握，
     于是**自研 ~200 行反而比"库 + 再包一层校验"更小、更可控**（ADR D-6）。
   - *不如自研*：需求面小到现成库都是负担，或语义与本站相反（`isbot` 判 bot 是为了放行，本站要的是直接拒；
     `steno`/`lowdb` 给不了"带外改文件也要失效缓存"的数据代次）→ 自研，并把排除理由写进下表。
4. **自产演示件与夹具，绝不引第三方生成库进生产面**。`pngjs`/`pdfkit` 许可都查过、都合规，**但没引**：
   夹具只要"一小片固定字节"，而 `pdfkit` 会把一个 PDF **生成**器塞进生产依赖——本站对 PDF 只读不写，
   引它等于白白扩大许可面。PNG 用 `node:zlib` 手搓、PDF/EPUB 用自写 writer。**红线另有一条且更硬：
   演示件必须本站生成，不抓取、不打包任何受版权保护的作品**（呼应风险表 R-5）。

一句话概括这套流程的取向：**许可是硬门槛（先过筛），需求面最小化是软标尺（再称重），
"引入的依赖面 + 自研的维护面"两者相加最小者胜出**——不是"能引就引"，也不是"能自研就自研"。
下面两张表就是这套漏斗跑完后的落档：一张是"本该自研、最后改用了现成的"，一张是"查过现成、最后决定自研的"。

**已按此规则替换掉的自研代码**（不是"新写的"，是"改用的"）：

| 能力 | 原自研做法 | 换成 | 许可（实测） | 换的理由 |
| --- | --- | --- | --- | --- |
| 正文逐词比对 | 自写整段对比 | `diff@9.0.0` `diffWords` | BSD-3-Clause | 词/字级 segments 是版本比对的核心体验，自写既不准也费；`maxEditLength:900` 超限降级为整段，避免大文档卡住请求 |
| EPUB 的 XML 解析 | 正则抓 `<span>` / `attr="…"` | `@rgrove/parse-xml@5.0.0` | ISC（**零传递依赖**） | 正则解析在真实书上会**静默取错节点**；换严格解析后当场暴露并修掉一条"nav 项次序与父级标题丢失"的缺陷（§六 D-11），坏 XML 也不再是空白页而是 422 |
| `users.csv` 读写 | 自写 `parseCsvLine` + `cell()` | `csv-parse@7.0.3` / `csv-stringify@6.9.0` | MIT | 自写转义不认字段内换行，**口令里带 `\n` 就会造出一条幽灵身份行**（§六 E-8）；引号/换行/CRLF 交回给库 |
| PDF 在线阅览 | 无从自研 | `pdfjs-dist@6.3.289` | Apache-2.0 | 自己解 PDF 内容流不现实；宽松许可里唯一能用的渲染器 |

**明确排除的现成方案（保留自研，附实测许可）**：

| 候选 | 许可（实测） | 为什么不引入 |
| --- | --- | --- |
| `fast-xml-parser` | MIT（传递依赖 6 个：`strnum`、`xml-naming`、`path-expression-matcher`、`is-unsafe`、`fast-xml-builder`、`nodable-entities`） | 许可本身合规，但它把 XML 当"可猜测的数据"映射成 JS 对象：EPUB 要的是**节点顺序**（NCX 文档序即目录序）与"这一份 XML 坏了要报得出是哪一份"，对象映射会丢两者；6 个传递依赖换不来这两件事。`@rgrove/parse-xml` 单包 ISC 且严格 |
| `pino` + `pino-roll` | MIT / MIT | 本站 `security.log` 是**封顶 5MB、轮 5 份的 JSONL**，聚合口径固定（事件/IP/日/signals）；`logInsight.js` 约 150 行就够，且审计写点是 `appendFileSync` 一行。引 pino 要改写全部 `audit()` 调用点，收益是负的。**注意**：外部采集器接口的对接口径见 §4.8，将来接真日志栈时按那节换，不返工业务代码 |
| Grafana Loki / Tempo、Grafana | AGPL-3.0（GitHub API 实测） | 强 copyleft 且是**服务端**许可，网络服务即触发开源义务；本站是单实例 JSON 站，没有指标存储需求 |
| Graylog | `NOASSERTION`（GitHub API 实测，即仓库自定义许可） | 许可非标准、需法务逐条读；不在"宽松许可白名单"内 |
| Vector | MPL-2.0（GitHub API 实测） | 文件级 copyleft，属于需要**单独批准**的一类；且它是独立进程，不解决"页内看台账" |
| `yauzl` / `fflate` / `adm-zip` / `jszip` | MIT / MIT / MIT / `(MIT OR GPL-3.0-or-later)` | 本站只需要"读中央目录 → 按偏移定点取**一个**条目 → 解压并限长"，且必须自己握有三道闸：条目名越界（`../`、绝对路径、带协议）拒、`maxOutputLength` 兜底、下发前按魔数复核（§四 4.4、§六 D-7）。现成库要么是全量解压 API（`jszip`/`adm-zip`，内存模型相反），要么仍需在其上再写这层校验（`yauzl`/`fflate`）——**自研 ~200 行反而更小**，见 §五 D-6 |
| `steno` / `lowdb` | MIT / MIT | `steno` 的原子写与本项目 `writeFileSync(tmp)+renameSync` 等价；`lowdb` 多一层适配器与解析器。本站真正需要的是"带外改文件也要失效缓存"，那是**数据代次**（§六 B-10），现成库都给不了 |
| `express-brute` | `BSD`（包声明未细化到条款） | 它的计数默认在内存/存储适配器里，而需求是**重启不清零**（锁定期内即使口令正确也拒），`security/attempts.js` 落盘实现；许可声明笼统也增加核实成本 |
| `file-type` | MIT | ESM-only、内含数十种格式表；本站只需 5 种位图魔数，且**嗅探结果不能替代白名单**——它判为 `image/svg+xml` 的东西照样不能下发（可携带脚本） |
| `jsondiffpatch` | MIT | 输出是结构 delta（`_text` 数组与增删改标记），面向"程序回放"；版本比对要的是**人能读的逐词 `<ins>/<del>`**，`jsdiff` 直接给 segments |
| `isbot` | `Unlicense`（公有领域） | 语义与本站需求相反：它把"空 UA / 已知爬虫特征"判为 bot 供调用方**放行或降级**，本站要的是"脚本型 UA 与空 UA 在无会话时**直接拒**"，且无头浏览器（走查用）不能被误伤；UA 清单思路已借鉴（§四 4.1 反爬行） |

**演示件与测试夹具一律自产，不引第三方生成库**：PNG 用 `node:zlib` 手搓（CRC32 + IDAT），
PDF 用自写的裸对象写入器（含 outline 三枚书签），EPUB 用自写的 ZIP writer（store 与 deflate 两条分支都发）。
候选 `pngjs@7.0.0`（MIT）与 `pdfkit@0.20.2`（MIT）都查过许可、都合规，**但没引**：夹具只需要"一小片形状固定的字节"，
而 `pdfkit` 会把一个 PDF **生成**器带进生产依赖面——本站对 PDF 只读不写，引入它等于扩大许可面却不多测出任何东西。
真正的红线是另一条：**演示件必须本站生成**，不抓取、不打包任何受版权保护的作品。

**"只对照思路、不取码"的清单**另见 §3.3（瀑布流、懒加载、flat-file CMS 安全链路、维基版式）。

### 3.5 页脚出处链接的取法

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
| 头 | 严格 CSP（`default/script/style/img/connect/form-action 'self'`，无 `unsafe-inline`）、nosniff、`x-powered-by` 关闭；**HSTS 与 `upgrade-insecure-requests` 只在真走 TLS 时发**（与会话 cookie 的 `Secure` 同一条判据，见 E-10） | 生产实例逐头实测：明文 HTTP 与带 `x-forwarded-proto: https` 两档各测一次（`full-sweep` 成对断言） |

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

### 4.4 洛琪希图书馆镜像与 EPUB / PDF 在线阅览

**门控链**（下载与阅览完全一致）：`grants.verify(k,exp,sig)` → 书在架 → `libraryKeys.covers(key, bookId)` →
类型与磁盘文件在位。口令表 `library-keys.json` 明文存（与名册同一取舍），可指定范围（`all` / `files`）、
可到期、可停用、可吊销；**吊销后已发令牌立即失效**（令牌只签 `keyId.exp`，校验时回查活性）。

**预览白名单**（阅览比下载多的一格授权）：`library.json` 每本带 `previewable`，**登记时逐个勾选**、管理面可随时开关，默认关。
阅览在门控链之后还要过 `previewable === true`（否则 403 `preview-off`），类型必须是 `epub | pdf`。
下载**不受**白名单影响（那是馆员的本职），只有"把正文摆到网页上"需要额外一格授权——
这一格是需求追加的，动机很直白：架上书的权利状态各不相同，"能取文件"不等于"能公开渲染正文"。
架上入口与管理面行状态**同源同步**（未勾选的书在架上显示"仅可下载"，管理面显示"仅下载"）。

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

**架上检索**（`library.searchOnShelf()`，`/api/library/search`，口令解锁后面板才出现）：
一次请求内对**书目元数据**（书名 / 作者 / 译者 / 磁盘文件名 / bookId）与**章节标题**做子串匹配，
元数据级命中给 `kind:'book'`、标题级命中给 `kind:'chapter'` 并直接带 `c=` 参数——点一下就到那一节，不必先开卷再找。
PDF 一并参与（节名取自书签）。**刻意不检索正文**：正文检索等于给已解锁者一个"按关键词批量摘取全书"的放大器，
要开得先定抓取面策略（记在 §十）。检索走的是解析缓存，不额外解压整本；未进白名单的书**不会被检索出来**，
免得从搜索结果绕过白名单摸到章节标题。

#### 4.4b PDF 阅览的三条边界

`server/src/library/pdfRead.js` 用 `pdfjs-dist`（Apache-2.0，§三）在**服务端**读 PDF，只走三条边界：

1. **分节取自书签（outline）**：`getOutline()` 的顶层项按页码升序整理为"节"，每节带**物理页范围**与页数；
   没有书签的 PDF 退化为"全本一次给出"。地址栏 `?c=节&p=页`，页眉表述是"第 1 / 3 **节** · 第 1—2 **页**"
   （EPUB 那边才是"章/小节"，两种书型不共用一套措辞）。
2. **只出文字层，不做光栅化**：`getTextContent()` 按页聚合成 `<div class="pdf-page">` 段落，
   **服务端不渲染像素、页内不出现 `canvas` 与位图**（走查专门断这一条）。
   代价写在风险表里（§七 R-7）：扫描件（无文字层）在阅览页就是空的，只能下载；
   版面、字体、图片位置不复现。换来的好处是翻页不烧 CPU、正文可复制、可被架上检索命中。
3. **净化与 CSP 同一条链**：PDF 文字与 EPUB 正文过**同一个** `sanitizeEpubHtml`，
   所以阅览页依旧满足严格 CSP（无行内样式、无脚本、无 svg）；节标题用 `<h2 id="chN">` 前缀（经净化），
   全本通读也逐节带锚点。

**资源释放**：pdfjs v6 的文档对象没有 `destroy()`，必须 `await loadingTask.destroy()`（§六 D-9），
否则每次阅览都留一份字节的 worker 侧引用。`getDocument()` 参数锁
`{ isEvalSupported: false, useSystemFonts: true, disableFontFace: true, verbosity: 0 }`——
关 eval 是服务端读不可信文件的硬要求，关字体注入是为了不依赖 `@font-face`（CSP 与无头环境都省事）。

**阈值与全本**：`splitRequired` 的 10MB 硬边界对两种书型同一判据；阈值以下的 PDF 也给"全本通读"，
单次输出仍限 1MB，超限直接 409 并说明原因。

### 4.5 资源库（无职转生专题）

`resources.json` 五组分类（官方一手出处 / 中文区查证载体 / 访谈与翻译合集 / 事实核对工具 / 常见误传题材），
每条记名称、入口、**能核实什么**、可信度与可见性；游客可读、登录可增删改；危险协议（`javascript:`）在写入层就拒。
13 条种子里 12 条外链逐条核过可访问性，其中"借书柜台"是网盘入口（其主站当前返回 404/522 已如实记在 note 里），
镜像站因此只备份**馆员自行放入**的文件，不代抓内容。

### 4.6 出厂示例（每项功能都带一份可删可改的实体）

需求 R16 的落点是 `server/scripts/reseed.js`，五条约束：

1. **演示出处不冒充真实文献**。档案的"原始载体链接"与首条材料源链接一律取 RFC 2606 保留域
   （`https://example.org/rumor/n01`、`/evidence/n01-1`），字段名、写入校验、渲染链路全是真的，
   只有域名不指向任何作品或机构；`/about` 表尾明写"不可作为辟谣依据"。
2. **链接形态覆盖两种**：资源库既有 12 条外链，也有一条站内路径示例（`/library`）——
   `store/resources.js` 的 `cleanUrl()` 与前端 `safeHref()` 都放行站内路径，页脚与侧栏据此渲染。
3. **可登录用户有两个而不是一个**。`admin` 是需求指定的出厂账号（不可删）；
   另补 `demo`（角色 editor，显示名「示例馆员（可删除）」），使名册的"改密/移除/新增"三条链路在出厂状态就有对象。
   种子**只在缺失时补这一行**，绝不覆盖任何已存在口令，所以管理员改过 admin 密码后重跑 seed 安全。
4. **阅览链路自带可翻的书**（三本，覆盖三种形态）：`multiChapterEpub({ chapters: 5 })` 生成一本五章自产正文册，
   含 `<script>`／`style=""`／`<svg onload>`／外链／跨章锚点等"必须被净化掉"的东西，既是示例也是活体测试样本；
   一本自产**带三枚书签的 PDF**（`server/scripts/pdf.js` 裸对象写入器）验"按节翻页 + 文字层 + 无光栅化"；
   外加一本单章占位册**刻意不入预览白名单**（`previewable: false`），用来演示"仅可下载"的形态差别。
   三本都 <10MB，因此默认走逐章/逐节而不触发强制拆分。
5. **版本台账在出厂状态就有内容**：`reseed` 除补档案与媒体外，还按档案数写入"建档"快照
   （`server/data/revisions.json`），这样 `/post/:id/revisions` 一装好就不是空页，
   修订一次即累积两版、比对页立刻可看。

清单在公开页 `/about` 的「出厂示例」表里（8 行 × 功能/示例/在哪编辑或删除）。
**该表刻意不写任何口令值**——口令属 `users.csv` 与镜像口令表，公开页只说"在哪改"。
恢复出厂演示内容用 `pnpm seed`；它的逐文件行为差异见 README「一、快速开始」的注记。

### 4.7 档案版本化与两版比对

`store/revisions.js` 在**建档与每次修订**时追加一条完整快照到 `revisions.json`（`{postId, id, version, kind, at, by, record}`），
每档保留最近 `config.revisionKeep`（默认 30，`BW_REVISION_KEEP` 可改）版；**删档不补记、也不抹历史**——
档案没了，台账还在（`/post/:id/revisions` 会显式提示"《标题》已被移除，以下为其在档期间的历史版本"）。

**可比字段是白名单，不是全量**：14 个字段（标题 / tag / 原始载体链接 / 谣言正文 / 定级 / 辟谣正文 / 材料源 / 批注 /
编辑者 / 发布日 / 复核日 / 范围 / 等级 / 置顶），其中 `rumor`、`verdict` 标为 **wordwise**，走
`diffWords(..., { maxEditLength: 900 })` 出逐词 segments，前端渲染成 `<del>` / `<ins>`；
超限（两版差得太远）返回 `coarse:true` 整段呈现，页面明写"未做逐词标注"。
签名直链参数在快照前就被剥掉（与 B-8 同一函数），**台账里存的是无签名路径**——所以比对页里出现的
`/api/media/<id>` 永远不该带 `exp`/`sig`，这条被 sweep 断住。

**接口形状**：`GET /api/posts/:id/revisions?keep&`（`{record, forPost, keep, items, pair}`，清单最新在前）与
`GET /api/posts/:id/revisions/diff?from&to`（404 `no-revision`）。
`items` **不含快照**（快照可能很大，清单只要头信息），要正文走 diff 端点——这一点踩过（§六 F-13②）。
选同一版当基线与对照时**不改写、只提示**（"基线与对照选的是同一版"）。

### 4.8 馆务台账：媒体三方对账与安全日志聚合

`/ops`（`OpsView.vue`，模块注册表 `ops` 项，需登录）把两件"只能从运维视角看"的东西并到一页。

**媒体对账**（`store/mediaInventory.js`）取三个来源做交集：磁盘 `server/data/media/`、`media-index.json`、在档引用
（档案正文与材料源里出现过的 `/api/media/<id>`）。输出四类：
`used`（三方一致）、`unreferenced`（索引里有、没人引用）、`orphanFiles`（磁盘上有、索引里没有，带 `sha256` 与
识别出的 MIME）、`staleIndex`（索引说有、磁盘没了 = 死链）。**死链单独一列**是刻意的：
它说明"档案里还有指向不存在文件的引用"，修法不是删文件而是回头补图。
`POST /api/ops/media-gc` **默认预演**（一个字节都不动，只回"将要删什么"），要 `confirm:true` 且**逐个点名** `ids`/`files` 才真删；
删除前二次校验：越界路径（不在 media 目录内）、非本站写出的扩展名、仍被在档引用者——三种一律拒绝并说明理由。
**没有"一键清空"**：孤儿文件多为误删档案所致，全删的代价不对称。

**日志聚合**（`security/logInsight.js`）读同一份 `security.log`（JSONL，5MB 封顶、轮 5 份），
按 `event` / `ip` / `user` / 关键字过滤，给出 `totals`、`byEvent`、`byIp`、`byUser`、`byDay`、`recent`，
以及一组**信号**（`SIGNAL_EVENTS`：`login-denied`/`login-locked`/`csrf-denied`/`denied-*`/`honeypot-hit`/
`media-reject`/`library-unlock-denied`/`library-unlock-locked`/`library-scope-denied`/`library-preview-denied`/
`library-asset-mismatch`/`sign-tampered`）。聚合口径固定，所以自研约 150 行即可，**不为此引第三方日志栈**
（候选与许可实测见 §三 3.4）。

**给外部采集器留的口子**（将来真要接现成栈时按这条走，不改业务代码）：
`audit()` 只有一处写点，事件名 + 结构化字段（`{ts, event, ip, user, path, method, ...细节}`）已是稳定契约；
把 `appendFileSync` 换成 transport（或让 Filebeat/Vector 直接采 `security.log`）不影响任何调用方。
本轮选择"稳定契约 + 自研读侧"，而不是"现在就上一个 AGPL 的服务端"。

**审计补录**（同一轮做的）：CSRF 拒绝、无会话脚本型 UA 拦截（按 IP 60 秒去重、Map 上限 2000 条）都进日志；
`audit.rotate()` 修掉了"轮转会覆盖已存在的 `.1`"的缺陷（旧逻辑一步就把 `.1` 冲掉，等于丢掉最近一轮）。

### 4.9 全站版本台账总表（跨档案的核查视角）

§4.7 的 `/post/:id/revisions` 是**逐档**视角：进某一档、选两版、看差异。但运维真正要盯的是
**全站口径**——"到底存了多少版、`revisions.json` 会不会长成大文件、哪些档案已撤但历史还在册"。
这一层原来是缺的：只能一档一档点进去数。补法是**不新造存储，只在既有 `revisions.json` 上加一个聚合读端**。

- **端点** `GET /api/ops/revisions?limit&post&kind`（`routes/ops.js`，`requireAuth` + `no-store`）。
  与逐档端点分开放在 `/ops` 前缀下，是因为它和媒体对账、日志聚合同属"运维视角"，也复用同一道登录门。
- **聚合** `revisions.ledger()`（`store/revisions.js`）返回三块：`items`（流水，最新在前，`limit` 夹在 1..500，
  超了给 `truncated`）、`posts`（按档案汇总：版本数、占用字节、最新一版时刻、标题）、`totals`
  （`entries`/`matched`/`posts`/`bytes`/`keep`/`orphanPosts`）。**流水行沿用 §4.7 的口径：只给表头 + 每版快照的
  序列化字节数，绝不回快照正文**（`sweep` 断住 `snapshot`/`exp=`/`sig=` 不出现在响应里）。
- **记忆化按数据代次失效**：台账体积要逐条 `Buffer.byteLength(JSON.stringify(snapshot))`，全量重算在档案多时不便宜，
  所以缓存槽 `ledgerCache` 记一个 `store.generation('revisions')`；**代次没变就复用，变了才重算**（与 §六 B-10
  的 MiniSearch 派生缓存同一套机制）。这样"带外改了 `revisions.json`"也能被下一次读感知，而不是读到旧缓存——
  sweep 里"再写一版后台账口径即时跟上"就是断这条。
- **撤档仍在册要显式标注**：`ops.js` 用 `posts.all()` 求出在档 id 集合，给每行打 `alive`，并补 `totals.orphanPosts`。
  这是 §七 R-14"删档不抹历史"的**可视化落点**：页面把 `alive:false` 的行标灰、写「（已撤档）」，
  运维一眼能看出"台账里这些版本对应的档案已经没了"，涉及"依法删除"类请求时不会漏掉 `revisions.json`。
- **前端** `LedgerView.vue`（`/ledger`，模块注册表 `ledger` 项，需登录）三个 pane：台账口径五分栏 / 版本流水（可按档案、
  按动作筛选，可清空，行链跳该档 `/post/:id/revisions`）/ 按档案汇总（达保留上限的行标「已到保留上限」，在档才给「看档案」链接）。
  与 `/ops` 分开建页而非塞进同一页，是因为两者信息所有权不同：`/ops` 管"文件与日志"，`/ledger` 管"版本与体积"。

**为什么不并进 `/ops`**：曾考虑加个 tab，但 `/ops` 已经有媒体对账 + 日志聚合两块重表格，再叠一块版本流水会让
窄屏横向溢出判定和"哪块在读"的 `aria-busy` 归属都变糊。分成两页后，各自 `aria-label` 清晰、窄屏各自验溢出（§八走查）。

---

### 4.10 Windows 桌面仪表盘（不新增依赖的图形起停）

需求是"安装后可开机自启或 exe 启动的仪表盘，启动时每次都要 GUI 填端口，并协助检查/安装/更新运行环境"。

**选型按"先开源后自研"走过一遍，结论是自研且零依赖**（详见 §3.4.0 的方法）：
Electron 会往仓库里塞进上百 MB 依赖树并逼着重写许可台账（且其自带 Node/Chromium 与本机已装的重复）；
Python + Tkinter 等于引入第二个运行环境，用户机器上有 Python 与否还得再体检一次；
两者都要改 `pin-guard` 白名单。而 Windows **自带** .NET Framework 4.x 的 `csc.exe`
（`%WINDIR%\Microsoft.NET\Framework64\v4.0.30319`，本机实测存在），WinForms 直接写原生窗口，
产物 26 KB、零新增依赖、零许可台账变更。语言级别被编译器锁在 **C# 5**，
因此源码里不能有字符串插值、`?.`、`=>` 成员与 `nameof`（首轮编译就是靠真编译器把这些逼出来的，见 §九第 20 阶段）。

**两条需求本身冲突，必须挑一边。** "每次启动都要填端口"和"开机自启"不可能同时成立——开机时没人填。
交付口径：**手动启动一律空白必填**（不预填、不读配置，端口不合法时「启动站点」按钮 `Enabled=false`），
只有 `--autostart` 那条路允许沿用上次确认过的端口；**且首次开机若从未确认过端口，它不猜一个默认值**，
只把窗口打开等人填。这样"记住端口"不会被误读成"绕过了端口确认"。

**环境体检只代跑站点自己的步骤。** 六行（站点目录 / Node / pnpm / 依赖 / 前端产物 / 数据）逐项给结论；
`pnpm install`、`pnpm build`、`reseed` 这三个动作在仓库目录内、可重做，所以给按钮代跑；
而装 Node、装 pnpm 属于**往用户机器上装系统级软件**，只给「指引」按钮打开官方下载页，不静默安装、不提权。
这条边界不是保守：本机实测**没有 winget**，"自动安装"只剩"下载官方 msi 并替你点确认"一条路，
那不该由一个启动器替用户决定。

**不预置二进制进部署包。** 打包脚本 `dashboard/` 只带 `Dashboard.cs` 与三个 `.cmd`，
理由与 A-6 里"`api/` 必须每次现做"同源——预编译产物会带着改之前的旧快照被打包出去。
`install.cmd` 在目标机现编一次约 1 秒，成本可以忽略。

**撞到的两个真实缺陷**：LF-only 的 `.cmd` 被 cmd.exe 劈开执行（A-7，已用 `.gitattributes` 钉死 CRLF）；
以及验证界面时 UIA 对 WinForms 的抓手全不奏效（A-8），最后靠"读 `BoundingRectangle` 物理点击 +
用 `TextBox` 的 UIA `Name` 断言字段内容"完成实测。端口占用从"warn 后照样起"改成**直接拒绝**：
起了也只会立刻 `EADDRINUSE` 退出，用户看到的是"仪表盘点了没反应"，不如一句话说清"站点还活着，去开浏览器"。

---

### 4.11 Windows 一键安装包（`installer/`：环境 · 部署 · 自启 · 卸载）

4.10 交付的是"一台已经能跑的机器上的图形起停"，本轮要补的是**一台干净的机器**：
用户提的四条能力——① 一键监测/安装/更新运行环境，② 部署含仪表盘的完整程序且遵守"启动时向根目录导出口令.txt"，
③ 一键卸载，④ 一键部署开机自启。

**为什么不做成一个 exe，而是一组 `.cmd`**：`dashboard/` 已经有 C# 现编的图形面板了，
这一层的活儿是**编排系统工具**（`winget`、`robocopy`、`schtasks`、`reg`、`PowerShell`），
批处理是这些工具唯一在 Windows 10 与 Server 2019 上都零成本可用的胶水；
换成任何第三方 installer 框架都会立刻撞上"只收宽松许可"那条铁律（见 §3.4 的选型顺序）。
唯一的例外是**打开中文命名的口令文件**——那件事批处理做不到（A-9 第 4 条：cmd 按 OEM 代码页读脚本），
所以拆成 `creds.cmd`（薄壳，只传退出码）+ `creds.ps1`（按码点拼出文件名）。

**能力④的两条需求是分开实现的**（用户在 AskUserQuestion 里指定的口径："后端开机即起 + 仪表盘登录即起"）：

| 任务 | 触发 | 身份 | 为什么单独一条 |
| --- | --- | --- | --- |
| `BianwangSite` | `ONSTART` | `SYSTEM` / `rl highest` | Server 上做内网服务要"没人登录也可达"；这条**必须提权**才能注册 |
| `BianwangDashboard` | `ONLOGON` | 交互用户 | 图形界面只能活在有会话的时候；它先探端口，已 Serving 就退让，不会起第二个后端 |

**提权探测**用 `net session` 的退出码，而不是"试着建任务看会不会失败"——后者失败的原因可能是权限、
也可能是路径或任务名冲突，脚本给不出人话。非提权时 `setup.cmd` **警告并继续**跑完①②，
只有③这一步要求重开窗口，因为半权限注册出来的开机任务会在最需要它的时刻静默不跑。

**`run-site.cmd`（任务真正执行的脚本）的端口取值链**：`installer\port.txt` → 仪表盘的
`%LOCALAPPDATA%\Bianwang\dashboard.cfg` → **没有就拒绝启动并写日志**。
这是 §4.10 那条"不猜端口"的取舍在无人值守路径上的延伸，且比手动启动更要紧——
开机时没有人能纠正一个猜错的端口。取值之后先探一次端口，已有进程在服务就正常退（幂等，避免每次开机多留一个孤儿）。
后端按既有行为（§九 第 19 阶段加的口令速查文件）在首次启动时把 `口令.txt` 写到站点根目录，所以安装包**不设 `BW_DATA_DIR`**，
让根目录口径和源码运行保持一致；口令文件因此天然在部署产物之外，卸载连带删掉。

**能力③的口径是"全部删除，含 `api\data`"**（用户明确选择）：档案、图片、书库、口令 CSV 一起走，
所以它要求打出 `DELETE` 才动手，并先给一次"删前拷一份 `api\data`"的机会（只拷、从不删那份拷贝）。
实现细节与那条"自己删自己的脚本"的成因记在 **A-13**。

**三条边界从 §4.10 继承下来，没有放宽**：
① **不静默往机器上装软件**——检测免费，安装必须有 `/install` 开关且由 `setup.cmd` 问过才加；
winget 不存在（Server 2019 默认不带）或下载失败（代理/组策略/离线）时退回"打印官方地址并替你打开浏览器"，这条路仍然走得通，只是改由人点；
② **不信 PATH 报告的成功**——winget 装完直接去 `%ProgramFiles%\nodejs\node.exe` 找，因为新装的 Node 不在当前控制台的 PATH 里；
③ **包里不预置二进制**——`deploy.cmd` 拷完 `dashboard/` 源码后在目标机调 `build.cmd` 现编，与 A-6/A-11 同一条理由；
编不出来只警告，站点本身与 .NET 无关。
另外两条是本轮新加的防线：`deploy.cmd` 要求旁边就有 `api\src\index.js`（**拒绝在源码仓库里跑**，那里没有解析好的依赖），
并把 `api\data` 用 `/XD` 排除在拷贝之外——**`api\data` 只要站点跑过一次就是用户数据**，升级重部署绝不冲掉。

**实跑状态要如实分开记**（本机 Windows 11 专业版，ProductType 1，非服务器 SKU）：
① 环境——正常态 rc 0，另把版本闸门临时抬到 `>=99` 逼出"太旧"分支（rc 2）与"本机没有 winget"的退回指引（rc 3，实测确实只开网页不动系统）；
② 部署——真包解压到**仓库树外**后部署，robocopy 七个目录、目标机现编出 exe、起站后
`/` 回 200（1193 字节、含 `#app`）与 `/api/menu` 回 200（11 项）、`口令.txt` 确实落在**站点根**；
三条拒绝分支也各自跑过：源码仓库里跑 `deploy.cmd` → rc 1，包拷到自身 → rc 6，没有任何端口记录 → rc 2（**不猜端口**）；
③ 自启——`/status` 非提权可用；端口占用时 `run-site.cmd` 报"already serving"并 rc 0（幂等）；
**降级路径**（开机任务被拒 → 仍注册登录任务 → 直接拉起 → 探到端口 → rc 4）实跑通过；
④ 卸载——`/quiet` rc 0 且文件全留，`DELETE` 全删 rc 0 且自清 `%TEMP%` 副本，数据计数走 PowerShell 得 18 files / 0.1 MB；
`creds` 三态修正后为 存在 0 / 目录在但没文件 2 / 目录读不到 1。

**唯一仍未正面验证的是 `ONSTART` + `/ru SYSTEM` 注册成功那一条**：本机即便提权（`net session` 通过、
`whoami` 是管理员账户）也被任务计划程序拒绝授予 SYSTEM 身份（A-15），换真正的 Windows 10 / Server 2019 才能验（R-15）。
这轮补验本身抓到并修掉两个真 bug：`creds.cmd /root` 对读不到的目录打印 `[ok] found` 且返回 0（A-14），
以及开机任务被拒时把"本来还能成"的登录任务与起站一起放弃（A-15）。

#### 4.11.1 收成"一个 exe"：`BianwangInstaller.exe`（2026-10-01，**当日即被 §4.14 的离线包取代**）

> **这一小节记的是 WinForms 那一版**。它的交付形态已经下线（D-19）：装机机上多半既没有 `csc.exe` 也没有 Node.js，
> "双击现编"这一条前提站不住。所以下面的实跑数字是**历史证据**，不要当操作指引——现在的口径看 §4.14。
> **但这一版里定下、并且被离线包整条继承下来的东西没变**：四段（自检 / 安装 / 自启选择 / 维护）、
> 界面只做决策与呈现而 `.cmd` 引擎才是动手的那一份、自启为什么恰好三选一、"判'建成'要读回来"。

用户对口径的追加要求是：**一键安装包应当是一个完整的、带自检 / 安装 / 自启选择的 exe 程序**，
而不是一堆需要记住名字和顺序的 `.cmd`。形态见 **D-16**。落法是"一个界面 + 一层引擎"，不是重写：

- `Installer.cs`（WinForms，C# 5 级别，`build.cmd` 用系统自带 csc 现编）四段：**自检 / 安装 / 自启选择 / 维护**。
  它**不复制安装逻辑**，而是调 `env.cmd` / `deploy.cmd` / `autostart.cmd` / `uninstall.cmd` / `creds.cmd`，
  读回它们的退出码与输出。逻辑只有一份，界面点与命令行跑是同一条代码，不会两套各自演化。
- 同一个 exe 带脚本出口（`--selfcheck` / `--install` / `--autostart none|logon|boot` / `--live` / `--status` / `--report 文件`），
  给 SSH、无键盘的机器和自动化用；`--report` 落的是**带 BOM 的 UTF-8**，取证不靠猜控制台编码。
- `setup.cmd` 退化为**引导器**：没有 exe 就现编 → 用 `--ping` 确认真的能执行（最多 6 次、每次隔 2 秒）→ 开界面。
  重试不是洁癖：刚写出的无签名 exe 会被实时扫描短暂占住，本机两次实测到"拒绝访问"，等一下就通。
  没有 csc（.NET 组件被关）或不想开界面时，`setup.cmd /cli` 就是原来的线性四步。

**自启为什么恰好是三选一**，因为背后只有三个真实可用的机制（多给一个选项就是骗人）：
`none` 不注册；`logon` 写 `HKCU\...\Run` → `BianwangDashboard.exe --autostart`（**免管理员**）；
`boot` 计划任务 `ONSTART`/`SYSTEM`（要管理员，且客户端 SKU 可能被策略拒 → 降级为 `logon` 并写明）。
"登录态为什么不建 `ONLOGON` 任务"是实测结论：**非提权时 `schtasks /create /sc onlogon` 也被拒**（与 A-15 同一条策略线，R-15 里补记）。
写完 Run 键之后**读回来核对**，不看"写函数返回成功"就算建成（A-14 的口径）。

**自检里最要紧的一条仍然是"真跑一次 import"**：探针写进 `api\` 里、由 `node` 真 `import` 那 11 个启动期包、再删掉，
并且要**祖先链上没有别的 `node_modules`** 才算"目录自足"。这一条本轮自己踩到两个假判据（A-17 里记），
都是"检查会撒谎"的同一类：把被测目录自己的 `node_modules` 算成祖先链、把安装器自己现编的 exe 算成"预置二进制"。

**实跑状态**（真包解压到仓库树外，祖先链无 `node_modules`，Windows 11 专业版非提权）：
自检十项判定与已知事实逐条对上（依赖真解析过 · 端口三态分开判 · 目标可写探针建在正确的祖先上）；
安装 rc 0 → **第二次安装（更新）rc 0**（此前会被 `deploy.cmd` 判成"自己拷自己"而 rc 6，见 A-17）；
自启三形态：`logon` 写键并读回 + 站点 HTTP 200 + `口令.txt` 落在**站根**、`none` 不注册且幂等、`boot` 未提权如实 rc 1；
`--live` rc 0；GUI 四段实点（`ClientToScreen` 定位 + 键盘 Ctrl+Tab 也能走完四段，键盘可达性顺带验了）、
维护段"只停服务与自启"确实撤掉 Run 键并停站而文件全留。
**仍未验证**：`boot` 在提权且策略允许的机器上注册成功那一条（R-15）。

### 4.12 全局访问协议：HTTP / HTTPS 选一档（默认 HTTP）

需求（R23）："仪表盘程序中还应可以选择该项目**全局**的网络访问协议是 HTTP 还是 HTTPS"。
"全局"这两个字是这件功能的难点所在——**一个只在界面上改字的地方不叫全局**。所以它的落点是四层的：

| 层 | 落点 | 这一层真的变了什么 |
| --- | --- | --- |
| 选择与呈现 | `dashboard/Dashboard.cs` 第一栏「访问协议」两个单选 + 「TLS 由谁终结」两个单选 + 证书框 + 「生成本机自签证书」按钮 | 状态行、`在浏览器打开`、端口占用提示三处 URL 全部由 `SiteUrl()` 组装，不再有第二处写死 `http://` |
| 持久 | `%LOCALAPPDATA%\Bianwang\dashboard.cfg` 的 `scheme` / `tls_from` / `tls_pfx`（与 `port` 同处一份） | 存成 key=value 全量重写，**认不出的键也保留**——别的脚本往里写过的东西不该被界面一次保存抹掉 |
| 无头执行 | `installer/run-site.cmd` 读同一份 cfg：`https`+`node`+证书在 → 给 node 设 `BW_TLS_PFX`；`https`+`nginx` → 后端仍明文只听回环；`https`+证书不在 → **退出码 4 拒绝起站** | 开机自启那条路上没人能点界面，所以判据必须能脱离界面成立 |
| 监听本身 | `server/src/index.js`：`resolveTls()` 决定 `http.createServer` 还是 `https.createServer`；`config.js` 收 `BW_TLS_PFX[_PASS]` / `BW_TLS_KEY`+`BW_TLS_CERT` | 证书读不到就 `process.exit(1)` 并说明缺哪一样，**不退回明文**。`口令.txt` 与启动日志印的协议跟着真实监听走 |

**默认必须是 HTTP**（用户交代：生产环境暂时拿不到 SSL 证书）。这条决定了三件事的取向：
不给证书时一切照旧（`resolveTls()` 返回 http、`run-site.cmd` 不设 TLS 环境变量、界面默认选中的就是 HTTP）；
`nginx/bianwang.conf` 那份"80 一律 301 到 https"的形态**不能是唯一的选项**，于是加了 `nginx/bianwang-http.conf`
（防护齐、去掉 TLS 与 HSTS——HSTS 故意不发，它一旦发布就很难撤回）；
以及会话 cookie 的 `Secure` 不能再按 `NODE_ENV` 硬加，见 A-20。

**"TLS 由谁终结"这个子选择不是装饰**。同一句"我要 HTTPS"在两种拓扑里意思不同：
Windows 单机没有 Nginx，只有后端自己持证书才真的加密；有 Nginx 的生产机，后端就该继续只听回环明文，
让证书留在边缘。两档都给，并且**各自写清自己不管什么**：选 Nginx 时界面与安装器都明说
"本程序不校验 Nginx 是否配好、证书是否有效"，不假装看得见别人那一侧。

**自签证书只用系统自带能力**（选型铁律的顺序：先找现成 → 这里现成的是 Windows 自带的 `New-SelfSignedCertificate`
+ `Export-PfxCertificate`，因此**不需要**引入 node-forge / selfsigned 这类包，许可台账一字不改）。
实测本机非管理员可成：签在 `Cert:\CurrentUser\My`，SAN 含 `localhost`、计算机名与监听地址，一年期，
导出 2,742 字节 pfx（空口令，私钥边界＝NTFS 权限，这一点写进对话框）。
点按钮前那次 MessageBox 是内容的一部分：自签＝浏览器告警、只适合内网/自用、正式站点请换域名证书或交给 Nginx。

**实跑状态**（Windows 11 专业版，非提权；`--autostart` 路径直接触发起站逻辑，不靠点击）：

| 用例 | 结果 |
| --- | --- |
| HTTP 默认档 | `http://127.0.0.1:18901/api/menu` 200，同一端口按 https 访问 `EPROTO`（证明它确实是明文，不是"看起来像"） |
| HTTPS + 本机后端（证书在） | `https://127.0.0.1:18912/api/menu` 200（710B）、`https://…/` 200 且回的是 `index.html`（1117B，整站在 TLS 后面可用）；同一端口按 http 访问 `ECONNRESET` |
| 按真实信任链访问 | `rejected: DEPTH_ZERO_SELF_SIGNED_CERT` —— 界面上那句"浏览器会先告警"是实测结论，不是免责装饰 |
| HTTPS + 前置 Nginx | 后端仍按明文 HTTP 起（200），日志与界面都写明"443 与证书归 Nginx，本程序不校验" |
| HTTPS + 证书不在 | 仪表盘**不起站**并打印三条出路（本机截图 `gui-A-nocert.png` 随会话内的取证目录一起清掉了，2026-10-01 你定的清理；事实以本行与 §4.12 那段拒绝口径为准，换机复核时按同样配置再点一次就能重现这个界面）；`run-site.cmd` 同样拒绝、退出码 4、端口无人监听 |
| 安装器自检「访问协议」项 | 四态各给各的结论（提示/提示/通过含到期日/失败含拒绝起站的预告），报告为带 BOM 的 UTF-8 |
| 站点跑起来时 | 协议控件整排置灰：中途改协议会让界面显示 https 而进程还在明文听，那比不给开关更糟 |

**仍未验证 / 已知限制**：① 证书路径含中文时 `run-site.cmd`（cmd 按 OEM 码页读配置）读不到——界面会警告，
但没有替用户改成 ASCII 路径；② `--autostart` 沿用协议这条链只验到"起站正确"，没做**重启后**的实机确认（与 R-15 同一台机器差异）；
③ 浏览器里点「在浏览器打开」看告警页的样子没截图（自签告警是浏览器行为，已用信任链拒绝测过等价事实）。

### 4.13 两种包形态：零 exe 与"预置安装器 exe"（**已下线，见 §4.14**）

> **这一小节整节是历史**：2026-10-01 当天用户就改口成"离线完整安装包 + 源码"两种资产，两种 zip 全部停止交付（D-19）。
> `--with-exe` 这个开关已经从 `make-nginx-package.mjs` 里**删掉**（不是留着兼容——它会指向已退役的 `Installer.cs`，
> 留着等于让下一次出包去编一个不再交付的东西）。站点树本身还在：它是离线包的输入，也是 Linux / Nginx 路线的产物。
> 下面那张"两种形态"的表与九步实跑，读的时候当作"当时为什么那样取舍"，不当作操作指引。

需求（R24）："提供一键安装压缩包（**包括 installer exe 文件**和需要用 installer 部署的源码）"。
这与 D-15/A-6 立的"不预置二进制"是有张力的，所以处理方式是**加一档、不推翻原档**：

| 形态 | 产物名 | 生成命令 | 包里有什么 exe | 什么时候用它 |
| --- | --- | --- | --- | --- |
| 默认（原样保留） | `bianwang-<版本>-nginx.zip` | `node scripts/make-nginx-package.mjs --write --zip` | **零** | 目标机有 `csc.exe`、允许双击后等一次编译 |
| 含安装器 | `bianwang-<版本>-installer-win.zip` | 上一条命令加 `--with-exe` | 有且仅有 `installer\BianwangInstaller.exe` | 目标机没有/关掉了 .NET 组件、被实时扫描拦刚编出的 exe（A-16）、或就要"解压即双击" |

三条不让这一步变成"随便发个二进制"的约束：

1. **exe 必须本次现编**。`--with-exe` 先跑 `installer\build.cmd`（同包那份 `Installer.cs`），编不出来就**拒绝出包**——
   而不是抓一份本机遗留的 exe 塞进去。这正是 A-6 当年冻结旧快照的同一件事，只是换了方向。
2. **摘要要能验，而且要验得到**。exe 的 sha256 写进 `installer\EXE-SHA256.txt`，同时**必须出现在 `SHA256SUMS.txt`**（A-21 修的就是这点：
   `walk()` 按"运行态"口径过滤 `.exe`，结果唯一的制品恰恰不在校验清单里）。安装器自检会**重算并比对**：
   一致 → 通过；缺摘要 → 警告；不一致 → **失败**并直说"这个包可能被替换过"。
   **摘要只能"包内自证"，不能拿上一轮的数字当基准**（A-23：`csc.exe` 不保证逐字节可复现，同一份源码两次编出 `f7b5101f…` 与 `fb5942bb…`）。
   所以任何"这个 exe 和文档里写的不一样"的核对，比的必须是**同一个包内**的三处（文件本体 / `EXE-SHA256.txt` / `SHA256SUMS.txt`），
   而不是跨包比数字。
3. **只多这一个文件**。仪表盘仍然目标机现编（`deploy.cmd` 调 `dashboard\build.cmd`），出现第二个 exe 就红。
   两种形态除这一个文件外内容与闸门完全相同。

**实跑**（解压到仓库树外，全程用**包里那个 exe**，不是本机另编的；`--target` 只给一次）：

| 步 | 结果 |
| --- | --- |
| 摘要三方一致 | `EXE-SHA256.txt` = `SHA256SUMS.txt` = 实际文件（九步实跑用的那份包是 `fb5942bb…`，53,248 字节；它之前一次出包、同一份源码编出的是 `f7b5101f…`，成因见 A-23。**这两个数字都不构成"基准值"**——本文档所在的包里的 exe 又是另一次编译的产物，核对只在包内三处之间做） |
| `--ping` | 0（解压出来的 exe 可直接执行，无需等实时扫描） |
| `--selfcheck --report` | rc 0；「部署包完整性」判**通过**并写明"预置安装器与随包摘要一致（未签名）"；「访问协议」按 cfg 给默认档结论 |
| `--install --target <临时目录> --port 18931` | rc 0；`api\src\index.js` 就位、`dashboard\BianwangDashboard.exe` 在目标机现编出来、落点记进 `installer\target.txt` |
| `--autostart logon`（**不带** `--target`） | rc 0；用的是记下来的落点（A-22 修的就是这件事），HKCU Run 值读回存在 |
| `--live` | rc 0，`/api/menu` 200 |
| 把 cfg 改成 `scheme=https`（无证书）后再 `--live` | rc 4「没有应答」——证明探针跟着记录的协议走，而不是永远写死 http |
| 改回 `scheme=http` 后 `--live` | rc 0 |
| 独立探针 | `http://127.0.0.1:18931/api/menu` 200、同端口 https 访问 `EPROTO`；`口令.txt` 落在**目标根**（不在包根） |

未验：这台机器上没法验"SmartScreen 首次拦截"的完整体验（本机已跑过多次同类 exe）。但**"杀软处置"这一条本轮真撞上了**：03:4x 那份在 `%TEMP%` 下跑通九步，10:5x 之后同样位置同样源码编出的那份**一执行就消失**，见 A-24 与 R-17——所以这份表格写的是"03:4x 那一次的结果"，不要当成长期保证。

### 4.14 离线完整安装包：一个 exe 两个身份（2026-10-01，当前形态）

需求（R25）："**以 Windows 10、Windows Server 2019 为主要生产环境**，用 Electron 将一键安装所需 exe 文件、源码打包在一起，**类似 MySQL，合成为一个离线完整安装包**"。
同轮确认的三个决定：Electron **完全替换** WinForms 安装器；后端**就跑在 Electron 内建的 Node 上**（不是再装一个 Node）；形态是**单个自解压 .exe**。旧的两种 zip 因此全部下线。

**为什么这一版值得推翻 D-16/D-18**：那两档各自预设了装机机上有一个它通常没有的东西——`csc.exe`（.NET 组件可能被关）或 Node.js（内网机器根本不让联网装）。
MySQL 的离线安装器之所以是"那一个 exe"，就是因为它把**运行时 itself** 装进去了。本站照抄这个思路，代价写在 R-18（26 MB → 171 MB）。

**一个 exe 两个身份**（本轮最要紧的实测结论，也是版本号是硬约束的原因）：

| 怎么起它 | 它是什么 | 谁在用 |
| --- | --- | --- |
| 带 `ELECTRON_RUN_AS_NODE=1` | **Node 24.21.0**（Chromium 152.0.7977.130 / V8 15.2.124.28），行为与 `node 脚本 参数` 一致 | `run-site.cmd` 起后端、`deploy.cmd /inplace` 播种、仪表盘的依赖探针与起站 |
| 直接双击 | `resources\app` ＝ 四段图形安装器（自检 / 安装 / 自启选择 / 维护） | 你，以及 NSIS 装完那一步 |

`runtime\BianwangRuntime.exe` 就是 Electron 44.5.1 的 `electron.exe` 改名（出包时顺手删掉 `resources\default_app.asar`，否则不带 `ELECTRON_RUN_AS_NODE` 双击会起一个演示窗口而不是我们的安装器）。**版本是承重的**：Electron 33.4.11 内建 Node 20.18.3，**低于本项目 `engines` 的 ≥ 20.19.0**，选了它等于交付一个自己不合格的运行室（A-27）。出包脚本因此**不装 `electron` / `electron-packager` / `electron-builder` 任何一个 npm 包**——只按校验值取官方 Windows x64 运行包（后者还会拖进 `7zip-bin`，用户明确要避开 7z 二进制）。

**运行时判定只有一处口径**，但必须写两遍才够——一遍给批处理、一遍给 JS，两边语义逐条对齐（这一条是"两份实现迟早漂"的已知风险，所以出包第三道闸比对的不是它，是依赖清单）：

| | 批处理侧 `installer\runtime.cmd` | JS 侧 `installer-app\core.cjs:resolveRuntime()` |
| --- | --- | --- |
| 顺序 | 随包 `runtime\BianwangRuntime.exe` → PATH 上的 `node` | 同 |
| 导出 | `BW_NODE` / `BW_RUNTIME_KIND` / `BW_RUNTIME_VER`，随包那一路 `export ELECTRON_RUN_AS_NODE=1` | 返回 `{exe, kind, ver, asNode}` |
| 拒绝 | 版本低于 20.19.0 → **rc 3**（不硬跑）；两个都没有 → rc 1 | 判"失败"并禁用安装按钮 |
| 实现要点 | **不做顶层 `setlocal`**：`call` 之后变量要留得住；逐段数字比较放在本地 `:compare` 里，用 `endlocal & set` 把结论导出来 | `PKG_ROOT` 从 `process.execPath` 反推（不是 `__dirname`，因为它住在 `runtime\resources\app` 里） |

六个引擎全部改接它：`setup.cmd`（不再现编任何东西，`/rebuild` 随之删掉）、`env.cmd`（随包时明写"运行时由包自己提供，**不需要装 Node.js**"）、`deploy.cmd`、`run-site.cmd`、`creds.cmd`、`uninstall.cmd`（进程过滤加了 `BianwangRuntime.exe`，否则卸不掉）。

**就地安装 `/inplace`**：NSIS 是"解到哪儿就装在哪儿"，所以 `deploy.cmd <目标> /inplace` 跳过 robocopy（400 MB 自己拷自己），只做三件事——核对内容、缺数据时用随包运行时跑一次 `api\scripts\reseed.js` 并删掉生成的 `.secret`、调 `dashboard\build.cmd` 现编仪表盘。拷贝路径仍然保留（目标 ≠ 包根时），此时 `runtime` 一并进拷贝目录清单。

**安装器界面**（`installer-app/`，Yan · archival · moderate，见 §二 与 `USAGE.md` §10）：`core.cjs`（运行时/引擎调用/探针/注册表回查）+ `audit.cjs`（十项自检）+ `actions.cjs`（安装/自启/起停/卸载）+ `main.cjs`/`preload.cjs`（IPC，单一实例锁）+ `ui/`。**`core.cjs` 里不许 `require('electron')`**——它同时也是"以 Node 身份跑"时要用那份逻辑，绑死 Electron 就起不了后端。批处理调用一律 `windowsVerbatimArguments: true`（A-28），输出**按整行 UTF-8 解、出现 U+FFFD 才退回 GBK**（`chcp` 前缀会把带空格的引号路径截断）。

**打包外壳用 NSIS 3.12**（zlib/libpng 许可，用户当场批准；**不是** Inno Setup——那要看它的许可证走向，也不是自研 zip 尾部拼 exe）。四条实测口径记在 A-29：`.nsi` 必须 **UTF-8 带 BOM**；LogicLib 没有 `!~`（只能 `!=`）；`makensis.exe` 得待在 `<root>\Bin\` 里才找得到自己的 `Stubs`；`OutFile` 是相对 **.nsi 所在目录**解析的，不是 cwd。`SetCompressor /SOLID zlib` **是许可问题不是性能问题**：bundle 的 COPYING 写明 LZMA 模块是 CPL-1.0、bzip2 是 bzip2 许可，换压缩器要重新批准（体积从 171 MB 可能压到 ~120 MB，但那不是我能自己定的取舍）。卸载器 `$INSTDIR\installer\uninstall-offline.exe` 先把自己拷进 `%TEMP%` 再删树（`uninstall.cmd` 同一条理由：cmd 逐行懒读，边删边读会把成功打成失败）。

**出包命令与闸门**：`pnpm package:offline` → 先复用 `make-nginx-package.mjs --write`（六道闸一条不少），再铺 `runtime\`，再加**三道**——外部二进制按 sha256＋字节数取用、交付物内 `.exe` 白名单（只 `runtime\`）、依赖探针清单三处同源（`installer\startup-imports.json` ↔ `installer-app\core.cjs` ↔ `dashboard\Dashboard.cs`）。

**实跑**（本机 Win11 专业版；**没跑真·双击**，那要过 UAC，留给你在目标机上做）：

| 步 | 结果 |
| --- | --- |
| 站点那半六道闸 | 通过：软链接 0 · 孤立自足性真起后端 + `/api/menu` 200 · `.cmd` CRLF+ASCII · 零 exe · 条目名 0 条 `\` / 0 条非 ASCII · 2448 个文件 |
| 外部二进制按校验值 | `electron-v44.5.1-win32-x64.zip` 157,998,329 B / `9b382492…d7db`、`nsis-bundle-3.12.tar.gz` 6,227,143 B / `fe36a357…feed` 两条**核对通过**（后者是 SourceForge 当日全 522 时改用的镜像，见 `THIRD_PARTY_NOTICES.md` §1.2） |
| 二进制白名单 | 1 个 `.exe`，在 `runtime\` 内（`runtime/BianwangRuntime.exe`）；`runtime\` 共 81 个文件 / 367.1 MB |
| 依赖清单三处同源 | 11 项一致（比对接受单双引号两种写法） |
| 随包运行时驱动引擎 | `runtime.cmd` 判成"随包"、Node 24.21.0；安装器审计**十项判定全对**；`deploy.cmd /inplace` 就地安装；`run-site.cmd` 起站；`/api/menu` **200**；`口令.txt` 落在站根 |
| 界面 | CDP 驱动：十项自检渲染齐、四段切换走得通、"实访"按钮 rc 0、**零页面异常**；截图与计算样式两处核对（Yan archival 契约，`pnpm audit:ui` 顺带过） |
| 部署后验收（**新增**，本轮补的洞） | 直接对出包暂存树跑 `ops-extras/verify-deploy.mjs`，后端由 `BianwangRuntime.exe`（`ELECTRON_RUN_AS_NODE=1`）起在 8899：只读 **26 项 0 失败**；加 `--mutate` 走写链路 **36 项 0 失败**（建档 201 → 修订 → 两版词级比对 → 置顶 → 删除自清 → 台账里留 `alive=false`）。INFO 1 项是 `/assets/` 的 `immutable`——只有经 Nginx 才成立，不是故障（F-15 那条口径） |
| 包内文本 ＝ 仓库文本（**出完之后回读一遍才算**） | 逐件比 sha256，**33 件全 SAME、差异 0**：后端四件（`index.js` / `config.js` / `security/middleware.js` / `security/media.js`）、五份 `docs/*.md`、九个 `.cmd` 引擎 + `startup-imports.json` + `offline.nsi`、`runtime\resources\app` 九件（`core` / `main` / `actions` / `audit` / `preload` / `package.json` / `ui` 三件）、`Dashboard.cs`、三份 nginx、`ops/verify-deploy.mjs`（这一步现在是 `scripts/check-package-parity.mjs` 而不是手工点验：本轮改动同时落在 `server/` 与 `installer-app/` 两侧，靠它确认交付树带着修好的中间件；不一致就退出 1）。这一步还抓到过"包内说明还是旧形态的假话"（A-31）。`grep -rln BianwangInstaller` 在整棵树里只剩**四处**：两份历史叙述（`docs/DEVELOPMENT.md`、`docs/README.md`，那是"上一轮怎么验的"的记录）与退役件自己（`installer\Installer.cs` + `build.cmd`）。**2026-10-01 问过要不要一并清掉，你选了留着**（所以它们继续随包；哪天要删，`Installer.cs` 与 `build.cmd` 都是 untracked，删了不可恢复） |
| NSIS | `makensis` 退出 0 **且产物存在**才搬进 `outputs\package\`；产物 **171.1 MB 量级**（本轮因包内文本改动重出过好几件，字节数就在 179.3–179.4 MB 之间浮动——包内任何一份文件变一个字节，外层摘要就变）。**本文不写"当前摘要＝某串十六进制"**：`docs/` 是打进包里的，把摘要写进 `DEVELOPMENT.md` 就等于"内容依赖自己算出来的值"，写完必须重出、重出后那句话立刻过期（本轮真绕了一遍，见 A-32）。权威值只看**当轮**的 `outputs\package\SHA256SUMS-offline.txt` 与 Release 说明那一行，核对只对那两处 |

> 这几件的差别**全在包内文本**：最早那件带着旧形态的假说明（A-31），后面几件改的是 `autostart.cmd` 的注释与本文件自己——代码一条没动，外层摘要照样每件不同。
> **所以本轮把收尾口径定死两条**：① 文档里不写当前摘要（写了就自指，A-32）；② **出包是一轮的最后一步**，出完之后任何文字改动都只进"下一件"。
> 核对只对**当轮**的 `SHA256SUMS-offline.txt` 与 Release 说明那一行，别拿上一轮的数字（A-23 同一条口径）。

**仍未验证**：① 真·双击过 UAC + SmartScreen 的完整体验（本机代跑不了提权）；② Win10 / Server 2019 **实机**——官方支持面只写 "Windows 10 and up"，而 Server Core 根本没有图形子系统（R-19）；③ `ONSTART`+`SYSTEM` 注册成功那条（R-15，本机提权也被客户端策略拒）；④ Server Core 上 Electron 以 Node 身份能不能起（与 ② 同一台机器差异，`USAGE.md` §10 已写退路：删 `runtime\` 换系统 Node）。

#### 4.14.1 收口这一轮：退役形态的口径清理（同日）

离线包出来后还有半件事没做完：**"让运维双击 `BianwangInstaller.exe`"这句话还在十几个地方活着**。逐条清的过程：

| 落点 | 原本写着 | 现在 |
| --- | --- | --- |
| `make-nginx-package.mjs` | `--with-exe` 整条支路（现编 WinForms 安装器、写 `EXE-SHA256.txt`、 exe 摘要并回清单） | **删掉**，不是留着兼容——它指向已退役的 `Installer.cs`，留着等于让下一次出包去编一个不再交付的东西。第五道闸收成一句"站点树零 `.exe`" |
| 包内 `README-FIRST.md` / `MANIFEST.md` | "双击 `setup.cmd`，它用 `csc.exe` 现编出安装器（本包不预置任何 exe）"；清单里没有 `runtime/` | 出包多一步 `rewriteDocs()`（A-31）：改成本包口径 ＋ 加 `runtime/` 行 ＋ 写明两半各由哪个摘要自证；**找不到那段旧文本就拒绝出包** |
| `installer\autostart.cmd` 四处注释与提示 | "由 `BianwangInstaller.exe` 第三段选出来"、"Run 键由 `BianwangInstaller.exe` 写" | 改成"安装器界面（`runtime\BianwangRuntime.exe`）"。改完重新量一遍：270 行全 CRLF、零高位字节（第四道闸校的就是这个） |
| `README` §一 目录树 / §七 / §九 · `USAGE` §10 全节 · `DEPLOY` §一 B 与 §六 | 九步实跑、三方摘要、`--selfcheck/--live/--autostart` 这些**已不存在的命令行动词** | 换成十项自检、`/inplace`、`runtime.cmd` 那一行；历史数字留在 `DEVELOPMENT` 并标"上一轮"，操作文档里一条不留 |
| `DEVELOPMENT` §4.11.1 / §4.13 / D-16 / D-18 / R-17 / §八 / §九 | 读起来像"当前形态" | 逐处加"已被 D-19 取代"的帽子并指回 §4.14；**纪实本身不删**（那些坑是这台机器上真撞过的），只把"照做"改成"当时" |

三个顺手改掉的真错（不是措辞）：① `USAGE` 写"`/cli` 不依赖任何 exe"——**错**，它仍以随包运行时当 Node，那也是个 exe；Core 上能不能起来本轮没实机验，文档改成"不行就删 `runtime\` 换系统 Node"。
② `USAGE` 的自检表里"祖先链无 `node_modules`"这条判据被我从界面那项里摘掉——它现在住在**出包的孤立自足性闸**里，界面上没有；留在原处就是让运维以为界面会验它。
③ §十 待办里"确认 `node` 在 `SYSTEM` 的 PATH 里"这条对离线包已经不成立（`run-site.cmd` 先解析随包运行时），只有删了 `runtime\` 才回到老问题。

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
| D-10 | 阅览比下载多一格"预览白名单"（`previewable`，默认关、登记时逐个勾选） | 全部在架书可阅览 / 全局开关 | "能取文件"不等于"能把正文摆到网页上"：架上书的权利状态不同，公开渲染的暴露面也大得多。代价是馆员要多点一次勾选，管理面与架上入口同步显示状态以免"看起来坏了" |
| D-11 | PDF 只取**文字层 + 书签**，不在服务端光栅化 | 客户端 pdf.js 渲染 / 服务端出图 | 服务端渲染把 CPU 与内存挂在一次 GET 上，且产出的位图不可检索；客户端渲染又要引入一整套 worker 与 CSP 放宽。代价（扫描件为空、版式不复现）写在 R-7 并在页面上明示 |
| D-12 | 版本台账存**完整快照**，只留最近 N 版 | 存 diff 补丁 / 无限留档 | 快照让"任选两版比对"成为 O(1) 取值而不是回放补丁链；体积风险改用"保留数 + 清单不带正文 + 按需拉两版"封顶（R-13） |
| D-13 | 日志聚合自研约 150 行，**不引第三方日志栈** | pino+pino-roll（MIT）/ Loki、Grafana、Tempo（AGPL-3.0）/ Graylog（NOASSERTION）/ Vector（MPL-2.0） | 许可实测与取舍逐条记在 §三 3.4；`audit()` 只有一个写点、事件名与字段已是稳定契约，将来换 transport 不动业务代码 |
| D-14 | 生产依赖全部精确 pin，并用 `pin-guard` 在 `prebuild` 挡人 | 保留 `^` 范围符 + lockfile | 交付物是"解压即上 Nginx"的包，重装拿到不同版本不可接受；CKEditor 与 pdfjs 都是"大版本换 API"的库（C-3、D-9）。守卫顺带核许可白名单与用途登记 |
| D-15 | **发布只给两种形态：一键安装包 + 源码**（release 不再摆裸 `web/dist` 压缩包与单个 exe） | 三种资产并存（部署包 + `nginx-html-webdist.zip` + `BianwangDashboard.exe`）/ 只发源码 | 部署包**已经**含仪表盘源码与 `installer/`，再单摆一个 exe 等于同一东西两个出处，还违背"不预置二进制"（A-6/A-11：预置产物会带着改之前的旧快照被分发出去）；`nginx-html-webdist.zip` 是"只要静态页"的第三种人设，而本站后端本来就读 `web/dist` 自伺服，拆出来反而诱导人只拷前端、得到一套没有接口的页面。两类各覆盖一种人：**要跑起来** → 一键安装包；**要读代码或自己构建** → 源码 |
| D-16 | **一键安装包的形态 = 一个 exe（`BianwangInstaller.exe`，目标机现编）+ 一层 `.cmd` 引擎**，`setup.cmd` 只做引导〔**形态已被 D-19 取代**：exe 不再目标机现编、界面改由 `installer-app/` 承担；但本条那条**不随形态变的原则仍然生效**——"界面只做决策与呈现、`.cmd` 引擎才是动手的那一份"〕 | ① 继续只给一串 `.cmd`（`setup` + 六个引擎，本轮再加 `build`）；② 把安装逻辑整体翻成 C#、删掉脚本；③ 直接发布一个编好的 exe | 用户明确要"一个完整的、带自检/安装/自启选择的 exe 程序"——这些脚本要记名字和顺序，不算"一个程序"。但**不因此重写安装逻辑**：那六个 `.cmd` 本轮已实测过分支与拒绝路径（A-12~A-15 全是它们身上抓出来的），翻成 C# 等于把验证过的东西换成没验证过的东西，还会把批处理六条语法定律的坑再踩一遍。所以 exe 做**决策与呈现**（自检判定、三选一的降级、回查核对），脚本做**动手**（robocopy / schtasks / reg / node），退出码与输出回传界面。③ 违反 D-15/A-6 同一条理由；① 不满足需求。代价是双击路径上多一次编译，用 `--ping` 重试吸收掉（A-16） |
| D-17 | **访问协议 = 界面选档 + 三层跟随**（`dashboard.cfg` 是唯一事实源，后端 / `run-site.cmd` / 安装器都从它取值），并且**缺证书时选择拒绝启动而不是退回明文** | ① 只改界面显示与"打开站点"的链接（不做后端 TLS）；② 只做后端 TLS，不給"前置 Nginx"档；③ 只支持 Nginx 终结，本机不持证书；④ 引入 `selfsigned` / `node-forge` 之类包来出证书 | 需求写的是"**全局**的网络访问协议"，所以判据是"有没有第二处还写死 `http://`"——只改显示就是假开关（① 出局）。② 与 ③ 各自只覆盖一种拓扑：Windows 单机没有 Nginx，不给后端 TLS 就等于 HTTPS 这一档在这台机器上根本用不了；而有 Nginx 的生产机让 node 自签反而多一份私钥落点，两档都给才诚实。**拒绝退回明文**这条是取舍的核心：静默降级会让操作员以为链路已加密，比不起来更糟（同一判据也写进 `run-site.cmd` 的 rc 4）。④ 违反"先找现成、且只收宽松许可"的顺序里更前面的那条——Windows 自带的 `New-SelfSignedCertificate` 就能成，不必给仓库添一个私钥库 |
| D-18 | **交付分两种包形态**：`bianwang-<版本>-nginx.zip`（零 exe，维持 D-15/A-6）与 `bianwang-<版本>-installer-win.zip`（含本次现编的安装器 exe + 随包摘要） | ① 直接改成"永远预置 exe"、把零 exe 闸门废掉；② 拒绝含 exe，只讲道理让用户自己编；③ 含 exe 但允许从本机抓一份现成的塞进去 | 用户明确要"包括 installer exe 文件"的包（R24），而 D-15 的理由仍然成立——**目标机现编**防的是"把改动之前的快照当制品分发"（A-6/A-11 就是这么发生的）。所以不推翻原档、只加一档：① 废掉闸门等于把 A-6 的教训丢掉，而且零 exe 那份对"必须有 csc 才装"的机器才是主路；② 是不尊重需求；③ 最危险——本机那份 exe 来历、新旧、是否被改过都不确定。③ 的替代做法是**出包时强制现编**（编不出来就拒绝出包），并让摘要进 `SHA256SUMS.txt`、由安装器自检重算比对，于是"预置"仍然可追溯到源码。代价：多一个未签名二进制的分发面（R-17），以及两条出包路径都要各自验一遍 |

| D-19 | **交付收成一个离线完整安装包**：`bianwang-<版本>-offline-win.exe`（NSIS 自解压）里装「站点 + 随带运行时 + 图形安装器」，运行时与安装器**共用同一个 Electron 可执行文件**（`runtime\BianwangRuntime.exe`：带 `ELECTRON_RUN_AS_NODE=1` 是 Node 24.21.0，不带就是四段界面）；WinForms 安装器退役，`.cmd` 引擎仍是唯一的逻辑 owner | ① 维持 D-18 两种 zip（要嘛目标机有 `csc.exe`，要嘛预置一个未签名小 exe）；② 用 `electron-builder`/`electron-packager` 出包；③ 安装器与站点运行时**各带一份** Electron；④ 自研一个"zip 尾部拼 exe"的自解压壳 | 用户指定（针对 Win10 / Server 2019 生产环境，"类似 MySQL 的离线完整安装包"）。① 的两种形态各自留了一个装机机做不到的前提（没有 .NET 组件 / 杀软拦刚解出的 exe），而装机机多半**也没有 Node.js**——D-18 完全没解决这一条，本轮才解决。② 会拖进 `7zip-bin`（用户明确要避开 7z 二进制）与一整条 npm 依赖链，还会动到 `pin-guard` 的许可台账；本轮改为"官方 zip 按 sha256 取用 + 自己拷改名 + 系统 `tar.exe` 解压"，npm 依赖一个不加。③ 体积直接翻倍（Electron 解包 368 MB / 份），而"同一个 exe 两个身份"是零成本的：`ELECTRON_RUN_AS_NODE` 是官方支持的入口。④ 自己造自解压格式等于把 A-25 那类"只在生它的那台机器上解得开"的风险请回来，而且 NSIS 本身就是 zlib 许可、正合规矩。代价：交付物从 26 MB 涨到 171 MB（R-18），以及 Electron 在 Win10/Server 2019 实机未验（R-19） |

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
- **A-6 单页兜底 `res.sendFile(绝对路径)` 会把部署目录当 dotfile 判 404**（真实缺陷，打部署包做"解压回环"时才撞到）：
  把解压出来的包放到任何**以点开头的目录**（`.scratch-*`、`.httpdocs`、`.server`…）时，
  `GET /` 返回 `{"error":"server-error","message":"Not Found"}`，而 `/api/health` 与 `/assets/*.js` 全正常——
  看起来像"前端坏了"，其实是 `send` 把**整条绝对路径**按 `/` 切段做 dotfile 检查，
  `.xxx` 段命中默认 `dotfiles:'ignore'` → 直接 404（`express.static` 不受影响，因为它检查的是相对 root 的路径）。
  修法：`res.sendFile('index.html', { root: DIST })`——把目录交给 `root`，被检查的只剩 `index.html` 一段。
  教训：**"绝对路径参数"不等于"更安全"**，同一个 API 在 `static` 与 `sendFile` 两条路上的检查口径不一样；
  以及：交付包必须做**解压后异地启动**的回环测试，只在原目录跑通的包不算通过。
- **A-7 LF-only 的 `.cmd` 会被 cmd.exe 逐行吃掉行首字符**（真实缺陷，做 Windows 仪表盘时撞到）：
  编辑工具默认写 LF，`uninstall.cmd` 在真 cmd 下跑出 `'local' 不是内部或外部命令`、`'lse'`、`'cho'` 这类碎片——
  也就是 `setlocal` 少了 `set`、`else` 少了 `e`、`echo` 少了 `e`，整脚本从中间劈开执行。
  同批的 `install.cmd` 当时"看起来正常"，只是它的结构恰好没踩到读取偏移，**不能当作没问题的证据**。
  修法：所有 `.cmd`/`.bat` 转成 CRLF，并加 `.gitattributes` 把口径钉死（`*.cmd text eol=crlf`、`*.sh text eol=lf`），
  否则换一台机 `git checkout` 又会拿回 LF 版本复发。
  教训：**Windows 批处理的换行符是正确性问题，不是风格问题**；而且"另一个脚本跑好了"不构成这一份的通过依据，
  每个交付脚本要各自实跑。
- **A-8 验证 WinForms 界面时，UIA 的常规抓手全都用不上**（写仪表盘自检时连撞三次）：
  WinForms 控件在 UI Automation 里 `ControlType` 一律报 **`Pane`**（不是 `Edit`/`Button`），按控件类型找元素会返回 0 个，
  必须按 `ClassName`（`WindowsForms10.EDIT.*` / `*.BUTTON.*`）找；`ValuePattern` 与 `InvokePattern`
  对 TextBox/Button **都不支持**（抛"不支持的模式"），所以既不能塞值也不能"点击"，只能读 `BoundingRectangle`
  拿真实坐标做物理点击 + `SendKeys`。而 `TextBox` 的**内容恰好会暴露成 UIA `Name`**，于是"填进去没有"这件事反而能直接断言。
  另一个坑：`SetForegroundWindow` 只在**第一次点击前**有效——后续点击若不再置顶，坐标会打到别的窗口上
  （实测把「停止」的点击打到桌面，误判成"停止功能坏了"，白查一轮代码）。
  教训：**自动化断言失败时先证明"点击确实落在了目标上"**，再怀疑被测程序。
- **A-9 仪表盘的中文乱码有四个独立来源，本机全过≠换机全过**（用户报"仪表盘乱码"后逐层排查）：
  1. **编译器猜编码**。`csc` 对**无 BOM** 的源文件按**机器 ANSI 代码页**猜编码，而 `Dashboard.cs` 里全是中文字面量，
     猜错就把乱码直接烤进 exe 的界面文案。修法：`build.cmd` 显式加 `/codepage:65001`，并给源文件补 UTF-8 BOM。
  2. **字族写死**。原来整份界面用 `new Font("Microsoft YaHei UI", …)`、日志框用 `Consolas`。
     这台机器恰好装了 YaHei UI 所以截图正常，但**同机没装 `Microsoft YaHei`、没装 `SimSun`、也没装 `Microsoft YaHei Mono`**——
     换一台没那个字族的 Windows，GDI+ 静默回退到无中文字形的字体，界面立刻变方块。
     而 `Consolas` 本来就**没有中文字形**，后端日志全是中文，能显示纯粹靠字体链接救急。
     修法：`ResolveUiFamily()` 按候选链探测本机实际装了哪个（雅黑→苹方→思源→黑体/宋体→韩文→日文→Segoe），
     全都没有才退回 `SystemFonts.DefaultFont`；日志框改用同一个已解析字族，**正确性优先于等宽**。
  3. **状态符号不是中文字体该有的字形**。`✓`/`✗`（U+2713/U+2717）在中文字体里常常缺字形，又是一处方块；
     而且读屏软件念不出"一个勾"是什么意思。改成 `正常`/`警告`/`缺失` 状态词，顺带把无障碍也补上了。
  4. **`.cmd` 里混进中文**。`uninstall.cmd` 有一行 `echo … 口令.txt …`，而 cmd.exe 按 **OEM 代码页**读批处理，
     UTF-8 的中文字节在 cp936 控制台上就是乱码——这还直接违反了该文件自己头部注释写的 "intentionally ASCII-only"。
     修法：把那一行改成 ASCII 描述（不点出中文文件名），四个 `.cmd` 全部复核为**零高位字节**。
  **取证口径上的教训更要紧**：控制台输出编码会骗人——同一次运行里 PowerShell 打出的中文看着是乱码，
  但那只是 stdout 的代码页问题，二进制里的字符串其实完好。最终是把 UIA 读到的界面文本**写进带 BOM 的 UTF-8 文件再回读**，
  才拿到"exe 里到底是什么"的地面真相。同理，`grep -P '[\x80-\xFF]'` 在本机 unibyte 环境下会**直接报错**，
  而 `|| echo 0` 把报错吞成了"0 行非 ASCII"，害我一度判定 `.cmd` 干净；改用 `tr -d '\0-\177' | wc -c` 数高位字节才抓到。
  教训：**判定"没有 X"的手段本身必须能抓到 X**——能报错的检查不等于会失败的检查。

- **A-10 "依赖就位"用目录存在来判断，是个假保证**（用户把 `server/`+`web/`+`dashboard/` 压到远程机起不来才暴露）：
  仪表盘的体检行原本只测 `Directory.Exists(root/node_modules)`，而 pnpm 的依赖农场在**仓库根**的
  `node_modules/.pnpm/` 里，`server/node_modules/express-rate-limit` 只是指向它的软链接。
  单拷 `server/` 时链接被解引用（包自身文件带过去了）、**兄弟依赖没带**，
  于是 Node 一路撑到 import 阶段才炸 `ERR_MODULE_NOT_FOUND: 'ip-address'`。
  更糟的是那一行 `Required=false`、`State` 最高只到"警告"，**不拦启动**，等于放一个必死进程出去再让用户看堆栈。
  修法：探针真跑一遍后端启动期的全部外部 import（11 个说明符），失败即 `Required=true` 并禁用启动按钮，
  同时按"有 server/node_modules 但没有根 .pnpm"这个指纹给出**具体成因与三条出路**。
  附带一个自己踩出来的坑：探针脚本一开始我写到 `%TEMP%` 里跑，结果**连完好安装都报"全部缺包"**——
  ESM 的裸模块名是按**发起 import 的文件位置**逐级向上找 `node_modules`，与进程 cwd 无关；
  必须把探针落在 `server/` 目录内（跑完即删，并加进 `.gitignore` 与打包 FORBIDDEN）。
  教训：**"能不能跑"只能靠真跑一次来判定**；目录在不在、文件多不多都是代理指标，代理指标在换机时最先失真。

- **A-11 部署包自己就是坏的：`pnpm deploy` 的默认链接器 + 复制时解引用，加上一个"在仓库树里验"的假通过**（A-10 的真正源头，公开发布后才被用户撞出来）：
  包里的 `api/node_modules` 是用**默认 isolated 链接器** deploy 出来、再被 `fs.cpSync(..., {dereference:true})` 压平的。
  deploy 产物里每个包只是**指向根农场的一条软链接**，解引用只把"那个包自己的文件"变成实体，
  它靠链接器布局才能找到的**兄弟依赖**（`express-rate-limit` 需要的 `ip-address`）压根没进包——
  而且 Node 要走到 **import 阶段**才报，所以文件的个数、体积、`require.resolve` 的静态检查全都好看。
  更要命的是**验收方法本身是错的**：解压回环跑在仓库树里的 `.scratch-*` 下，
  ESM 按**发起 import 的文件位置**逐级向上找 `node_modules`，仓库根那套完整的农场正好是它的祖先，
  于是**缺包被静默兜住、假通过**。换到用户机器上（`C:\...` 树里没有任何根 `node_modules`）才炸。
  修法（三条一起做，缺一条就会复发）：
  ① deploy 改成 `pnpm --filter server deploy --legacy --prod --config.node-linker=hoisted`，
  依赖**平铺成实体目录**（不加 `--legacy` 在 pnpm ≥10 直接 `ERR_PNPM_DEPLOY_NONINJECTED_WORKSPACE`）；
  ② 出包脚本加**两条硬校验**：包内 `api/node_modules` 软链接条数必须为 0；
  ③ 加**孤立自足性 gate**——把 `api/` 拷进 `%TEMP%` 下真起一次后端并请求 `/api/menu`，
  且 gate 在拷之前**先逐级扫祖先目录**，只要路上有 `node_modules` 就拒绝出包（否则又是在树里验，白验）。
  教训：**"验证环境比目标环境更宽容"的测试等于没有测试**；隔离性必须由测试自己去证明，而不是靠"我换了个目录"。

- **A-12 cmd.exe 批处理的六条语法定律，每条都是一次实跑换来的**（写 `installer/*.cmd` 时逐条撞上）：
  1. **括号块里 `echo` 未转义的 `(` `)`** 会让 cmd 打印"此时不应有 re-run。"并当场终止——
     它不是警告，是把整条部署流程停在编译仪表盘那一步。所有 `echo` 里的括号写成 `^(` `^)`。
  2. **`setlocal enabledelayedexpansion` 之下 `!` 是不可打印字符**。
     试过 `[!]`（打成 `[]`）、`[^!]`（打成 `[\]`）、`%BANG%`（空）、`!BANG!`（空）四条路，**没有任何转义能输出它**。
     12 处警告标记统一换成 `[-]`。
  3. **`shift` 会轮转 `%0`**，所以参数循环之后 `%~dp0` 不再是脚本目录，而是**最后一次 shift 掉的那个参数**——
     实测把 `creds.ps1` 解析成了 `C:\Program Files\Git\creds.ps1`。修法：脚本第 3 行先 `set "SELF=%~dp0"`，循环后一律用 `%SELF%`。
  4. **标签（`:label`）不能定义在括号块内**。端口校验那一段原来写在 `if (...)` 里，直接语法不通过；
     只能提到顶层做成 `:portask` / `:portknown` 两个入口。
  5. **PowerShell 的 `>` 写的是 UTF-16**，cmd 的 `set /p` 读回来是空串。
     凡是"让 PowerShell 把结论交给批处理"的地方，改成**用退出码传话**（`exit 0/1/10/11`），文件只留给 `robocopy` 之类自己读。
  6. **Git for Windows 的 `find.exe` 会抢掉 `find`**（`where find` 实测确认）。
     `dir | find /c /v ""` 在 PATH 前置 Git 的机器上拿到的是 GNU find 的胡话计数。
     需要统计时用 PowerShell（`@(Get-ChildItem -Recurse -File)` + `Measure-Object`），别用 `find`/`more` 这类同名冲突件。
  教训：**批处理没有"报错"，只有"行为不对"**——六条里有四条是静默产出错值继续往下跑。写完每个脚本要用真 cmd 跑，不能只看代码。

- **A-13 自己删自己的批处理读不到自己的后半段**（`uninstall.cmd` 首版"删成功了却报失败"）：
  cmd.exe 是**逐行懒读**磁盘上的脚本文本。脚本平时住在 `<site>\installer`，也就是它即将删掉的那棵树里——
  `rd /s /q` 成功之后，它的后续行所在文件已经没了，于是每条余下语句都打成"系统找不到指定的路径"，
  连"验证删除成功"那行都被吞掉，最终**返回码 1**。目录确实删干净了，报告却全是错。
  试过的两种"看起来能修"的写法都不行：把后续语句用 `&` 拼成一行**仍然会回去读盘**；
  用 `cmd /c` 起子进程删也不行——**父进程自己的 cwd 还在那棵树里**，Windows 拒绝删除有进程坐在其中的目录。
  最终形态：启动器把自身 `copy` 到 `%TEMP%`（树外），用 `start "" /wait` 交出删除与结论，
  并在交接前 `cd /d "%SYSTEMROOT%"` 跳出树；`/quiet` 那条**不删文件**，所以留在原地内联跑，好保留有意义的退出码。
  配套的两条判据修正：`del` 对**从未存在**的路径也报成功、`rd` 对**只删了一半**的树也报成功，
  所以结论一律改成 `if exist` 直接看（快捷方式先探在不在再宣布删除，卸载先判 `%ROOT%` 是否还在）。
  顺带一个反向坑：**提权检查不能挡住只读操作**——`autostart.cmd /status` 原来排在 `net session` 闸门之后，
  非管理员连"看现在注册了什么"都做不了；无害动作要提到闸门前面。
  教训：**删除类的结论只能由"再看一眼"得出**；一个住在被删对象内部的脚本，它的自述不可信。

- **A-14 "找不到就报错"的检查本身会撒谎**（`creds.cmd /root` 实跑时抓到）：
  两层叠在一起才成为 bug。① `powershell -File` **不会**剥掉参数上的引号，
  所以批处理传的 `-Root "C:\site"` 到 PowerShell 手里是字面量 `"C:\site"`（带引号），
  `Resolve-Path` 报"找不到路径"；② 更糟的是 `Resolve-Path` 失败是**非终止错误**，
  裸 `try { } catch { }` 抓不住它——红字打印完继续往下走，`$resolved` 还是 `$null`，
  于是 `Join-Path`/`Test-Path`/`Get-Item` 连着报四个"参数为空值"，脚本却一路走到
  `Write-Host '[ok] found'` 并 **exit 0**。一个读不到目录的调用，交回来的答案是"成功"。
  修法：`Resolve-Path -ErrorAction Stop`（让 catch 真的 catch）+ 显式判空 + 根目录改用**环境变量**过桥
  （`BW_SITE_ROOT`），因为环境变量不经过任何引号解析层。三态重新实测：存在 → rc 0、
  目录在但没有该文件 → rc 2、目录读不到 → rc 1。
  教训：**跨进程边界传值，"能报错"不等于"会被拦住"**；非终止错误 + 空值继续执行是 PowerShell 最常见的静默失败形状，
  而调用方只看退出码时，它伪装得和成功一模一样（与 F-13 同族：PASS 必须因真实原因通过）。

- **A-15 提权了也建不出 SYSTEM 任务，脚本却已经把整条自启判成失败**（补验 ONSTART 时撞到）：
  在 Windows 11 专业版（ProductType 1）上，即便 `net session` 通过（确认已提权），
  `schtasks /create /sc onstart /ru SYSTEM /rl highest` 仍然返回**拒绝访问**——
  客户端 SKU 的"作为批处理登录/作为服务登录"策略不让普通管理员令牌把任务切到 SYSTEM 身份，
  而任务计划程序不会说明是哪一条拦的。
  旧逻辑在这里直接 `exit /b 4`，于是**仪表盘那个登录任务也不注册了**，而且站点没起、
  操作员只看到一句"could not create the boot task"，分不清"你的自启全废了"和"只是开机那半废了"。
  修法：把失败降级成**分支而不是终点**——记下 `SITE_FAILED`，继续注册 ONLOGON 任务，
  然后**绕开调度器直接把站点拉起来**（`start "" /b`，因为 `run-site.cmd` 会占住控制台），
  再照旧探端口确认，最后才以 rc 4 退出。实测：`/port 16077` → 打印拒绝原因与"重启后不会自愈"的明示 →
  `[ok] site is up on http://127.0.0.1:16077`，`/api/menu` 与 `/` 都回 200，`口令.txt` 照样落在站点根。
  顺带把这条机器差异写进 `USAGE.md` §10.4（Server 2019 是 ProductType 2，那条路 normally 通，但**仍未实跑**）。
  同一轮补测：**非提权下 `schtasks /create /sc onlogon` 同样被拒**（还是那条"作为批处理登录"策略），
  所以"登录后自动起"这一档**不建任务**，改由安装器写 `HKCU\...\Run`（§4.11.1）；上面那句"继续注册 ONLOGON 任务"
  指的是提权窗口里 `boot` 档的降级分支，与"登录后自动起"是两回事，别混成一个机制。
  教训：**一项能力失败时，不要把还没失败的能力一起撤掉**；降级路径要把"还剩什么、缺什么"说清，
  否则用户只能靠猜来决定要不要换台机器。

- **A-16 被派生的站点会"扣住"调用方的 stdout 管道，于是一个跑得很好的站把安装过程卡到超时**（做图形安装器时撞到）：
  安装器用 `RedirectStandardOutput` 读 `autostart.cmd`，而 `autostart.cmd` 用 `start "" /b run-site.cmd` 起站点——
  那个孙进程**继承了同一根管道**，只要站点活着管道就不 EOF。于是 `Start-Process -Wait`、`cmd | findstr`、CI 步骤全部挂住，
  症状是"安装没报错但永远不返回"，看起来像安装器死锁，实际站点 HTTP 200 得好好的。
  四种写法逐一实测（`start /b "x.cmd"` / 加 `>nul` / `start /b cmd /c "…" >nul` / `start /min`），**全都留不住管道**。
  修法分两层：`autostart.cmd /site:none` 从此**只记端口、不负责起站**（起站交给安装器）；
  安装器用 ShellExecute（`UseShellExecute=true` + `WindowStyle=Hidden` + 显式 `cmd /c`）另起独立会话，再自己探端口给结论。
  顺带两个小坑：ShellExecute 直接把 `.cmd` 交给它会起一个**没有参数的交互 cmd**（打印提示符、不干活），必须显式 `cmd /c`；
  以及**刚编出来的无签名 exe 立刻执行会报"拒绝访问"**（实时扫描占住新文件，本机两次复现，等一下就通），
  所以 `setup.cmd` 在开界面之前用 `--ping` 重试 6 次而不是把这句话推给用户。
  教训：**"子进程继承句柄"是交付物里的隐形依赖**——凡是"我起一个长命进程"的地方，都要问一句"谁在等我这根管道"。

- **A-17 三条"会撒谎的检查"**（同一轮里一起抓出来的，都属于 F-18 那一类：PASS 不等于因真实原因 PASS）：
  ① **引擎脚本的工作目录**：安装器改成"装好后从 `<目标>\installer\` 跑脚本"之后，`deploy.cmd` 也跟着被从目标目录调用——
  而它认的"包根"就是自己的上一层，于是把**目标当成了包**，判"自己拷自己"rc 6，**第二次安装（更新）静默不装**。
  修法：`deploy.cmd` / `env.cmd` 恒定从包目录跑（它们的包根是自身上一层），其余引擎跟目标目录走。
  ② **依赖自足性判据把被测目录自己算进祖先链**：`NearestAncestorNodeModules` 从 `api\` 本身起步，
  于是每个健康的 `api\node_modules` 都让自己判红（"这条通过不足以证明自足"）。修法：从**上一层**起步。
  ③ **端口三态判反 + 把安装器自己算成"预置二进制"**：`bind 成功` 被当成"被占用"，
  而现编的 `BianwangInstaller.exe` 就躺在包内被自己的扫描判 Warn。修法：`PortBusy` 这个名字说清楚方向，
  扫描时排除当前 exe。三者共同点：**检查的措辞和检查的判据不是一回事**，
  每条 PASS 都要能指出"它红过一次吗、在什么条件下红"——本轮的三条都是靠"在真包上跑一遍看结论对不对"抓的，不是靠读代码。

- **A-18 出包压缩到一半被打断，会留下一个"看起来还在"的 0 字节包**：`Compress-Archive -Force` 是**先把目标文件截成 0 再写**的，
  所以中途取消 = 上一版可用的 zip 已经没了，而 `ls -l` 只告诉你文件在。判包可用不能只看它在不在，
  要 `unzip -t`（损坏包报 `End-of-central-directory signature not found`）＋`wc -c`＋`sha256sum` 三件一起看，
  再把包内五份文档 `unzip -p` 出来跟仓库 `diff`（本轮就是这么确认"包里的 docs 与仓库一致"的）。
  重跑 `node scripts/make-nginx-package.mjs --write --zip` 是安全的：它只写 `outputs/package/`，收尾的"工作区状态复位"是 `pnpm install`，不碰 git。

- **A-19 .NET 4.x 的探针会把一个健康的 HTTPS 站点判成"无应答"**（给安装器加协议感知时撞到）：
  `HttpWebRequest` 在 .NET Framework 4.x 上默认协议表里**没有 TLS 1.2**（只有 SSL3/TLS1.0），而 Node 20+ 只接受 TLS 1.2 以上；
  再加上自签证书过不了默认校验，两条叠加的结果是"站点 200 得好好的，探针拿到的却是握手失败"，
  而这条检查的措辞是"实访确认站点可达"——**它红的时候没人会怀疑检查自己**。
  修法两条一起给：显式 `ServicePointManager.SecurityProtocol = Tls12|Tls11|Tls`（写数值 `(SecurityProtocolType)3072` 而不是枚举名，
  这样只装了 4.0 的机器也编得过、跑得动），以及 `ServerCertificateValidationCallback` **只对 `127.0.0.1` / `::1` / `localhost` 放行**——
  公网地址上的证书问题仍然报红。判据要留在本机：这台机器上"证书是否公网可信"不是安装器能负责的事，
  但"回环上有没有站应答"是它可以确证的。
  教训：**加一种协议，就要顺带检查所有做网络判定的老代码是不是只认那一种**。

- **A-20 node 子进程的中文日志进 GUI 就变繁体乱码，是同一族乱码问题的第 5 个根因**（截图复核协议面板时抓到）：
  node 把 stdout 重定向到管道时按 **UTF-8** 写，而 `ProcessStartInfo` 不设 `StandardOutputEncoding` 时，
  .NET 用**本机 OEM 码页**（简体中文＝936）去解——于是"辨妄阁 API 已启动"变成"鑶版暚噬…"。
  这一条与前四条（csc 猜编码 / 字族写死 / `✓✗` 缺字形 / `.cmd` 里写中文）互相独立，
  本机截图正常**不代表**换机正常，也不代表同机上另一条路径没坏：这条只在"起站之后看后端输出"时才现形，
  而之前几轮的截图复核都停在协议面板以上，所以它一路活到了今天。
  修法是 `psi.StandardOutputEncoding = psi.StandardErrorEncoding = new UTF8Encoding(false)`，
  但**不能照抄到另一条子进程路径上**：`RunStep` 走的是 `cmd.exe /c pnpm …`，那边输出是 OEM 码页，
  统一设成 UTF-8 会把 pnpm 的中文进度反过来弄坏。教训：**编码声明属于"每一条进程边界"，不属于"这个程序"**——
  有几条边界就要各自判几次，而 GUI 里"看着没事"的那半屏不能替你证明另外半屏。

- **A-21 一条为"运行态"写的过滤规则，把唯一的交付物从校验清单里抹掉了**（出含 exe 的包时撞到）：
  `walk()` 按 `FORBIDDEN_PATTERNS` 跳过 `.exe`——这条规则是为"本机别把现编产物混进包"写的，完全正确；
  但 `--with-exe` 形态里那个 exe 是**制品**不是运行态，于是 `SHA256SUMS.txt` 唯独漏了它，
  `sha256sum -c` 恰好验不到唯一需要验的东西，而包看起来完整无缺。发现方式是安装器自检里那句
  "预置安装器与随包摘要一致"——它去 `SHA256SUMS.txt` 找那一行时拿到空值，判据当场露馅（F-18 同族：
  **检查通过的原因必须是真的比对过**）。修法：`--with-exe` 时把这个相对路径显式并回清单，并让自检同时比对
  `EXE-SHA256.txt` 与 `SHA256SUMS.txt` 两处摘要与实际文件。教训：一条按"文件名类别"写的黑名单，
  在引入"同名但是另一回事"的第二种形态时必须重新分档，不能靠加 `if` 打补丁。

- **A-22 命令行是分次敲的，落点不记住就会"装在 A、自启在 B"**（同一轮实跑抓到）：
  `--install --target D:\Sites\bw` 成功之后，再敲 `--autostart logon`（不带 `--target`）会退回默认值 `C:\Bianwang`，
  于是登录自启指向一个**根本没装过东西**的目录，报的是"仪表盘 exe 不存在"（rc 6）——
  症状像安装坏了，实际是两次调用没有共同记忆。修法与 `port.txt` 同构：安装成功后把落点写进
  `installer\target.txt`，取值顺序 **命令行 > target.txt > 默认**，并在安装日志里明写"落点已记在……"。
  教训：**同一套动词构成一个流程时，前一步的输入要有默认继承**；GUI 里这些值都在同一个窗口上，
  所以只有脚本出口会暴露这个缺口——这也是为什么 `--cli` 那条路必须自己跑一遍，不能只测界面。

- **A-23 系统自带的 `csc.exe` 不产出逐字节可复现的映像：同一份源码两次编出不同摘要**（重出含 exe 的包时撞到）：
  `Installer.cs` 一个字节没改（文件时间仍是 03:17:30），03:19 那次出包的 exe 是 `f7b5101f…`，
  03:35 再编得到 `fb5942bb…`。为了不把"大概是 MVID 随机"当结论，直接做一次对照实验：
  同一个 `Installer.cs`、同一支编译器（`Framework64\v4.0.30319\csc.exe`，FileVersion `4.8.9221.0`）、同一条命令行编两次——
  **体积一样（53,248 字节）、sha256 不同（`3584cfd4…` vs `195d5e54…`）、`ManifestModule.ModuleVersionId` 也不同**；
  而这支 csc **不认 `/deterministic`**（`fatal error CS2007: 无法识别的选项"/deterministic+"`），没有开关可掰。
  危险的地方在于**这条差异完全可以被误读成"包被替换过"**：文档里记着上一个数字，接收方拿新包一比就"对不上"。
  所以摘要的比对口径被明确成**包内三处自证**（文件本体 / `installer\EXE-SHA256.txt` / `SHA256SUMS.txt`），
  文档里的摘要一律写成"本轮重出的包为 …，上一轮同源码编出的那份是 …"，不写成单一基准。
  教训：**"可核对的摘要"不等于"可复现的构建"**——现编交付的形态下能做的只有把摘要绑定在**它所属的那个包**上，
  以及把"重编一次数字就变"这件事先写给接收方，否则第一次正常更新就会被当成篡改。

- **A-24 解压到 `%TEMP%` 的未签名 exe 被执行拦截并从磁盘上消失**（复验最终包时撞到，且**推翻了上一轮文档里"解压出来的这份可直接执行"那句话**）：
  `Expand-Archive` 解出来后 `Get-Item`/`Get-FileHash` 都正常（53,248 字节、`d4a1e61c…`、与 `EXE-SHA256.txt` 和 `SHA256SUMS.txt` 三方一致），
  但 `& $exe '--ping'` **一次都没有返回**，脚本后面的输出全空；再回看目录，exe 不见了，同目录其余文件都在，目录 mtime 正是那次执行的时刻。
  两次独立解压（`bw-exefinal-r7k2`、`bw-vanish-r7k2`）结果相同。对照三组事实把范围收窄到"**临时目录里执行**"这一条：
  ① 同样字节的这份在仓库树里（`installer\`、`outputs\package\…\installer\`）一直存在，`--ping` 与 `--selfcheck --report` 都 rc 0；
  ② Windows Defender 无查杀记录且其 Operational 日志为空（`Get-MpThreatDetection` 全空），注册的中心里 Defender 已是被动；
  ③ 本机跑着 `360Safe` / `360tray` / `ZhuDongFangYu`（360 安全卫士的主动防御）。
  **没有拿到的证据**：360 的隔离区日志我没有权限读，所以"命中哪一条规则"只能标注为推断，不写成结论（R-17 也照这个口径写）。
  教训：交付一个未签名 exe，"能跑"这句话**必须带环境限定**——上一轮我在本机 `%TEMP%` 下跑通过九步，本轮同一台机器同一份源码就不给跑，
  差别只在杀软的云端信誉变了。所以文档改写成"解压到常规目录再双击；被拦先核摘要再从杀软恢复；要零风险就用零 exe 形态"，
  并且把**默认交付形态继续保持为零 exe**（`bianwang-<版本>-nginx.zip`），含 exe 的包是给用户"目标机不想起编译"时的备选。

- **A-25 交付的 zip 只在 Windows 上解得开：条目名带 `\`，而且三本演示册的文件名是非 ASCII**（复验含 exe 的包时顺手量的）：
  `Compress-Archive`（PowerShell 5.1）写出的 2463 条条目**全部用 `\` 分隔、0 条用 `/`**，而 ZIP 规范（APPNOTE 4.4.17）要求 `/`；
  Info-ZIP `unzip` 不认 `\` 是分隔符，于是 Linux 上解出来是**一堆"文件名里带反斜杠"的平面文件**，目录树根本没建起来——
  而 DEPLOY §二 的 Linux 路线就写着"用这个包"。第二条更隐蔽：包内条目名里只要有非 ASCII 字符，
  .NET Framework 会按**机器 ANSI 码页（本机 cp936）**写名字且**不置 UTF-8 标志位**（`ZipFile.Open` 在 PowerShell 5.1 那一版**没有** `entryNameEncoding` 重载，实测报 `MethodCountCouldNotFindBest`，掰不动），
  Explorer 按 cp936 解正好，Linux `unzip` 按 CP437 解就是乱码——受影响的正是三本自产演示册（`api/data/library/辨妄阁*.epub|pdf`），
  而镜像站是**按文件名找实体**的，解错名＝登记在案的书一律取不到。
  修法两条：**`scripts/make-zip.ps1` 代之以 .NET `ZipArchive` 逐条 `CreateEntry`，名字里的 `\` 一律换 `/`**；
  **演示文件名改成 ASCII**（`bianwang-demo-{placeholder,reader,pdf}.epub|pdf`），**标题仍是中文**（界面、`library.json` 的 `title`、两条自检都按 title 匹配，实测 api-smoke 48/48、full-sweep 219/219 复跑不变）。
  闸门加在压缩步末尾：**读回中央目录，`\` 条数与非 ASCII 条数都必须为 0，否则拒绝交付**。
  验证方式就是最朴素的一条：`unzip` 解到仓库树外 → `sha256sum -c SHA256SUMS.txt` → **123 条全 OK、2449 个文件齐**。
  教训：**"包能在本机双击"不等于"包是Portable"**——zip 的条目名是一种跨平台协议字段，用系统默认编码去写它，等于把交付物绑死在生它的那台机器上。

- **A-26 校验清单里一行"不是文件的行"，让 `sha256sum -c` 把整包判成失败**（同轮回环校验撞到）：
  `api/node_modules` 有 2300+ 个文件，逐条列会让清单失去可读性，所以原先写成一行聚合值
  `a239fcad…  api/node_modules〔聚合：2324 个文件 / 79.0 MB…〕`——这行**符合 `<hash>  <路径>` 的格式**，
  于是 `sha256sum -c` 认真去找这个"路径"，报 `FAILED open or read` 并让整个命令**退出码 1**。
  接收方看到的交付物校验结果是"有一件对不上"，而真实情况是"这一件本来就不是文件"。
  修法：把聚合值改成 `# 注释行`（GNU `sha256sum -c` 静默跳过注释行），算法与比对办法挪进 `MANIFEST.md`。
  教训：**给人照做的清单，其"退出码"也是交付物的一部分**——一条格式合法的占位行，比少一条信息糟糕得多（F-18 同族：检查通过/失败的原因必须与它声称的语义一致）。

- **A-27 Electron 的版本号在这条链上是承重的，不是口味**（离线包可行性硬测）：
  后端 `package.json` 的 `engines` 要求 Node ≥ 20.19.0（`express-rate-limit` 一类的下限），而 Electron 内建的 Node 是随版本走的：
  33.4.11 内建 **20.18.3**（差一个补丁版本就**过不了闸**），44.5.1 内建 **24.21.0**（过）。
  所以"随便挑一个稳定版 Electron"会做出一个装完起不来的离线包，而且失败点在最不像会失败的地方（版本比较）。
  修法：44.5.1 连同 `bytes`/`sha256` 一起写进 `scripts/make-offline-package.mjs` 的 `ASSETS`，取用前逐字核对；
  `installer\runtime.cmd` 与 `installer-app\core.cjs` 两侧都按同一条 20.19.0 下限判，**低于下限就拒绝起站**而不是硬跑。
  教训：**换运行时等于换依赖**——版本号要当契约钉死，钉在脚本常量里而不是"本机装的是啥就算啥"。

- **A-28 Node 的 `spawn` 在 Windows 上会把参数再转义一遍，`cmd /c` 因此认不出我们的脚本路径**（安装器第一次真调 `env.cmd` 就中）：
  `spawn('cmd.exe', ['/d','/s','/c','""C:\\...\\env.cmd"'])` 里那个 argv 元素被 Node 自动加引号并转义内部 `"`，
  cmd 实际收到的是 `'\"\"C:\\...env.cmd\"'` —— 报"不是内部或外部命令"，**退出码 1，还带一行 OEM 码页的乱码**。
  同一份命令行在 C# 的 `ProcessStartInfo.Arguments`（逐字拼接）下是好的，所以这条坑只在"把 C# 翻成 Node"时才会踩。
  修法：`windowsVerbatimArguments: true`，命令行由我们自己逐字给（`""路径" 参数"`，与 C# 版完全一致）；
  顺带删掉原先想加的 `chcp 65001>nul & ` 前缀——实测它会让 cmd 在路径的空格处截断（`rc=1`），
  而 UTF-8 解码根本不需要它：node 输出本来就是 UTF-8，解码权在我们手里，只有 cmd 自己的中文报错行需要退路（按行检测替换符，命中就整行改按 GBK 重解）。
  教训：**跨语言重写"起进程"这段代码，转义规则就是另一种语言**；判"能跑"要拿带空格的路径跑，不带空格的路径证不了这件事。

- **A-29 NSIS 一处脚本要过四道独立小关，任何一道都只报一半线索**（第一次编 `offline.nsi`）：
  ① 脚本含中文注释却没有 BOM → `Bad text encoding: offline.nsi:2`，报的行号是第二行而不是编码本身；
  ② LogicLib 没有 `!~`（模式匹配）→ `Error in macro _If on macroline 9`，指向的是 `${If}` 内部而不是我写的那行；
  ③ `makensis.exe` 放在包根 `windows\` 时按"上一层"找自己的家 → `Error: reading stub "...\nsis-bundle\Stubs\zlib-x86-unicode"`，
  把它放进 `windows\Bin\` 才对（这个 bundle 的目录布局与官方 zip 不同）；
  ④ `OutFile` 是相对 **`.nsi` 所在目录**解析的，不是 cwd → 编译退出 0、`-V2` 一声不响，产物却落在 `installer\` 里，
  出包脚本在 `outputs\package` 左等右等。修法：脚本存成 UTF-8 with BOM、`${If} $EXEPATH != "$TEMP\bw-uninstall-offline.exe"`、
  `Bin\makensis.exe`、以及**编完按 `installer\<name>.exe` 找产物再搬到位**。
  教训：`退出码 0 + 没有产物` 是"检查通过的原因与它声称的语义不一致"的又一例（F-18 同族）——**出包脚本必须回查文件存在**，
  这条在 `make-offline-package.mjs` 里现在是一道显式失败。

- **A-30 Git-for-Windows 的 `tar` 排在 PATH 前面，把 `C:\...` 当成"远程主机上的路径"**（解 Electron zip 时）：
  `tar -xf C:\...\electron.zip` → `tar: Cannot connect to C: resolve failed`（GNU tar 的 `host:path` 远程拷贝语法优先于 Windows 盘符）。
  修法：出包脚本点名 `process.env.SystemRoot\System32\tar.exe`（Windows 自带的 bsdtar，认盘符也认 zip/tar.gz），
  并且**找不到它就报错退出**而不是退回"随便一个 tar"。
  教训：本机 PATH 上有两个同名工具时，"能跑"取决于谁在前面——和 A-28 里 `find`/`findstr` 那次是同一类事故。

- **A-31 换交付形态时，"随包生成的说明文件"是最容易漏掉的一处——它会把运维指向一个这台机器上根本不存在的东西**（离线包第一次出完之后回读才发现）：
  `make-offline-package.mjs` 第 1 步复用 `make-nginx-package.mjs --write`，于是**站点树那份 `README-FIRST.md` 与 `MANIFEST.md` 被原样抄进离线包**，
  里面写的是"双击 `installer\setup.cmd`，它用系统自带的 `csc.exe` 现编出安装器再打开界面（本包不预置任何 exe）"——
  这句在旧形态里是真的，在离线包里三个词全是假的（不现编、不碰 csc、包里全是 exe），
  而且 `MANIFEST.md` 连 `runtime/` 这一行都没有、还让人以为 `SHA256SUMS.txt` 覆盖整棵树（它只覆盖站点那半）。
  闸门拦不住这类问题：**它校验的是字节与清单，不是文字和形态对不对得上**。
  修法：出包脚本多一步 `rewriteDocs()`，改掉 `README-FIRST.md` 那段"Windows 一键安装"、给 `MANIFEST.md` 加 `runtime/` 行并写明两半各由哪个摘要自证；
  并且**找不到那段旧文本就退出**（`✗ README-FIRST.md 里找不到…站点脚本改格式了？先看一眼再出包`）——
  这段改写靠的是文首标记，静默失配就等于下一次出包又发一份假说明回去。摘要因此与上一轮不同（171.1 MB 那件重出过一次），再次印证 A-23：**别跨轮比数字**。
  教训：换形态要连"生成的说明"一起换。代码里的注释我逐条过了一遍，漏的偏偏是**只有出包才落盘、平时没人再看**的那两份。

- **A-32 把"本轮产物的 sha256"写进随包文档＝制造一个自指的假陈述**（本轮连着撞了两次）：
  `docs/DEVELOPMENT.md` 是打进离线包里的，所以文档里那句"最终产物 sha256 = `ae04ab71…`"会被这次出包**改掉**——写完摘要、重出，摘要就变了，
  于是文档里那串永远在说**上一件**。更绕的是它还会骗人：第二、第三件都"看起来是最新的"，因为改动全在文档自己里，闸门一条也不会红。
  修法（已落进 §4.14 那张表）：文档里只写**体积量级**与"本轮出过几件、每件差在哪"，摘要指向**当轮**的 `SHA256SUMS-offline.txt` 与 Release 说明；
  并把**出包放在一轮的最后一步**（本轮顺序是：文档与引擎改完 → 三套自检串行复跑 → `verify-deploy` → 才出包）。
  与 A-23（`csc.exe` 无 `/deterministic`，摘要每轮必变）是同一条纪律的两个方向：**不能跨轮比数字，也不能让轮内的数字自指**。

- **A-33 `SHA256SUMS-offline.txt` 用 CRLF 写，正好把文档里教的那条核对命令弄坏**（本轮收尾时真撞上一次，是 A-26 的同族）：
  出包脚本写这份摘要文件用的是 `${hash}  ${NAME}.exe\r\n`，而 `rewriteDocs()` 给包内 `MANIFEST.md` 加的核对指引明写着
  `sha256sum -c SHA256SUMS-offline.txt   # 有 coreutils 时`。`sha256` 把行尾的 `\r` 当成**文件名的一部分**，实测报
  `sha256sum: 'bianwang-1.1.0-offline-win.exe\r': No such file or directory` → `FAILED open or read` → **退出码 1**，
  而这正是回环验收用来判"包没被换过"的那一步（`certutil -hashfile` 不受影响，所以只有 Linux/WSL/coreutils 这条路是坏的）。
  修法：写盘改 LF，并且**写完立刻读回来断言**（有 `\r` 就退出、格式不是"<64 位十六进制>两空格<名>.exe\n"也退出），
  让它和站点那半的 `SHA256SUMS.txt`（本来就是 `lines.join('\n')`，124 条 `-c` 全 OK）用同一套口径。
  教训：**给运维写的核对命令，要连核对文件自己的格式一起验**；一份"看起来内容正确"的校验值清单，行尾错了就等于该分支上永远是红的（同 F-15：判红之前先问"这一步到底是谁在解析它"）。

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
- **D-9 pdfjs-dist v6 把 `PDFDocumentProxy.destroy()` 删了**：照 v4/v5 的写法调 `doc.destroy()` →
  每个 PDF 阅览请求 422 `doc.destroy is not a function`（`finally` 里的异常盖掉了正常结果）。
  改为**持有 `getDocument()` 返回的 loadingTask**，`finally` 里 `await task.destroy()`——释放字节的职责本来就在 task 上。
  教训：升级渲染器要读它的 breaking change，`getOutline`/`numPages` 都还活着，只有销毁路径换了主人。
- **D-10 PDF 整本渲染拿不到节名**：`renderPdfWhole` 只吐文本段，断言"逐节有标题"无从下手。
  修法：每节前缀一个经 `sanitizeEpubHtml` 的 `<h2 id="chN">`（顺带给全本锚点），并回传 `chapterCount`。
  **不做服务端光栅化**是明示取舍：页内出现 `canvas`/`img` 位图即判失败（走查专断一条），
  既守住"CPU 不被渲染拖死"，也守住"文字层可复制可检索"。
- **D-11 EPUB 的 XML 用正则"解析"**（真实缺陷，因"先找开源"换成 `@rgrove/parse-xml` 才暴露）：
  原先靠 `text.match(/<nav-label[^>]*>([\s\S]*?)<\/nav-label>/)` 之类取标签内容，两个后果——
  ① 目录**次序与父子层级**丢失（正则只给"第一个匹配"，NCX 的 `navMap` 嵌套结构被拍平）；
  ② XML 写坏时不报错，**目录静默变空**，用户看到一本"没有章"的书。
  换成严格解析后当场发现"nav 项次序错"，并让坏 XML 变成 422 且消息指出是哪一个文件；
  nav/NCX 另给 `tolerant:true`——最坏只让章节名退化成文件名，不再整本打不开。
  教训同 B-10：**"能跑出个结果"的正则解析不是解析器**，它把格式错误转成了静默的数据丢失。
- **D-12 `csv-stringify` 在 `record_delimiter:'\r\n'` 下不给裸 `\n` 加引号**：写出的 CSV 里
  一个含换行的字段会被 CRLF 记录分隔符"截"成两行（实测往返发现）。
  修法：`quoted_match: /[",\r\n]/` 显式声明"含 CR/LF 也要引起来"。与 E-8 是同一条链的两端，读侧宽松、写侧必须严格。

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
- **E-8 自写 CSV 转义让口令里的换行造出"幽灵身份行"**（真实缺陷，换成 `csv-parse`/`csv-stringify` 时发现）：
  `cell()` 只给含 `"` 与 `,` 的字段加引号，**含 `\n` 的字段原样写出** → 一条用户记录变成磁盘上的两行；
  读侧按行切分，第二行被当成一条 `username=片段` 的新用户。后果不是"报错"而是**多出一个谁都没登记的账号**。
  修法：读写都交给 csv-*（写侧另需 D-12 的 `quoted_match`），并把表头判定改成"整行前两列是 `username,password`"而不是"行首前缀"。
  `full-sweep` 补 5 条：含 `"`、`,`、`\n`、`\r\n`、首尾空格的口令与显示名逐个往返，**行数必须仍是 1**。
  教训：**明文存储的边界就是转义的边界**；只要有一处手工拼接 CSV，注入点就在"看起来无害的字符"上。
- **E-9 新增台账写入把自检打到 429**：档案版本化 + 媒体对账 + 日志聚合都算写操作，
  写限流产品默认 40 次/分，全量体检在默认实例上跑到一半就被 429 掐断——**这不是被测系统坏了，是测试与控件抢同一扇门**。
  修法：阈值改为可配 `BW_WRITE_LIMIT_PER_MIN`（**产品默认仍是 40，没有偷偷放宽**），自检实例给 300；
  同时补一条"**限流按配置真的会挡住**"的正向断言（用 `BW_WRITE_LIMIT_PER_MIN=2` 起一个实例打第三发），
  防止后人把配置项读成"关掉限流"。教训同 F-1：调控件不能只测"放宽后能用"，要测"设小了她真的挡"。
- **E-10 `upgrade-insecure-requests` 与 HSTS 按 `NODE_ENV` 下发，会把"生产 + 无证书 + 内网明文 HTTP"这一档整站打死**（本轮全自动验证抓到，与 R-16 同族）：
  `securityHeaders()` 里这两个头当时只看 `config.isProd`，而本项目当前的生产实况恰恰是**明文 HTTP**（用户指定：暂无证书，默认必须 HTTP 起站）。
  `upgrade-insecure-requests` 不是"提醒"，是**改写请求**：浏览器把页面里每一个 `http://` 子资源与接口请求换成 `https://`，
  而起站机上没有 TLS 监听。实测（`NODE_ENV=production`、绑 `192.168.10.11:8791`、headless Chrome 真访问）：
  7 个请求里 **6 个被改写成 `https://192.168.10.11:8791/…`**，全部 `net::ERR_SSL_PROTOCOL_ERROR`，`/api/` 一条都没发出去，页面只剩空白；
  修完后同一台同一地址：**16 个请求、5 条 `/api/` 调用、被改写成 https 的 0 个、失败 0 个**，标题正常渲染成"卷首 · 档案瀑布"。
  出包之后又对**交付的那棵树**复测了一遍（`runtime\BianwangRuntime.exe` + `ELECTRON_RUN_AS_NODE` 起 `api/src/index.js`，绑 `192.168.10.11:8792`、`NODE_ENV=production`）：
  浏览器同样 16 请求 / 0 改写 / 0 失败，带 `x-forwarded-proto: https` 时两档头都回来，`ops/verify-deploy.mjs` 只读 **26 项 0 失败**、`--mutate` 含写 **36 项 0 失败**
  （写链路要在**内网明文 IP** 上登录成功才算数——这正是 R-16 与 E-10 交汇的那条路，Secure 判错就会"口令对却登不进去"）。
  修法与会话 cookie 的 `Secure` 用同一条判据：只看**这一条请求是不是真走 TLS 进来的**（`req.secure`；`trust proxy` 已开，
  Nginx 侧 `nginx/bianwang-proxy.inc` 已 `proxy_set_header X-Forwarded-Proto $scheme`），TLS 一上就自动补回，不需要新开关。
  这也让后端与 `nginx/bianwang-http.conf` 的既有口径对齐——那份配置早就写着"**HTTP 版故意不发 HSTS**"（DEPLOY §一 B），只有 Express 这一层没跟上。
  教训：**协议相关的头不能按"环境名"发**；HSTS 发出去很难撤回，UIR 发错则当场不可用，两者都该由真实协议决定。

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
- **F-9 转场/异步未完成时用同名类断言**会命中即将移除的旧节点或**上一次请求的结果** → 等稳定态再取。
  本轮两次撞到同一个根因：① 点 PDF「下一页」后只等 `location.search` 变了就取 `.reading-title`，
  标题还没随响应体换掉 → 假红；② 馆务台账按事件筛选日志后，只等"表格的第二张存在"就去数事件列，
  NodeList 恒为真值 → 读到的是**筛选前的全量表** → 又假红。
  修法：断言前等**该次异步的完成信号**（阅览页等标题文本真的换掉；台账等面板标签的 `aria-busy="false"`），
  并把完成信号做成产品的一部分（日志面板标签因此带上"全量 N 条 / 命中 M 条" + `aria-busy`——
  这既给测试一个同步点，也让运维不会把筛选结果误读成全量）。
  教训：**"等待条件"必须是"我会断言的那个值已经更新"**，不是"页面上有个同名节点"。
- **F-10 后台任务与子代理必须给独立 scratch 目录、禁止越界删除**。本项目历史上有一次后台调研代理
  `rm -rf` 误删 28 个成品页的事故，规则（独立目录名、只允许逐个 `rm` 自己创建的文件、删除前不看截断输出）
  已固化为全局约束；本仓库所有探针只写 `.scratch-verify/`。
- **F-11 "删掉会话再断言失效"其实从没带上过那个会话**。helper 里 `cookie: 'none'` 会 `delete headers.cookie`，
  于是同时把调用方**显式传入**的 `headers: { cookie }` 也删了：请求以"完全无会话"发出，
  `body.user === null` 永远成立——"被删用户的会话立即失效"这条断言是**假绿灯**。
  补示例用户断言（要求 `user.username === 'demo'`）时它才暴露出来（返回 null 而不是 demo）。
  修法与 F-1 同型：helper 先探测调用方是否给了该头（`gaveCookie`），给了就以调用方为准、也不回写实例会话。
  教训：**"断言为 null/为空"的测试必须同时有一条"断言为具体值"的姊妹测试**，否则删掉传参也能过。
- **F-12 自检脚本自己写死了 8 项菜单**（真实缺陷，加"资源库/镜像站/馆务台账"后撞到）：
  `api-smoke.mjs` 在测完菜单编辑后要把菜单"还原"，还原载荷是**脚本里手抄的 8 个 moduleId**。
  于是每次自检收尾都把新增模块**从真实菜单里抹掉**——测试绿灯，站上的入口却没了。
  修法：脚本 `import { MODULE_IDS } from '../web/src/modules/registry.js'`，还原一律按注册表全量，
  并加一条"还原后条目数与注册表一致（11/11）"。
  教训：**测试里的"期望初值"必须与产品同源**；手抄一份常量表等于制造第二个真相（与 B-6/B-6b 同一族）。
- **F-13 断言"因真实原因通过"要逐个复核口径**（本轮撞了四次）：
  ① `by === '自检'` 其实是显示名 `档案管理员`；② 版本 `list` 响应**不含快照**，
  把"快照是不签名路径"的断言放在接口层永远拿不到 → 移到 sweep 的文件层；
  ③ 种子快照里的图早被抹掉文件，拿它当"在用媒体"就撞上 staleIndex → 改点名新上传的那张，顺势加"死链单列"断言；
  ④ 文案匹配 `/非本站扩展名/` 与实际"非本站写出的扩展名"不符。
  全部是**绿灯通过、结论却来自另一条路径**的形态。修法：断言前先打印被断字段的原值（本轮每条都带 `— 实测值` 后缀），
  并把"异步落盘"的读盘断言一律走 `waitForFile`（`media-index.json` 是排队写的，立刻读会读到旧盘）。
- **F-14 走查脚本同一作用域又 `const ps`**（第二次撞到 F-4 同族）：新增断言块直接 SyntaxError，
  `node --check` 一秒就能发现，但**必须先 check 再跑**——跑起来才发现等于白等一趟起服务。
  本轮改名副后 `psv`；PDF 翻页断言另修一处时序：`location.search` 先变、`.reading-title` 靠后到的响应体才换，
  只等地址栏就断标题必然假红 → 改成 `waitFor(标题前缀)` 再取值。
- **F-15 部署验收脚本自己有三条口径错**（拿 8891 的生产实例真跑才暴露）：
  ① 在**首页**上判 `X-Robots-Tag`——本站只给接口与资产下发该头（正文页是**故意**可被检索的，`robots.txt` 只挡后台路径），
  所以这条永远红；② 用直连 Node 的入口判 `/assets/*` 的 `immutable`——那是 Nginx `location /assets/` 的职责，
  Node 侧只给 1h，也算到 Node 头上就永远红；③ 结构断言按"我以为的形状"写：详情响应实际是 `{post:{…}}`、
  资源库实际是 `{groups:[{items}]}`，直接读 `data.rumor` / `data.items` 就假红。
  修法：检查项按 **"这个头/这条性质是谁下发的"** 分级——`FAIL`（站点真不通）/ `WARN`（只在生产入口要求，如 CSP）/
  `INFO`（只有经过 Nginx 才成立，如 immutable），后两级不判红；结构断言一律先 `curl` 看实际响应再写。
  教训：**"生产标准"不是一个开关能概括的**，同一个头在不同链路（Nginx / Node / 直连）由不同的人下发，
  判红之前先问"我这次请求经过了谁"。
- **F-16 "做完动作立刻读台账"必然偶发读空**：`audit()` 为省 syscall 走 **120ms 缓冲落盘**，
  所以验收脚本在删除档案后马上读 `/api/ops/security-log`，拿到过 0 条（不是没记，是还没落盘）。
  修法：读侧轮询到出现为止（≤2s）再判；同时把这 120ms 当作**明示的产品取舍**写进文档，
  而不是让人以为"审计丢了"。与 B-10、F-9 同一族：**异步的写要有异步的读**。
- **F-17 F-16 的修法本身是个假修法**（做解压回环时才暴露，同一个 FAIL 又红了一次）：
  轮询的退出条件当时写成"**台账有条数就 break**"。可只读阶段先产生的 `denied-client` 也是一条——
  于是第一轮就 break，登录与建档还在缓冲里，台账只回 1 条，断言"含登录与档案写操作"判红。
  上一轮它对 8891 实例**恰好是绿的**，只因那一批事件被同一个 120ms 定时器一起刷了出来：
  PASS 依赖的是运气而不是条件，这正是 F-13 说的"因真实原因通过"没做到。
  修法：轮询要等**两类事件都到齐**（`/login/` 与 `/post-/` 各命中一次）才收，超时上限放宽到 5s；
  并把 `byEvent` 全量打进 detail，让"到底等到几条、等成了什么"在报告里看得见。
- **F-18 "解压回环"在仓库树里跑，等于没测**（A-11 的方法论那一半，也是本项目最贵的一次假绿）：
  验收步骤是"把包解压到别处再起来打一次接口"，我照做了——解压到仓库内的 `.scratch-loop-*`。
  仓库根的 `node_modules/.pnpm/` 正好是它的祖先目录，ESM 逐级向上查找时**静默兜住了包内缺失的兄弟依赖**，
  于是"缺 `ip-address`"的包在我机器上每一次都绿，发到 GitHub 后在用户的远程机上炸。
  修法不是"下次记得解压到外面"，而是**把前提变成断言**：出包 gate 在拷贝之前逐级扫 `%TEMP%` 的祖先链，
  路上只要有 `node_modules` 就**拒绝出包**并指名那个目录；通过之后还要同时满足
  "进程打印启动横幅 + `GET /api/menu` 返回 200 + 条目数 > 0"三条，不看"没报错"。
  教训：**验证环境必须比目标环境更苛刻，或者至少证明自己不更宽容**；
  任何"换了个目录"的隔离性都要由脚本自己核实，不能由我的记忆保证（同 F-13：PASS 要因真实原因通过）。
- **F-19 走查脚本悄悄依赖一个手工摆进去的夹具，一次目录清理就把三项断言判红**：
  插图上传那三项读的是 `.scratch-verify/sample-chart.png`，但**脚本里没有任何一行创建它**——文件是更早某轮我手工放进去的。
  按你的指示删掉 `.scratch-*`（含截图）之后，`DOM.setFileInputFiles` 指向一个不存在的路径，
  于是报的是"编辑器插图上传后进入正文并带媒体号 — mid=（空）"这类**看起来像功能坏了**的失败。
  修法：`walkthrough.mjs` 加 `writePngFixture()`，每轮现场生成（PNG 魔数 8 字节 + IHDR/IDAT/IEND，CRC 自己算，163 字节），
  路径与体量写进断言 detail（`mid=… 夹具=163B`），夹具位置可用 `FIXTURE=` 覆盖；复跑 **165/165**。
  教训同 F-18：**验证的前提要由验证自己建立**，凡"我先手动准备一下"的 step 都是下一轮的定时炸弹；
  同理夹具要落在被测系统真正认的那条判据上（这里就是 `sniffImageType()` 的魔数与 `maxImageBytes`），不是"随便一张图"。
- **F-20 一条测错东西的断言可以绿很久：`生产模式带 HSTS 与 nosniff`**（E-10 的另一半）：
  全量体检里这条 PASS 了若干轮，而它 PASS 恰恰证明被测系统是坏的（明文 HTTP 生产档发出了 HSTS + UIR）。
  更隐蔽的是**本机看不见**：Chrome 把 `127.0.0.1` 与 `localhost` 当"可信来源"，不对它们执行升级，
  所以历次走查与验收（全部走回环）永远不会白屏——只有换成内网 IP 才现形，这就是 E-10 直到本轮才被实测的原因。
  修法：把那一条拆成**成对断言**——明文 HTTP 的生产档 `strict-transport-security` 必须为空且 CSP 里不含 `upgrade-insecure-requests`；
  同一实例带 `x-forwarded-proto: https` 时两者必须都回来（与 cookie 的 `Secure` 那两条同构，`full-sweep` 由 219 → **221** 项）。
  教训：**判据本身要对着需求复核**，"绿灯"不是"行为正确"的证据；涉及协议/来源的断言，必须同时测**回环之外**的地址或至少伪造转发头，
  否则测的是浏览器的豁免规则，不是我的代码。

---

## 七、风险警示

按"会不会咬人"排序。每条给**现状 / 后果 / 缓解 / 上线前动作**。

| # | 风险 | 现状 | 后果 | 缓解 | 上线前必做 |
| --- | --- | --- | --- | --- | --- |
| R-1 | **口令明文存 CSV**（需求指定） | 默认 `users.csv` 明文；`BW_HASH_PASSWORDS=1` 可切 scrypt | 备份、误暴露、内部人员可读全部口令 | 名册接口默认剔除口令列；`BW_SHOW_PASSWORDS` 才回显；数据目录 Nginx `deny` | 改默认口令 + 开哈希模式 + 确认 `data/` 不在 web root 下 |
| R-2 | **默认账号 `admin/admin`** | 首次启动即存在 | 公网直接被试出 | 登录限次 + 锁定落盘 | 部署第一步就改名改密（DEPLOY §四 第 1 条） |
| R-3 | **CKEditor 5 是 GPL-2.0-or-later**（唯一 copyleft 例外） | 免费版 + `licenseKey: 'GPL'`，`COPYING.GPL` 随包 | 义务由**分发**触发：一旦开源整站或对外交付安装包/源码包，**整份前端源码须按同许可释出** | **2026-09-30 已公开发布整站源码，触发点已到——整仓按 GPL-2.0-or-later 释出（见根 `LICENSE`）**；README §八与 NOTICES §1.1 已核实登记；`server/data/`（明文口令、会话、审计日志）经 `.gitignore` 排除，未随仓库分发 | 若要改用宽松许可（MIT/Apache）须先**购入 CKEditor 商业许可并替换该依赖**，否则不得改标许可；发布后任何再分发都须连 `LICENSE` 与 `COPYING.GPL` 一并带上 |
| R-4 | **口令令牌出现在 URL**（取书与阅览插图） | 10 分钟时效、可吊销、`no-store` | 令牌会进 Nginx `access_log`，日志泄露即短时读权 | 时效短 + 吊销即废 + 范围口令 | 日志 `chmod 640`；或对 `/api/library/` 单设 `access_log off` |
| R-5 | **镜像站的版权红线** | 只伺服馆员放入 `server/data/library/` 的文件；不代抓网盘、不绕过登录门槛 | 收录他人翻译/扫描本即侵权分发 | 登记时强制"权利声明"字段并在页面前端展示；演示件是自产占位书 | 每本上架都留授权依据；接到投诉即下架（下架只撤登记，原件由馆员自管） |
| R-6 | **EPUB 正文里的图形/公式会丢** | 只放行位图；SVG、MathML 被净化丢弃 | 少数书看图缺图 | 保留 `figcaption` 与占位框；资产接口按魔数复核 | 需要矢量时改用位图导出，**不要**为样式放宽 CSP |
| R-7 | **PDF 阅览只走文字层** | `pdfRead.js` 取 `getTextContent()` + `getOutline()`，服务端**不渲染像素** | 扫描件（无文字层）在阅览页是空的；版面/字体/图位不复现 | 页面明示"仅取文字层，版式请下载原文件核对"；无书签的 PDF 退化全本一次给出；未入白名单的书根本进不来 | 需要版面复现或读扫描件时**另起方案**（客户端渲染或受控光栅化），先做 CPU 与许可评估 |
| R-13 | **版本台账会吃磁盘** | 每次修订存**完整快照**，每档保留 `BW_REVISION_KEEP`（默认 30）版 | 档案多、修订频繁时 `revisions.json` 体积线性上涨；快照里含正文与批注 | 保留数可配、清单接口不返回快照正文、比对按需拉两版 | 上线后定期看 `/ops` 的台账体积；真要长期留档应导出到备份，而不是靠保留数调大 |
| R-14 | **删档不抹历史，但也不补记** | 撤档时不新增版本，已存快照原样留着 | 台账里会出现"档案已不在、历史仍在"的行（页面已明写提示） | 这是**审计取向**的刻意设计；要连历史一起清就得手工动 `revisions.json` | 涉及"依法删除"类请求时，须同时处理 `revisions.json` 与 `security.log`，只删档案不够 |
| R-15 | **开机自启的 SYSTEM 任务在本机建不出来**（提权也不行） | 已提权实跑：`net session` 通过、端口已记录，`schtasks /create /sc onstart /ru SYSTEM /rl highest` 仍返回**拒绝访问**（本机 Windows 11 专业版，ProductType 1）。脚本已改成**失败降级**：仍注册 ONLOGON 任务 + 直接拉起站点 + 探端口确认，最后 rc 4 并写明"重启后不会自愈"。降级路径实跑通过（rc 4 · `[ok] site is up` · `/api/menu` 200 · `口令.txt` 落站点根）。**同日补测**：`schtasks /create /sc onlogon` 在**非提权**下同样被拒，所以"登录后自动起"这一档**不走任务计划程序**，改由安装器写 `HKCU\...\Run`（A-15 补记）——界面第三段因此是三档可选（不起 / 登录后起 / 开机即起），被拒的"开机即起"自动降级为"登录后起"并写明还剩什么 | 在这类机器上装完看着成功，重启后站点不在；ONSTART 那一半始终没被正面验证过 | 界面第 3 段与 `--autostart none\|logon\|boot` 都能选；`autostart.cmd` 打印拒绝原因与三条出路；`installer\run-site.log` 留 node 原话；`/status` 非提权可查；`schtasks /run` 不重启即验；`logon` 档写 Run 键后**回读确认**才算成 | 在**真正的 Windows 10 与 Server 2019**（服务器 SKU 允许任务取 SYSTEM）上各重启一次，确认登录前 `/api/menu` 就回 200，并确认 `node` 按**机器范围**安装（装在个人目录下 `SYSTEM` 找不到）。客户端机要自启请选"登录后自动起"（免管理员）或 NSSM 之类服务包装器，**先做许可核实** |
| R-16 | **站点当前以明文 HTTP 上线（生产暂无证书）** | 用户交代的前提就是"暂时没有 SSL 证书，只能用 HTTP 环境"，所以 HTTP 是**默认档**而不是待修缺陷：`resolveTls()` 没给证书就 `http.createServer`，`run-site.cmd` 不设 TLS 变量，界面默认选中 HTTP，`nginx/bianwang-http.conf` 让没有证书的机器也能装上 Nginx 就跑 | 口令、会话 cookie 与正文在内网链路上可被读到；`SameSite=Strict` 与反爬指纹挡不了同网段抓包。把 80/8787 映射到公网＝把馆员账号交出去 | 后端与安装器在协议判错时**宁可拒绝启动也不降级**（A-19/D-17）；界面与 `口令.txt` 都写明本次是明文；`DEPLOY.md` §六 有"迁到 HTTPS"的三条路；会话 cookie 的 `Secure` 按请求真实协议判，HTTP 部署不会被自己的属性打死（A-20 同族）；**HSTS 与 CSP 的 `upgrade-insecure-requests` 同一条判据**（本轮修的，E-10：按 `NODE_ENV` 发会让浏览器把明文站点的每个请求改写成 https，内网直连时整站白屏） | 拿到证书后：`BW_TLS_PFX`（或 `BW_TLS_KEY`+`BW_TLS_CERT`）重启后端，或在 Nginx 侧换回 `bianwang.conf`（含 80→443 与 HSTS）；届时再评估是否要强制跳转。**HSTS 一旦发布很难撤回**，所以 HTTP 版故意不发（后端与 Nginx 两处同口径） |
| R-17 | **交付物里有未签名的二进制在流通**（现形态＝离线包里的 `runtime\BianwangRuntime.exe` 与 NSIS 卸载器；旧形态 `--with-exe` 那份 `BianwangInstaller.exe` 已随 D-19 下线） | 没有代码签名证书，SmartScreen / 杀软可能拦。**本机实测撞到过一次处置**（当时还是 `--with-exe` 那份 exe，现象与包体无关，所以结论照样适用于现在）：`Expand-Archive` 解压到 `%TEMP%` 后那份 exe 立刻可读、可取摘要（包内三处一致 `d4a1e61c…`），但**第一次执行不返回，随后文件从磁盘上消失**；同样字节的这份放在仓库树里（`installer\`、`outputs\package\…\installer\`）一直存在，`--ping` 与 `--selfcheck --report` 都正常。本机注册的防病毒是 **360 安全卫士**（`360Safe` / `360tray` / `ZhuDongFangYu` 在跑，Windows Defender 已转被动且无查杀记录），所以处置来自第三方杀软的主动防御；**命中哪条规则没拿到一手证据**（360 的隔离日志无权限读），能给的只有上述对照 | 用户可能因为一次告警就以为包坏了；更坏的情形是包被替换后没人能靠签名发现 | 出包侧：`.exe` 走**白名单逐件核对**（站点树那半零 exe，离线包只允许 `runtime\` 那一套 Electron；冒出来路不明的就拒绝出包），外部二进制**按 sha256＋字节数取用**、缓存放仓库外。核对侧：Release 说明那一行摘要 + 包内 `SHA256SUMS.txt`（站点那半逐文件）+ `SHA256SUMS-offline.txt`（外层 exe），README/USAGE 都给 `certutil -hashfile` 的用法。被处置时的三条出路（写进 USAGE §10 与 DEPLOY §六）：**解到常规目录再双击**（别在 `%TEMP%`／浏览器下载的临时目录里点）、**核对摘要后**从杀软恢复并加信任、或走 `installer\setup.cmd /cli`（纯批处理，不开窗口；但它仍要用随包运行时当 Node，那也是个 exe——真被拦就删 `runtime\` 换系统 Node ≥ 20.19.0） | 要面向外部用户分发就得买代码签名证书（OV/EV）——**属花钱的第三方服务，先与用户确认再动**；Electron 那套二进制的签名还要额外过一遍（`signtool` 逐个签），不是签外层 exe 就完事 |
| R-18 | **交付物从 26 MB 涨到 171 MB**（离线包，D-19） | Electron 运行时解包 368 MB，zlib 压完 171 MB；这是"装机机什么都不用装"的价格 | 内网分发/低带宽机器上下载慢；U 盘与离线介质反而合适 | 站点树 zip（26 MB）仍在生产线上，Linux/Nginx 路线或"机器上本来就有 Node"的人可以用它；`SetCompressor` 固定 zlib（LZMA 能小三成但模块是 CPL-1.0，见 THIRD_PARTY §1.2） | 若要压到更小：先取得用户对 CPL-1.0 的单独批准再换 LZMA，**不要**顺手换 |
| R-19 | **Electron 44 与安装器界面只在 Windows 11 上跑过** | 官方支持面只写 "Windows 10 and up"；Win10 与 Server 2019 本机没有实机可验，Server Core 更是根本没有图形子系统 | 目标环境恰好是用户点名的那两个，"未验"不能当"已支持" | `offline.nsi` 里 `${AtLeastWin10}` + `${RunningX64}` 先挡掉明确不支持的；Server Core 走 `setup.cmd /cli`（纯批处理，不碰 exe）；`installer-app` 的结论全部来自 `.cmd` 引擎与回查，界面只是呈现 | 上线前在**一台真 Win10 与一台真 Server 2019** 上各装一次：验 Electron 能起、`ONSTART`+`SYSTEM` 能注册、重启后协议沿用、杀软是否放行 |
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
| `scripts/api-smoke.mjs` | 打活着的后端 | 权限边界、置顶唯一、HTML 净化、限流、锁定、签名直链过期、魔数与尺寸、反爬 UA、菜单读写、**版本端点与馆务端点**（含全站版本台账总表：口径齐备、只回表头不回快照、按动作/按档案筛选、登出后 401）（菜单清单按注册表派生，见 F-12） | 48/48 |
| `scripts/full-sweep.mjs` | **自起 7 个隔离实例**（core / shelves / prod / hash / lock / writelimit / keeplimit） | 建档到删档全链、媒体回收、资源库增删藏、镜像口令门控与吊销、EPUB 分页阅览边界、**PDF 阅览与预览白名单（12 + 19 项）**、**版本台账（保留数截断、比对、限流阈值 `BW_WRITE_LIMIT_PER_MIN` / `BW_REVISION_KEEP`）**、**全站版本台账总表（按档案筛选、记忆化按数据代次即时失效、`keep` 随实例配置、删档后 `alive=false` 仍在册）**、**媒体三方对账与点名清理**、**CSV 特殊字符往返**、出厂示例实体逐项在位、生产响应头与"接口不被单页兜底吞掉"、**会话 cookie 的 `Secure` 跟随真实协议（明文 HTTP 不带 / `x-forwarded-proto: https` 才带）**、**HSTS 与 `upgrade-insecure-requests` 同一对判据（E-10/F-20）**、旧菜单文件自动补齐、scrypt 模式、登录锁定 | 221/221 |
| `scripts/walkthrough.mjs` | 真实浏览器（CDP） | 登录→建档（材料源出处链接随档渲染）→CKEditor 画圈/划线/变色/解除标注→插图→用印→对勘→重排→菜单→置顶→删除→**修订一次→版本台账两版/词级 ins-del/同版提示**→镜像口令→**在线阅览翻页/插图/跨章单页链接/全本/令牌收回**→**架上检索命中章节→直达该节**→**预览开关往返**→**PDF 分节/页眉措辞/文字层/无光栅化/全本**→**馆务台账（对账读数、预演不改盘、确认框可取消、日志按事件筛选）**→**版本台账总表（五分栏口径、两表渲染、行链跳版本清单、按动作筛选、清空筛选）**→页脚出处链接→**凡例「出厂示例」表**；窄屏溢出（含馆务台账、版本台账总表与逐档版本台账三张表）；桌面端外壳几何（批注栏标题横排、页眉铺满不缩进）；逐屏截图 | 165/165，控制台零输出、CSP 零违规 |
| `scripts/pin-guard.mjs` | 静态检查（`prebuild` 里跑，构建前挡人） | 每条依赖声明必须**精确 pin**（无 `^`/`~`/范围符）、实装版本与声明一致、许可落在**宽松白名单**内（唯一例外 ckeditor5 的 GPL、以及 dompurify 的 MPL/Apache 双许可）、每个包都有"一句话用途"与可回指出处、同一包不得在两个工作区各装一份 | PASS（19 条声明 / 17 个运行时依赖） |

另有 `browser-probe.mjs`（主线程阻塞与关键节点计数）、`cpu-probe.mjs`，以及 terra-faction-ui 的
`audit-faction-ui.mjs`（52 文件 PASS）与 `audit-palette-separation.mjs`（12 家族色域互斥，最近对 lungmen/yan field ΔE 14.9）。

**交付侧还有两件**（不属于"证明功能对"，属于"证明装得上、跑得起来"）：

| 脚本 | 作用 | 为什么这么设计 |
| --- | --- | --- |
| `scripts/make-nginx-package.mjs` | 打"解压即上 Nginx"的**站点树**（`web/dist/` + `api/` + `nginx/` + `ops/` + `docs/` + `dashboard/` + `installer/` + `MANIFEST.md` + `SHA256SUMS.txt`）。Linux / Nginx 路线直接用它；Windows 路线它是**离线包的输入**（下一行） | **默认预演**，`--write` 才落盘、`--zip` 才压缩。核心是安全边界：`data/.secret`（会话与全部签名的主密钥）、`sessions.json`（活会话）、`security.log*`（含来源 IP 的审计流水）、`login-attempts.json`（锁定计数）、`installer/port.txt` 与 `installer/run-site.log`（本机状态与含路径的运行日志）**一律挡在包外**并逐条打印（`.pnpm/node_modules/server` 那条自指软链按路径挡，它会把整个开发 `server/` 灌进包）。`api/` 每次**现做**（内部跑 `pnpm --filter server deploy --legacy --prod --config.node-linker=hoisted`），不留可复用的旧快照（A-6 的成因就是复用了修复前的 deploy 产物）；包内 `api/` 自己重跑一次 `reseed`，所以出厂态不是开发残局。`web/dist/` 含编译后的 CKEditor，因此随包带 `LICENSE-NOTE.txt` + `COPYING.GPL`。**出包末尾六道硬闸，任一红就不出包**：① 运行态扫描；② `api/node_modules` 软链接条数必须为 0（hoisted 平铺的证据）；③ **孤立自足性**——把 `api/` 拷进 `%TEMP%` 下祖先链无 `node_modules` 的位置（先自证这点）真起后端并要 `/api/menu` 返回 200 且有条目（A-11/F-18 加的）；④ **批处理合规**——包内每个 `.cmd`/`.bat` 必须 CRLF 且零高位字节（A-7/A-9 加的，`ops-extras/start-api.cmd` 曾带 34 个裸 LF 发布出去过）；⑤ **包内零 `.exe`**（D-15/A-6 立的；离线包那一层另有白名单口径，见下一行——站点这半永远不许带二进制）；⑥ **zip 条目名可移植**（A-25 加的）：压缩不用 `Compress-Archive`，改调 `scripts/make-zip.ps1`——.NET `ZipArchive` 逐条建条目、名字里的 `\` 一律换 `/`，压完**读回中央目录**，`\` 条数与非 ASCII 条数任一不为 0 就**拒绝交付**（非 ASCII 的根因是 .NET Framework 按机器码页写名字且不置 UTF-8 标志位，而 `ZipFile.Open` 在 PowerShell 5.1 上没有 `entryNameEncoding` 重载可掰；所以出厂演示册的**文件名**改成 ASCII，**标题**仍是中文） |
| `scripts/make-offline-package.mjs` | 打**离线完整安装包**（单个自解压 exe ＝ 上面那棵站点树 + `runtime/` 随带运行时 + `runtime\resources\app` 图形安装器），`pnpm package:offline` | **第 1 步就是调上一条命令**（`--write`，不带 `--zip`），站点那半的六道闸一条不少、逻辑不复制。之后加**三道自己的闸**：⑦ **外部二进制按校验值取用**——Electron 官方运行包与 NSIS 工具包先比 sha256 **加字节数**，对不上就停（缓存放在仓库外 `%LOCALAPPDATA%\bianwang-offline-cache`，公开仓库里不留二进制；也不"顺手用本地那份"，A-6 的镜像教训）；⑧ **交付物内 `.exe` 白名单**——只允许 `runtime\` 那一套 Electron，别处冒出一个就拒绝出包（本轮实测：白名单内 1 个，`runtime/BianwangRuntime.exe`）；⑨ **依赖探针清单三处同源**——`installer\startup-imports.json` ↔ `installer-app\core.cjs` ↔ `dashboard\Dashboard.cs` 逐项比对，引号风格两种都认（闸门不该做成拼写检查）。另有两件不是"闸"但会挡人的：`makensis` **退出 0 还要找产物**（落在 `installer\` 而不是等它出现在 `outputs\`，A-29），以及产物字节数低于 50 MB 直接判"没含运行时，别发"。包内 `README-FIRST.md` / `MANIFEST.md` 会**改写成本包口径**（旧文本叫运维去找 `csc.exe` 现编一个这里根本不需要的安装器，属假说明） |
| `scripts/check-package-parity.mjs` | **出完包回读**：逐件比对仓库与包内树的 sha256（33 件：后端四件 + 五份文档 + 九个 `.cmd` 引擎与两份随包件 + `installer-app` 九件 + `Dashboard.cs` + 三份 nginx + `verify-deploy`），任一不一致就退出 1 | 闸门校的是字节与清单，**校不出"包内这段文字还是上一轮形态的"**（A-31），也校不出改了 `server/` 却忘了重出包（本轮 E-10 同时落在两侧，就是靠这一步确认交付树带着修好的中间件）。不参与比对的是 `README-FIRST.md` 与 `MANIFEST.md` 两份——它们由 `rewriteDocs()` 按包形态改写，本来就该和仓库里那份不同 |
| `ops-extras/verify-deploy.mjs` | 部署后验收（对**已上线的入口**跑，不碰仓库） | 默认只读；`--mutate` 才走"建档→修订→比对→置顶→删除"且自清。判定分三档：**FAIL**＝不通、**WARN**＝只在生产才要求（CSP）、**INFO**＝只有经 Nginx 才成立（`/assets/` 的 immutable），后两档不判红——否则会逼人把只读探针当故障单 |

这几件都是被踩坑逼出来的（F-15：把 Nginx 的职责算到 Node 头上、在首页判只该给接口下发的 robots 头、
按"我以为的响应形状"写结构断言，三种都会造成永远红的假故障；F-16：审计是 120ms 缓冲落盘的，
做完动作立刻读台账会读到空）。

**复跑顺序（务必串行，F-6）**

```bash
node scripts/pin-guard.mjs       # 依赖守卫：不绿就别往下走
pnpm seed                        # 取确定基线（走查依赖固定次序，见下）
chrome --headless=new --remote-debugging-port=9223 about:blank   # 走查用
BW_WRITE_LIMIT_PER_MIN=300 pnpm dev      # 或 pnpm start（8787，伺服 web/dist）；300 只为自检放行（E-9），产品默认仍是 40
node scripts/api-smoke.mjs       # 48
node scripts/full-sweep.mjs      # 221（自带隔离数据目录，跑完清理）
node scripts/walkthrough.mjs     # 165（每轮先 seed 取确定基线，改过的顺序/菜单/置顶会复位）
pnpm audit:ui                    # Yan 契约审计
pnpm build                       # 许可登记表再生 → 依赖守卫 → 分包
node scripts/make-nginx-package.mjs --write --zip   # 站点树：api/ 现做、包内重播、六道闸后压缩
node scripts/make-offline-package.mjs --write       # 离线包：调上面这一步（--write，不压缩）再铺 runtime + 三道闸 + NSIS 出单个 exe
node scripts/check-package-parity.mjs               # 出完包回读：包内文本＝仓库文本（33 件逐字节，A-31/F-19 逼出来的一步）
# 站点树 zip 的解压回环（走 Linux/Nginx 路线时必做；换到另一个目录、且路径以 . 开头）：
#   Expand-Archive 到 .scratch-*/  →  cd .scratch-*/bianwang-<版本>-nginx/api && NODE_ENV=production node src/index.js
#   node ops/verify-deploy.mjs http://127.0.0.1:<端口> --expect-prod              # 26 项只读
#   node ops/verify-deploy.mjs http://127.0.0.1:<端口> --expect-prod --mutate --user admin --pass '出厂口令'  # 36 项含写链路
# 离线包：双击 exe 会弹 UAC（本机不代跑），不实机的话就按 §4.14 那张表用**出包暂存树**驱动引擎与界面
```

**判绿的标准**：除了"失败 0 项"，还要看 ① 构建日志 `grep -c ERROR` 为 0 且产物存在；
② 走查尾部是"（无控制台输出）"；③ 新增断言要能**因真实原因**通过——把被测行为故意改坏一次，看它是否变红
（本轮因此暴露了 F-13 的四条口径错位）；④ 断言旁边打印实测值，不看"布尔真" alone。

### 8.1 依赖升级窗口（CKEditor 5 与 pdfjs-dist 的 SOP）

`ckeditor5`（大版本改过转换与选区 API 两轮，§六 C-3/C-4）与 `pdfjs-dist`（v6 删了 `destroy()`，§六 D-9）
都属于"升级即破"的库，且本站对两者都做了**超出常规用法的改造**（自定义插件 + 服务端渲染）。
所有生产依赖已精确 pin，所以升级是一次**显式动作**，不会被 `pnpm install` 悄悄带上去。

**窗口流程（照做，别跳步）**

1. **先立基线**：`git status` 干净、三套脚本刚全绿、`pnpm seed` 后跑一轮走查留截图；记下当前版本。
2. **只读 release notes 与 breaking changes**：CKEditor 5 的 `CHANGELOG.md`（重点：`model.Selection`、
   `editor.model.change`、`editor.conversion`、toolbar item 注册）、pdfjs 的 `CHANGELOG.md`（重点：`getDocument` 参数、
   `loadingTask` 生命周期、`getTextContent` 返回形状）。**不要**先升再试。
3. **单独开一次只升一个库**的尝试（两个一起升出错无法归因）。改 `package.json` 里的精确版本号 → `pnpm install`。
4. **按顺序跑四道闸**：`node scripts/pin-guard.mjs`（许可/用途是否还成立）→
   `pnpm build`（CKEditor 的 GPL 例外登记是否还准确；`licenseKey` 是否仍是 `'GPL'` 档）→
   `node scripts/api-smoke.mjs` + `node scripts/full-sweep.mjs`（净化白名单、PDF 边界、`doc.destroy` 类运行期炸点）→
   `node scripts/walkthrough.mjs`（**只有浏览器能验的**：四枚按钮的 `ck-disabled` 态、选区、tooltip 中文前缀、
   CSP 零违规、PDF 无 `canvas`）。
5. **看走查的控制台输出**：CKEditor 的破坏性变更多半表现为"编辑器一片空白且**没有报错**"（§六 C-1 同族），
   因此要额外确认 `document.querySelectorAll('.ck-editor').length === 2` 与四枚按钮可点。
6. **升级成功后**：把新版本写进 §3.1 表格、`README.md` 与 `THIRD_PARTY_NOTICES.md`，
   并在 `gen-license-manifest.mjs` 的 `PURPOSE`/`SPDX_FIX` 里核对许可声明是否变了
   （CKEditor 从"伞包 + 免费档"变成别的授权形态时，`SPDX_FIX['SEE LICENSE IN LICENSE.md']` 这条映射必须重审）。
7. **升级失败要能一键退**：只回退 `package.json` 的那一行 + `pnpm install`，**不要**顺带改业务代码去"绕过"新 API——
   绕过会让下一次升级更难。留在原版本的风险记进 §七。

**不做的升级**：`vite`/`vue`/`express` 这类栈底库只在需要新能力时才动，动前同样走 1\~5；
纯安全补丁（如 dompurify/sanitize-html 的 XSS 修复）**优先**，因为它们替我们挡的是真实输入。

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
| 14 镜像站检索 + PDF 阅览 + 预览白名单 | 架上元数据/章节标题检索、`pdfRead`（书签分节 + 文字层）、逐本勾选 `previewable`、第三本演示册是自产带书签 PDF | pdfjs v6 删了 `destroy()`（D-9）、白名单默认关挡住既有断言（§六 D-10 同族） |
| 15 版本台账与馆务台账 | 逐版完整快照 + 词级比对视图、媒体三方对账 + 点名清理、`security.log` 聚合与信号、`/ops` 页 | 写限流打断自检（E-9）、菜单清单写死（F-12）、CSV 换行造幽灵行（E-8） |
| 16 选型回头补账 | 按"先找现成仓库"重扫一轮：`diff`/`@rgrove/parse-xml`/`csv-*` 替换三处自研、`pdfjs-dist` 引入、`pin-guard` 精确 pin + 许可白名单 + 用途登记 | 排除现成日志栈与 ZIP 库的理由逐条落档（§三 3.4） |
| 17 部署硬化与出包 | 打包脚本改为 `api/` **每次现做**（`pnpm deploy --legacy --prod` + 收尾 `CI=true pnpm install` 复位）、修 SPA 兜底在点开头目录下 404、`verify-deploy` 台账断言改"等指定事件到齐"而非"有条数" | `send@1.2.1` 对整条路径做 `containsDotFile()`（A-6）、轮询退出条件太弱致假 PASS（F-17）、`deploy` 目标须为空且无 `--force` |
| 18 全站版本台账总表 | 在既有 `revisions.json` 上加聚合读端 `GET /api/ops/revisions` + `/ledger` 页（口径/流水/汇总三 pane，按档案与动作筛选），记忆化按数据代次失效，撤档行标 `alive=false` | 需求"各功能都要有视图化管理页与菜单"；逐档页看不出全站体积与孤儿历史（§四 4.9） |
| 19 使用体验与运维交付 | 桌面端批注栏标题横排（仅收起窄导轨竖排）、页眉去 `sheet-max` 居中改为铺满贴左；启动生成根目录 `口令.txt`（明文口令速查，gitignore + 打包排除，`BW_CRED_FILE=0` 可关）；新增 `USAGE.md` 使用说明书 + 详细 Nginx 建站指南 | 走查加两条几何断言（`writing-mode` 与页眉首元素距左），163→165；口令速查文件必须与 `.gitignore`/打包 FORBIDDEN 同步，否则公开仓库会泄露明文口令 |
| 20 Windows 桌面仪表盘 | 自带 csc.exe 现编的 WinForms 面板（26 KB、零新增依赖、不动许可台账）：手动启动端口一律留空必填、不合法则启动按钮禁用；六行环境体检（目录/Node≥20.19.0/pnpm/依赖/dist/数据），只代跑站点自己的 install/build/seed，装系统软件只开官方下载页；`--autostart` 沿用已确认端口、无记录时不猜端口；`install.cmd` 登记 HKCU 登录自启 + 开始菜单快捷方式，`uninstall.cmd` 只撤这两样；`dashboard/` 入部署包但不预置 exe | 需求"每次填端口"与"开机自启"冲突，取舍写成口径；LF-only `.cmd` 被 cmd.exe 劈开执行（A-7）；UIA 对 WinForms 报 `Pane` 且不支持 Value/InvokePattern，只能物理点击 + 用 `Name` 断言（A-8）；端口占用改直接拒绝 |
| 21 部署包自足性修复 | `pnpm deploy` 改 **hoisted 平铺**（`--legacy --prod --config.node-linker=hoisted`）；出包加三条硬 gate：包内 `api/node_modules` 软链接数为 0、把 `api/` 拷进 `%TEMP%` 下**祖先无 `node_modules`** 的位置真起后端并请求 `/api/menu`、包内每个 `.cmd/.bat` 必须 CRLF + 零高位字节；仪表盘"依赖"体检改为逐个解析启动期 import（11 个说明符）而非看目录存在 | 已发布的 v1.0.0 包本身缺 `ip-address`，用户在远程机上起不来才发现（A-10→A-11）；**验收跑在仓库树里被根农场静默兜住＝假通过**（A-11），这正是 F-13"要证明因真实原因通过"在交付层的形态 |
| 22 Windows 一键安装包 | `installer/` 七个脚本 + 一个 `.ps1`：`setup.cmd` 串起 ①环境（`env.cmd`，Node≥20.19.0 逐段数字比、winget 装 LTS、缺 winget 或下载失败退回打开官方页）② 部署（`deploy.cmd`，robocopy 且 `/XD api\data`、目标机现编 exe、拒绝"拷到自己"）③ 自启（`autostart.cmd` 注册 `BianwangSite` ONSTART/SYSTEM + `BianwangDashboard` ONLOGON 两个载体，`run-site.cmd` 按 `port.txt`→`dashboard.cfg`→**拒绝并写日志**取值）④ 实活检查；`uninstall.cmd` 按用户口径**全删含 `data`**（要 `DELETE`、可先拷数据）；`creds.ps1` 按码点拼中文口令文件名 | 提权检查曾挡住只读的 `/status`（已提到闸门之前）；`ops-extras/start-api.cmd` 带着 34 个裸 LF 发布过（A-7 复发，现已做成出包硬校验：包内所有 `.cmd/.bat` 必须 CRLF + 零高位字节）；批处理六条语法定律（A-12）；自删脚本读不到后续行（A-13） |
| 23 一键安装包完整实跑 | 从**仓库树外**解压真包跑全流程：环境（含把闸门抬到 `>=99` 逼出"太旧"与"无 winget"两条分支，rc 2/3）、部署（七目录 + 现编 exe + `/` 200 + `/api/menu` 200 + `口令.txt` 落站点根）、三条拒绝分支（源码仓库里部署 rc 1 / 包拷到自身 rc 6 / 无端口记录 rc 2 且不猜端口）、端口占用幂等（already serving rc 0）、卸载（`/quiet` rc 0 留档 · `DELETE` rc 0 全删自清 · 删前拷贝带标记文件实测存活）、验收（包内 `ops/verify-deploy.mjs` 只读 26 项与 `--mutate` 36 项全绿）、`creds` 三态 | 抓到两个真 bug：`creds.cmd /root` 对读不到的目录打印 `[ok] found` 且 rc 0（A-14：非终止错误 + 空值继续跑），开机任务被拒时把还能成的登录任务与起站一起放弃（A-15，已改降级）；**提权后 `schtasks /ru SYSTEM` 在 Windows 11 客户端仍被拒**，故 `ONSTART` 成功那条仍未验证（R-15） |
| 24 发布形态收敛到 1.1.0 | 版本 1.0.0 → **1.1.0**（三处 `package.json` 同步），releases 只留**一键安装包 + 源码**两种形态（D-15），撤下 `nginx-html-webdist.zip` 与单摆的 `BianwangDashboard.exe`；旧 v1.0.0 的 **release 已删除**（三个资产一起撤下；`v1.0.0` 这个 git tag 保留，作为版本历史的锚点） | v1.0.0 那个包是发出去才知道坏的（A-11），留着等于摆一个已知装不上的产物；单摆 exe 又违背"不预置二进制"（A-6），两处都是同一类错误：**把可从源码现做的东西当成制品冻结** |
| 25 一键安装包收成"一个 exe" | `installer/Installer.cs`（WinForms 四段：自检 / 安装 / 自启选择 / 维护）+ `build.cmd` 目标机现编 + `setup.cmd` 变引导器（现编 → `--ping` 重试 → 开界面，`/cli` 保留线性四步）；`autostart.cmd` 加 `/site:boot\|none` 与 `/dash:on\|off`，"登录后自动起"改走 HKCU Run（免管理员）；出包加**第五道硬闸：包内零 `.exe`** | 用户要求"完整的、带自检/安装/自启选择的 exe 程序"（D-16）。实跑抓到三条"会撒谎的检查"（A-17：更新被 `deploy.cmd` 判成自己拷自己 rc 6 · 祖先链把被测目录自己算进去 · 端口三态判反）和一条管道继承缺陷（A-16：`start /b` 起的站点扣住调用方 stdout，四种写法全测过都不行，改由安装器 ShellExecute 另起会话）；另外记下"刚编出的 exe 立刻执行会被实时扫描拒绝访问"这条机器差异 |
| 26 全局访问协议（HTTP/HTTPS） | `dashboard/Dashboard.cs` 第一栏加「访问协议」两档 + 「TLS 由谁终结」+ 证书框 + 自签一键生成（系统自带 `New-SelfSignedCertificate`→pfx，非管理员可成）；协议写进 `dashboard.cfg` 的 `scheme`/`tls_from`/`tls_pfx`，被 `server/src/index.js`（`resolveTls()` → `https.createServer`）、`installer/run-site.cmd`（证书不在 → rc 4 拒绝起站）、`installer/Installer.cs`（自检第 11 项「访问协议」+ 探针按协议走）三层读取；新增 `nginx/bianwang-http.conf`（没证书时的 Nginx 装法，防护齐、故意不发 HSTS）；会话 cookie 的 `Secure` 改为按请求真实协议判 | 用户要求"全局"的协议可选，且明确"生产暂无证书、默认必须 HTTP"（R23 / D-17）。实跑四态各得其所（§4.12：https 下整站 200、按 http 访问被拒、自签被真实信任链拒 → 界面上那句告警是实测）。抓到三条新问题：`.NET 4.x` 探针不开 TLS 1.2 会把活站判成"无应答"（A-19）、node 子进程 UTF-8 日志被按 OEM 码页解成繁体乱码（A-20，同一族乱码的第 5 个根因）、`NODE_ENV=production` 硬加 `Secure` 会把"生产 + 无证书 + HTTP"打成登录静默失败（R-16）。全量自检复跑：接口 48 项、隔离实例 219 项（含新加的两条 Secure 判据）全绿。未验：证书路径含中文时 `run-site.cmd` 读不到（界面已警告） |
| 27 含安装器 exe 的包形态 | `make-nginx-package.mjs --with-exe` → `bianwang-<版本>-installer-win.zip`（默认包全部内容 + 本次现编的 `installer\BianwangInstaller.exe` + `EXE-SHA256.txt`，仪表盘仍目标机现编）；`Installer.cs` 的「部署包完整性」分辨三态并重算摘要比对（不一致判失败）；`Site` 记 `target.txt` | 用户要求"包里含 installer exe 与要部署的源码"（R24 / D-18，与 D-15 的张力用"强制现编 + 可核对摘要"化解）。实跑抓到两条：`.exe` 被运行态过滤规则从 `SHA256SUMS.txt` 里抹掉，唯一制品恰好验不到（A-21）；`--install --target` 之后 `--autostart` 不带 target 会指向默认目录，装在 A 自启在 B（A-22）。九步端到端全绿（§4.13）。**同日 11:0x 复验最终包时另抓到一条**：解压在 `%TEMP%` 里的那份 exe 一执行就消失（360 主动防御处置，仓库树内同摘要的那份正常）——A-24 / R-17，文档因此把"解压到常规目录"写进入口说明，并把零 exe 形态继续作为默认交付 |
| 28 交付 zip 的跨平台可解性 | 新增 `scripts/make-zip.ps1`（.NET `ZipArchive` 逐条建条目、`\`→`/`、压完读回中央目录做两条硬判：`\` 条数与**非 ASCII** 条数都必须为 0）；`make-nginx-package.mjs` 不再调 `Compress-Archive`；三本自产演示册的**文件名**改 ASCII（`bianwang-demo-*`），**标题**保持中文；`SHA256SUMS.txt` 的 `api/node_modules` 聚合值改成 `# 注释行`，比对算法挪进 `MANIFEST.md` | 复验含 exe 的包时顺手量的：`Compress-Archive` 的 2463 条条目全用 `\`，Linux `unzip` 会解成一堆带反斜杠的平面文件，而 DEPLOY §二 的 Linux 路线就写着"用这个包"；非 ASCII 条目名按 cp936 写且不置 UTF-8 flag（.NET Framework 无 `entryNameEncoding` 重载可掰），Explorer 正常而 `unzip` 乱码，受影响的正是镜像站**按文件名找实体**的三本演示册（A-25）。聚合行格式合法却指向不存在的"文件"，害 `sha256sum -c` 整包退出码 1（A-26）。回环验证：`unzip` 解包 → 2449 个文件齐、`sha256sum -c SHA256SUMS.txt` 123 条全 OK；api-smoke 48/48 与 full-sweep 219/219 改名后复跑不变 |
| 29 离线完整安装包（Electron 运行时 + 安装器，NSIS 单 exe） | 用户指定形态（D-19）。新增 `installer\runtime.cmd`（运行时统一判定：随包的 `runtime\BianwangRuntime.exe` + `ELECTRON_RUN_AS_NODE` 赢，否则 PATH 上的 `node`，低于 20.19.0 拒绝）并接进 `env/deploy/run-site/creds/uninstall/setup` 六个引擎；`deploy.cmd` 认 `/inplace`（就地安装只核对 + 播种 + 现编仪表盘，不再 robocopy 400 MB）并把 `runtime` 纳入拷贝清单；`installer-app/`（Electron 主进程 + Yan archival 四段界面，只做呈现与决策，动手仍是那七个 `.cmd`）；`dashboard/Dashboard.cs` 的四处 `node.exe` 收成一个 `NodeStartInfo()`，随包运行时也能被体检与启动；新增 `installer\offline.nsi` 与 `scripts\make-offline-package.mjs`（外部二进制按 sha256 取用、`.exe` 白名单、依赖清单三处同源、编完回查产物）。WinForms 安装器（`Installer.cs` + `build.cmd`）退役，交付只剩离线包 + 源码 | 本机实跑：站点那半六道闸全过（2448 文件、孤立自足性 `/api/menu` 200、CRLF+ASCII、软链接 0）；离线树内用**随包运行时**跑通 自检十项 → 就地安装（`deploy /inplace`）→ 起站 → `/api/menu` 200，`installer-app` 的引擎调用与 UTF-8 逐行回显按 A-28 修正后可用；`installer-app` 界面经 CDP 真点（10 项自检绘制、四段切换、`实访核验` 按钮 rc=0、页面异常事件 0、截图留证）；`BianwangRuntime.exe -v` = v24.21.0，依赖探针 11 项真 import 成功；产物 `bianwang-1.1.0-offline-win.exe` **179,366,878 字节（171.1 MB）**，sha256 `84acedf83d5496c7b0408961a62df93ad75de1f1fef269227b9a06c0e0b1b266`（**这是本轮第一件**，包内说明与引擎注释随后又被修正，最终交付见第 30 阶段——摘要跨轮没有可比性，A-23）。⚠️ 未验：真机双击过 UAC/SmartScreen 的完整安装体验、Win10 与 Server 2019 实机、`ONSTART`+`SYSTEM`（R-19 / R-15） |
| 30 离线包收口：退役形态的口径清干净 | 删掉 `make-nginx-package.mjs` 的 `--with-exe` 支路（第五道闸收成"站点树零 `.exe`"）；`make-offline-package.mjs` 加 `rewriteDocs()`（改掉包内 `README-FIRST.md` 那句"用 csc 现编安装器"的假说明，给 `MANIFEST.md` 补 `runtime/` 行并写明两半各由哪个摘要自证；找不到那段旧文本就拒绝出包，A-31）；`installer\autostart.cmd` 四处注释与提示改指 `runtime\BianwangRuntime.exe`；README §一·七·九 / USAGE §10 / DEPLOY §一B·六 里"双击 `BianwangInstaller.exe`"、"`--selfcheck` / `--live` / `--autostart`"、"九步实跑"全部换成当前形态，历史数字退回 DEVELOPMENT 并标"上一轮"；§4.11.1 · §4.13 · D-16 · D-18 · R-17 逐处加"已被 D-19 取代"；新增 §4.14.1 | 三套自检**串行复跑** 48/48 · 219/219 · 165/165（控制台零输出）；对**离线树**用随包运行时起后端跑 `verify-deploy`：只读 26 项 0 失败、`--mutate` 含写 36 项 0 失败；依赖守卫与 `pnpm audit:ui` 同轮 PASS；九个 `.cmd/.bat` 重新量过 CRLF 与高位字节。最终产物 **171.1 MB 量级**（摘要只看当轮 `SHA256SUMS-offline.txt`，理由见 A-32）。⚠️ 仍未验：真机 UAC+SmartScreen 首次安装、Win10 / Server 2019 实机、`ONSTART`+`SYSTEM` |
| 31 项目目录去冗余（用户指示） | 删掉退役形态的产物：`bianwang-1.0.0-nginx{,.zip}`（就是装不上的那版）、`bianwang-1.1.0-installer-win{,.zip}`、`outputs/nginx-html-webdist.zip`、仓库根散落的 `bianwang-1.1.0-nginx.zip`；连同轮的取证目录 `.scratch-*`（14 个，含 61 张文档按名引用的截图——选项给过"只留截图"，你选了"全删"）、`outputs/*.log`（31 份）与出包缓存 `outputs/package/.api-deploy`。**保留**：根目录 `口令.txt`（你不删）、当前这轮的站点树与离线 exe、`outputs/backup-2026-09-29-examples/` | 53 条点名路径、**1.63 GB**；逐条打印体量，删前记文件数（2444 / 2451 / 2388…）删后核对；内容目录计数无变化（`web/src` 51 · `server/src` 28 · `server/data` 31 · `installer` 14 · `installer-app` 9 · `nginx` 3 · `ops-extras` 7 · `scripts` 10），未跟踪清单只剩该提交的源码与新脚本。截图与 registry 原始件的锚点已就地改成"本机取证已清理，事实以本文为准"（§3.4 把可复核性挪到 `pin-guard` 上），不留假指向；删完**重出一次包**让"包内文本＝仓库文本"成立（§4.14 末两行） |
| 32 全自动验证清单跑出的三处缺陷 | ① **E-10**：`securityHeaders()` 里 HSTS 与 CSP `upgrade-insecure-requests` 只按 `NODE_ENV=production` 发 → 明文 HTTP 的生产档被浏览器把每个请求改写成 https、整站白屏；改成与会话 cookie `Secure` 同一条判据（`req.secure`，Nginx 已传 `X-Forwarded-Proto $scheme`），并与 `nginx/bianwang-http.conf` 那句"HTTP 版故意不发 HSTS"对齐。② **F-19**：走查脚本悄悄读一个手工摆在 `.scratch-verify/` 里的 PNG 夹具，上一轮清理把它删了 → 三项上传断言判红；现在 `writePngFixture()` 每轮现场生成（163 字节，满足 `sniffImageType()` 的魔数与 `maxImageBytes`），路径与体量进断言 detail。③ **A-33**：`SHA256SUMS-offline.txt` 用 CRLF 写，`sha256sum -c`（包内 `MANIFEST.md` 教的核对命令）把 `\r` 当文件名 → `FAILED open or read`、退出码 1；改 LF 并写完立刻读回断言格式 | 浏览器实测取的是**内网 IP**而非回环（回环属"可信来源"，Chrome 不对它执行升级，这正是该缺陷能活到现在的原因）：修前 7 请求 / **6 条被改写成 https** / 6 个 `ERR_SSL_PROTOCOL_ERROR` / `/api/` 一条未发、页面空白；修后 **16 请求 / 0 改写 / 0 失败 / 5 条 `/api/`**、标题渲染成"卷首 · 档案瀑布"；带 `x-forwarded-proto: https` 时两档头都回来（curl 逐头核对）。自检由 219 → **221**（F-20 那对成对断言，同时把原来那条"生产模式带 HSTS"的错误判据拆掉）；三套串行复跑 **48/48 · 221/221 · 165/165**；出包（站点半六道闸 + 离线三道闸 + NSIS）后**对交付树本身**用随包运行时绑 `192.168.10.11:8792` 复测：浏览器 16 请求 / 0 改写 / 0 失败、`verify-deploy` 只读 26 与含写 36 各 0 失败、包内文本与仓库文本逐字节 33 件差异 0（§4.14 与 README §九同一行）；文档四处口径同步（README 防嗅探与 `NODE_ENV` 行、DEPLOY §四 两份 Nginx、DEVELOPMENT §4.1 表与 R-16）。⚠️ 仍未验：真机 UAC+SmartScreen 首次安装、Win10 / Server 2019 实机、`ONSTART`+`SYSTEM`（R-15 / R-19），以及**经真 Nginx 终结 TLS 后**这两档头的端到端表现（本轮只到"转发头判据"这一层） |
| 33 版本 1.1.1 与 releases 清单按交付形态重整 | 四处 `package.json`（根 / `server` / `web` / `installer-app`）1.1.0 → **1.1.1**；出包脚本的版本只从根 `package.json` 读，产物名随之变成 `bianwang-1.1.1-{nginx.zip,offline-win.exe}`；`scripts/check-package-parity.mjs` 的默认树路径**改成从版本推导**而不是写死 `1.1.0`（写死的话升版后比的是上一件，等于自欺）；`USAGE.md` 里唯一一处写死的包名改成 `bianwang-<版本>-nginx.zip`。发布侧按"只剩两种交付形态"重整：新建 **v1.1.1** release 挂离线 exe 与 `SHA256SUMS-offline.txt`，源码档用该 tag 自动生成的 Source code 包；`v1.1.0` 的 tag 与那条 release **原样不动**（用户选定"另开 v1.1.1"，不改写已发布的 tag），只在说明里标注它的资产 `bianwang-1.1.0-nginx.zip` 属已下线形态、请以 v1.1.1 为准，Latest 让给 v1.1.1 | 重出后同样跑满：站点半六道闸 + 离线三道闸 ✓、zip 解到仓库树外 `sha256sum -c` rc 0、`SHA256SUMS-offline.txt` rc 0、`check-package-parity.mjs` 全 SAME、随包运行时绑内网 IP 起交付树复测浏览器与 `verify-deploy` 26/36。**摘要不写进本文**（A-32），看当轮 `SHA256SUMS-offline.txt` 与 Release 说明那一行 |

---

## 十、待办与可扩展（未做，按性价比排序）

本轮已完成并验证的项从这张表里划掉：**PDF 在线阅览**（§四 4.4b）、**镜像站架上检索**（§四 4.4）、
**档案版本化与两版比对**（§四 4.7）、**媒体 GC 可视化 + `security.log` 聚合**（§四 4.8，落在 `/ops`）、
**依赖精确 pin 与许可守卫**（§八 `pin-guard`）。剩下的：

1. **EPUB 矢量与公式**：若要保真，需要一条"受控 SVG 光栅化"或"仅本站可信书目放宽"的路径——**不能**靠放宽 CSP（R-6）。
2. **阅览进度持久化**：目前书签只体现在 URL；可加"上次读到第几章"的**本地**记忆（`localStorage`，写侧要兜 `setItem` 抛，见 B-4），
   不要做成服务端状态——那会把"游客可读"变成"每人一份写"。
3. **PDF 版面复现**：D-11 的代价（扫描件空、版式不复现）若真成问题，方案是客户端 pdf.js 渲染 + 单独评估许可与体积。
4. **正文级检索**：架上检索目前只到元数据与章节标题。开正文检索等于给已解锁者一个"按关键词批量摘取全书"的放大器（R-9），
   要先定"能不能命中整段、返回多少上下文、按 IP 记不记审计"。
5. **台账导出**：版本比对与媒体对账都只能在页内看，缺"导出 CSV/JSON 给外部审计"的一键口（导出即分发，需与 R-3/R-5 一起想）。
6. **CKEditor 升级窗口**：不是"等升级"，而是**按 §八 8.1 的 SOP 走**——四道闸（pin 守卫 → 构建 → 两套接口自检 → 浏览器走查）
   任一红就回退，不许为了过测改业务代码去绕新 API。48.x 已改过两轮转换/选区 API（C-3、C-4），下一轮迟早来。
7. **规模上限**：档案上千本后单文件读写与索引重建变慢（R-8），届时按 README §三 的判据换库，而不是"重建索引"当性能手段。
8. **开机自启的 `ONSTART` 成功路径要在目标机上补验**（R-15）：本机已提权跑到注册这一步，但
   Windows 11 客户端的 `schtasks /ru SYSTEM` 被策略拒绝（A-15），所以"任务建成 → 重启 → 登录前站点可达"这条链**仍未正面验证**。
   要在**真正的 Windows 10** 与 **Server 2019** 上各跑一次：双击离线包 → 界面第 3 段选**"开机即起，无人登录也可访问"**（或纯命令行 `installer\setup.cmd /cli`，它默认就是这一档）→ 重启 → 确认登录前
   `http://127.0.0.1:<端口>/api/menu` 就返回 200。**离线包顺带解掉了一条旧前提**：`SYSTEM` 的 PATH 里有没有 Node 从此不重要了（`run-site.cmd` 先解析 `runtime\BianwangRuntime.exe`），
   只有你删掉 `runtime\` 换系统 Node 时才要按机器范围装。Server 2019 还要额外走一遍"没有 winget"那条退回指引（那一档只在没有随包运行时的树上才走得到）。
   客户端机若也被拒，选"登录后自动起"（写 HKCU Run，免管理员，界面会替你把 rc 4 降级成这一档）或服务包装器（后者先核许可）。
9. ~~**三套自检要在离线包这一轮复跑**~~（**每轮收尾都要串行复跑，不看"改了哪一侧"**：本轮改到 `server/src/security/middleware.js` 与走查脚本，接口 48/48 → 全量 **221/221**（新增 E-10 那对成对断言）→ 走查 165/165、控制台零输出；另对离线树补跑 `verify-deploy` 26 只读 + 36 含写，见 §4.14）。
   留这条划线记录是因为它暴露了一个口径问题：改 `installer/` 与 `dashboard/` 时 `server/`+`web/src/` 一行没动，
   很容易就"沿用上一轮数字"——**沿用不等于验过**，收尾时要么复跑，要么在文档里明写"本轮未复跑"。