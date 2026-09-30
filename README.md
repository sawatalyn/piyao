# 辨妄阁 · 辟谣档案库

类 wiki 的图文辟谣站点：以 **谣言 ↔ 辟谣双栏对勘** 为基本体例，重点处可画圈与划线，材料源逐条登记出处。
前端 pnpm + Vue 3 + Vite 8 + Pinia 4 + Vue Router 5，后端 Express 5 + JSON 文件存储，Nginx 托管。

界面语法取自 `terra-faction-ui` 技能包的 **Yan / 炎国 archival** 家族，深度 **maximal（最高规格）**，
色域固定在 `neutral-light-ink-paper`（纸白 / 墨黑 / 矿物灰，印朱仅用于承诺态）。
这是证据驱动的 Terra 阵营界面（受《明日方舟》世界观启发），**不是**任何官方界面，未使用任何官方标识或美术资源。

> 文档分工：本 README 讲**是什么与怎么用**；[`USAGE.md`](USAGE.md) 是**馆员使用说明书**（新增图文、入馆口令、用户与菜单管理、Nginx 建站）；[`DEPLOY.md`](DEPLOY.md) 讲**怎么上线**；
> [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) 讲**用了谁的什么**；
> [`DEVELOPMENT.md`](DEVELOPMENT.md) 是**开发纪实**——需求落地对照、技术选型理由、决策记录、踩坑实录与风险警示。

**许可证：GPL-2.0-or-later**（见 `LICENSE`）。因前端组合了同为 GPL 的 CKEditor 5，公开分发时整份源码按同一许可释出；
其余依赖均取自宽松许可白名单（MIT / Apache-2.0 / BSD / ISC），逐条出处与用途见 §八 与 `THIRD_PARTY_NOTICES.md`。

---

## 一、快速开始

> **一键启动（从源码）**：Windows 双击仓库根目录的 **`start.cmd`**，macOS / Linux / WSL 执行 **`./start.sh`**——
> 脚本只补做还缺的步骤（装依赖 → 写演示数据 → 构建 `web/dist` → 生产模式单端口起在 8787）。
>
> **不想用命令行？** Windows 上还有图形仪表盘：双击 **`dashboard\install.cmd`** 装好后运行
> `BianwangDashboard.exe`，填端口点一下就把站起起来，并可登记登录自启；它只用 Windows 自带的
> .NET 编译器现编，**不新增任何 npm 依赖**，也不预置二进制。详见 [`USAGE.md` §9](USAGE.md)。
>
> 下面是手动分步，等价于脚本做的事。

```bash
# 1. 安装依赖（.npmrc 已配 127.0.0.1:7897 代理，可按需删除）
pnpm install

# 2. 写入出厂示例（6 条档案 + 4 张演示图片 + 话题表 + 13 条资源库 + 3 本自产演示册 + 示例用户 + 每条档案一份建档快照）
node server/scripts/reseed.js

# 3. 开发模式：后端 8787 + 前端 5173（前端已配 /api 代理）
pnpm dev
#   打开 http://127.0.0.1:5173

# 4. 生产构建 + 单进程自测（Node 直接伺服 dist，便于无 Nginx 时验证）
pnpm build
NODE_ENV=production node server/src/index.js
#   打开 http://127.0.0.1:8787

# 5. 接口自检（48 项：权限、置顶唯一、净化、限流、签名直链、反爬、版本与馆务端点、全站版本台账总表…）
node scripts/api-smoke.mjs
```

默认账号 `admin` / 默认口令 `admin`。**首次登录后请立即改密。**

> **口令速查**：服务启动时会在项目根目录生成 **`口令.txt`**，列出全部登录账号口令与镜像站入馆口令，方便本地查阅。
> 它含明文口令，已被 `.gitignore` 与打包排除（绝不入库/入部署包）；不需要时设 `BW_CRED_FILE=0` 关掉，上生产前请删除并改密。

> **一台干净的 Windows 机器，什么都不想装？** 解压 `bianwang-<版本>-nginx.zip`，用**管理员** cmd 跑
> `installer\setup.cmd`：它按顺序做完**环境检测/装 Node → 部署程序 → 注册开机自启（后端 `ONSTART`/SYSTEM + 仪表盘 `ONLOGON` 两个计划任务）→ 起站并实访 `/api/menu`**，
> 每步幂等、任一步失败就停下报是哪一步。卸载用 `installer\uninstall.cmd`（**默认全删含 `api\data`**，要打出 `DELETE` 才动手，可先拷一份）。
> 单独一步也有对应脚本：`env.cmd` / `deploy.cmd` / `autostart.cmd` / `creds.cmd`。详见 [`USAGE.md` §10](USAGE.md)。

出厂示例账号另有一名 `demo` / `demo-pass`（角色 editor，显示名「示例馆员（可删除）」），
用于让用户名册在初始状态就有可改可删的对象；`/users` 页可直接移除它。
**每项功能都随包附一份实体示例**（对勘图文、原始载体与材料源链接、资源库条目、可在线阅览的 EPUB 与 PDF、
建档版本快照、菜单与卷次顺序），清单见公开页 `/about` 的「出厂示例」表；演示链接一律取 RFC 2606 保留域
`example.org`，不冒充真实文献。

| 脚本 | 作用 |
| --- | --- |
| `pnpm dev` | 前后端并行开发 |
| `pnpm build` | 生成许可登记表 + Vite 产物到 `web/dist` |
| `pnpm start` | 生产模式启动（同时伺服 `web/dist`） |
| `pnpm seed` | 重置演示数据 |
| `pnpm smoke` | 接口端到端自检 |
| `pnpm audit:ui` | 阵营界面契约审计 |
| `pnpm walkthrough` | 真实浏览器端到端界面走查（165 项断言 + 截图，见"九、验证"） |
| `pnpm guard:deps` | 依赖守卫：全部声明精确 pin、许可在宽松白名单内、用途与出处已登记（`prebuild` 自动跑） |
| `pnpm package` | **部署包预演**：列出包内去向，并点名哪些运行态被挡在包外（不写文件） |
| `pnpm package:zip` | 生成 `outputs/package/bianwang-<版本>-nginx/` 并压成 zip（解压即上 Nginx） |
| `pnpm verify:deploy <url>` | 部署后验收（默认只读；`--mutate` 才走写链路，跑完自清），报告落盘 |

> `pnpm package:zip` 里包内的 `api/` 每次**现做**（内部跑 `pnpm --filter server deploy --legacy --prod --config.node-linker=hoisted`，
> 依赖平铺成无软链接的实体目录），不会复用上一轮的 deploy 快照；出包末尾还有三道拒绝出包的硬闸
> （包内软链接数为 0 / 拷到 `%TEMP%` 孤立位置真起一次后端 / 包内每个 `.cmd` 都是 CRLF 且纯 ASCII）。
> 出包后仍请**解压到另一个目录再跑一次 `verify:deploy`**（路径最好以 `.` 开头，
> 这么试过才能发现"站点被放进点开头目录"这类只在换机时才现形的问题，见 DEPLOY §一 与 DEVELOPMENT §六 A-6）。

> `pnpm seed` 只重写演示数据与 4 张固定 id 的演示图片（`demomedia01-04.png`，反复播种不会堆积新文件）；
> 此前经界面上传的图片文件仍留在 `server/data/media/`，索引里不再引用它们——
> 到 **`/ops` 馆务台账**看"磁盘孤儿"清单，逐个点名"先预演"再确认清理（默认只预演，一个字节都不动）。
> 各数据文件的行为不同：`posts/tags/media-index` 整表重置；`resources.json` **只补入缺失的种子条目**（人工登记的保留）；
> `library.json` 与 `library-keys.json` **整表重置为占位条目**，会抹掉真实书目与已签发口令。
> `users.csv` 不同：仅在缺失时补入 `demo` 一行，**任何已存在口令都不会被覆盖**，改过 admin 密码后重跑 seed 也不受影响。
> 因此正式环境请勿在已有真实档案、书目或口令的机器上跑 seed。
> 换完文件**不必重启进程**：列表、检索索引、资源库与镜像书目都按数据代次自动失效重建（`full-sweep` 有对应断言）。

## 二、目录

```
web/        Vue3 前端（外壳四段式、视图、编辑器、样式令牌）
  src/styles/     tokens / base / controls / motion / layout —— 阵营语法与深度语法分层
  src/modules/    registry.js 功能模块注册表（菜单与权限的唯一事实源）
  src/stores/     Pinia：ui / auth / catalog / menu / resources / library
  src/views/      含 LibraryView（镜像、口令与架上检索）· ReaderView（EPUB/PDF 在线阅览）
                  · RevisionsView（逐档版本台账与两版比对）· OpsView（馆务台账）· LedgerView（全站版本台账总表）
  src/directives/ reveal.js   共享 IntersectionObserver 懒加载
  src/composables/useWaterfall.js 保序瀑布流
server/     Express 5 + JSON 文件存储
  src/store/      jsonStore(原子写) / posts / menu / users(CSV) / sessions / resources / library
                  / revisions(逐版快照与比对) / mediaInventory(三方对账与点名清理)
  src/library/    zipRead(ZIP 中央目录与定点解压) / epubRead(spine 分页与阅读净化) / pdfRead(书签分节与文字层)
  src/security/   middleware(头/CSRF/反爬) / media(魔数+签名) / sanitize / audit / logInsight(日志聚合)
  src/search/     vectorIndex（MiniSearch + 中文 bigram 分词）
  src/routes/     auth / content / media / resources / library / ops
  data/           posts.json · tags.json · menu.json · users.csv · resources.json · revisions.json ·
                  library.json · library-keys.json · media/ · media-index.json · library/ · security.log
nginx/      站点配置与安全片段
dashboard/  Windows 图形仪表盘：Dashboard.cs（WinForms 源码）+ build/install/uninstall.cmd
            exe 由目标机自带的 csc.exe 现编，不入库也不入部署包
installer/  Windows 一键安装（只进部署包，运行态 port.txt/run-site.log 不入库）：
              setup.cmd     四步串起来的一键入口（环境→部署→自启→实访校验）
              env.cmd       检测 Node/pnpm/winget，/install 时经 winget 装 LTS，失败退回官方页
              deploy.cmd    包 → 运行位置，robocopy 且 /XD 保住 api\data，目标机现编 exe
              autostart.cmd 注册 BianwangSite(ONSTART/SYSTEM) + BianwangDashboard(ONLOGON)，/status 免提权
              run-site.cmd  开机任务执行的脚本：端口只认 port.txt→仪表盘记忆，都没有就拒绝起
              creds.cmd     打开中文命名的口令.txt（文件名由 creds.ps1 按码点拼，批处理里不写中文）
              uninstall.cmd 全删含 api\data，需输入 DELETE，可先拷数据；/quiet 只停不删
ops-extras/ 部署包附件：环境变量样例、systemd 单元、起停脚本、部署后验收脚本（verify-deploy.mjs）
scripts/    许可登记表生成 · 依赖守卫 · 接口自检 · 全量体检 · 浏览器走查 · 部署包生成
```

## 三、存储选型：为什么最终是 JSON

需求要求"优先 JSON，若无法动态无刷新呈现才换数据库"。实测结论：**JSON 足够**，
因为动态性来自「后端 API + Pinia 响应式状态」，而不是存储介质：

- 写入用「临时文件 + 原子改名」，读改写按文件排队，避免并发丢写；
- 内存常驻一份状态，改动即时可读，磁盘写异步串行落盘；
- 检索索引常驻内存，写档案后置脏、下次查询重建，因此**新增/修订/置顶/重排均无需刷新**即反映到列表与搜索；
- 话题 tag 表（`tags.json`）由档案自动汇总，供向量检索与话题索引页消费；
- **档案版本台账**（`revisions.json`）同样落在 JSON 文件上：每次建档/修订追加一条完整快照，
  每档保留最近 `BW_REVISION_KEEP` 版；清单接口只回头信息、比对时按需取两版，因此它不拖累列表与检索。
  实测无需数据库（风险与上限见 `DEVELOPMENT.md` §七 R-8、R-13）。

因此未引入向量数据库。若后续档案量到万级或需要跨进程共享索引，再把 `vectorIndex` 换成外部向量库即可，接口不变。

## 四、功能与需求对照

| 需求 | 落点 |
| --- | --- |
| 类 wiki 排版、对比项 | `PostView` 的 `.collation` 双栏 + 中缝界栏；首页卡片同时呈现标题与谣言 |
| 图文编辑（标题/谣言/辟谣/材料源） | `EditorView` 四叶折叠文书：标题与判定 · 谣言案例 · 辟谣内容 · 材料源与批注 |
| 富文本与图片画圈、下划线，默认红、可变色 | `RichEditor`（基底 CKEditor 5 免费版；圈划/划线/解除标注/插图四枚按钮由 `editor/yan-markup.js` 自定义插件补齐，文字批注落 `.anno-circle/.anno-line` + 朱砂/藤黄/花青/墨四色，只用 class 不写行内样式）；`ImageAnnotator`（图上椭圆圈选与划线，存归一化矢量数据，详情页 SVG 复原） |
| 话题 tag 纯文本列表、用于向量搜索 | `TagField` + 后端 MiniSearch 索引（标题/话题加权高于正文） |
| 材料源可增删输入框 + 上传按钮 | `SourceRows`，登记来源机构、采集时刻、结论指向、附图 |
| 门户首页卡片瀑布流懒加载 | `WaterfallGrid`（DOM 顺序恒等于输入顺序，落位用最短列）+ 底部哨兵翻页 |
| 按话题 tag、标题模糊搜索 | 页眉全局检索、`/search`、`/tags`、首页话题条 |
| 登录、游客只读 | 路由守卫 + 后端 `requireAuth`；游客仅可读列表/详情/检索 |
| CSV 明文用户表、默认 admin/admin | `server/data/users.csv`，`/users` 页读写；`BW_HASH_PASSWORDS=1` 可切 scrypt |
| 每项功能都配一份可删可改的实体示例 | `server/scripts/reseed.js`：6 条对勘图文（含圈划/划线/图上批注/材料源出处链接）、`demo` 示例馆员账号、13 条资源库（含 1 条站内路径 `/library`）、3 本自产演示册（一本仅下载、一本五章可逐章阅览、一本带书签可逐节阅览）、每条档案一份"建档"快照；清单公开在 `/about`「出厂示例」表 |
| 置顶唯一、自动解除原置顶 | `posts.setPinned`，接口返回被解除者标题并在界面提示 |
| 拖动重排序 | `/reorder`（SortableJS 把手 + ↑↓ 键盘等价操作） |
| logo 位置同参考图 | 页眉最左，`BrandMark.vue` 原始 SVG（版框 + 界栏 + 「辨」字） |
| 菜单编辑（暴露/隐藏） | `/menu-editor` 改可见性与顺序，`modules/registry.js` 定义功能本体 |
| 详情页修改 | 登录后可修订，仍走同一编辑器；每次修订顺带在 `revisions.json` 追加一条完整快照，详情页有「版本台账」入口 |
| header/sidebar/main/footer 四段 | header：批注栏开合 + logo + 搜索 + 登录登出 + 卷首索引；sidebar：重排序/菜单编辑入口（登录可见）+ **辟谣话题 tag 列表**（所有人可见）+ **辟谣常用资源库**（所有人可见）+ **洛琪希图书馆镜像**入口（所有人可见）；footer：框架与开源协议登记表（每行给出该框架官网或 GitHub 出处链接，地址由 `package.json` 的 homepage/repository 实测取得） |
| 辟谣常用资源库（无职转生专题） | `resources.json` + `/resources` 页 + 侧栏块：分五组（官方一手出处 / 中文区查证载体 / 访谈与翻译合集 / 事实核对工具 / 常见误传题材），每条记名称、入口、能核实什么、可信度；游客可读，登录用户增删改 |
| 洛琪希图书馆镜像（EPUB / PDF） | `server/data/library/` 存文件 + `library.json` 书目 + `library-keys.json` 口令；`/library` 页：目录对所有人公开，**输入口令后即可取书**；**在线阅览另需该书在预览白名单里**（登记时逐个勾选「允许在线预览」，管理面可随时开关，未勾选的书显示"仅可下载"）；口令由登录馆员签发/停用/吊销，可限范围与到期 |
| EPUB 在线阅览（按章节分页） | `/library/:id/read?c=&p=`：解析包内 `container.xml → OPF spine → nav/ncx`（XML 走 `@rgrove/parse-xml` 严格解析），**一章一个可阅览网页**；**10MB 以上的书只允许分页**（整本渲染接口直接 409），单章过长再按一~三级标题切成小节；正文经阅读白名单净化（丢脚本/行内样式/svg/form），插图改写为同口令门控的站内资产地址、按需懒加载；阈值以下另可选"全本通读"（单次输出另有 1MB 上限） |
| PDF 在线阅览（按书签分节） | 同一路由与同一口令链，`pdfjs-dist` 服务端读取：**分节取自 PDF 书签（outline）**，页眉按"第 x / y **节** · 第 m—n **页**"表述；**只出文字层、不做服务端光栅化**（页内无 `canvas` 与位图），因此扫描件在阅览页为空、版式不复现，需要核对版式请下载原文件 |
| 镜像站架上检索 | 口令解锁后出现检索面板，对**书名 / 作者 / 译者 / 磁盘文件名 / 章节（或书签）标题**做子串匹配；章节级命中直接带 `c=` 参数，点一下就到那一节；未进预览白名单的书不会被检索出来。**不检索正文**（避免"按关键词批量摘取全书"的放大器） |
| 档案版本台账 | `/post/:id/revisions`：每次建档与修订都存**完整快照**（每档保留最近 `BW_REVISION_KEEP` 版），任选两版逐字段比对，谣言/辟谣正文按**字与词**标出 `<del>`/`<ins>`（`diff` 库，两版差得过大会降级为整段呈现并明说）；档案被删不抹历史，台账仍可读 |
| 馆务台账 | `/ops`（登录可见）：① 媒体三方对账（磁盘 / `media-index.json` / 在档引用），分"在档引用 · 无引用记录 · 磁盘孤儿 · 索引死链"四栏，清理**默认只预演**、须逐个点名且 `confirm`，越界路径与仍被引用者一律拒绝；② `security.log` 聚合（按事件/IP/用户/日 + 需要盯的信号 + 最近条目），可筛选，只读不改写 |
| 全站版本台账总表 | `/ledger`（登录可见）：跨档案的核查视角，给出全站口径（版本总数 / 涉及档案 / 快照占用字节 / 每档保留数 / 已撤档仍在册数）、版本流水（可按档案与动作筛选，行链跳该档 `/post/:id/revisions`）与按档案汇总；聚合按**数据代次**记忆化，写入后台账即时跟上；**撤档不抹历史**，删掉的档案其历史版本仍在册并标为「已撤档」 |

## 五、安全与懒加载实现

**防攻击**：写操作需会话 + CSRF 双提交；登录按 IP 与用户名双维度限次（5 次锁 10 分钟，计数落盘、重启不清零）；
登录接口独立限流；富文本服务端白名单净化 + 前端二次净化；请求体 640KB、单图 5MB；登录蜜罐字段；
安全事件写 `data/security.log`（JSONL，超 512KB 逐级轮转，保留 5 份），
`/ops` 页可按事件/IP/用户/日聚合并列出"需要盯的信号"（登录失败与锁定、CSRF 拒绝、脚本型 UA 拦截、蜜罐命中、
媒体拒绝、口令验印失败/冷却/越权/越范围、未入预览白名单、签名被篡改等）；聚合只读，不改写日志。
写操作另有每分钟上限（`BW_WRITE_LIMIT_PER_MIN`，默认 40）。

**防嗅探**：Cookie `HttpOnly + SameSite=Strict`（生产加 `Secure`）；生产环境下发严格 CSP（无 `unsafe-inline`）；
Nginx 强制 HTTPS + HSTS + TLS 1.2/1.3；接口不回显口令列。

**防爬取**：图片走 HMAC 签名短时效直链（默认 30 分钟）；游客翻页 >20 页需登录；脚本型/空 UA 无会话即拒；
正文由接口以 JSON 提供给 SPA；`X-Robots-Tag: noindex`；Nginx 对数据目录与隐藏文件 deny 并关目录列表。

**懒加载**：路由级代码分割；卡片入场用共享 IntersectionObserver（命中即 unobserve，卸载即 disconnect）；
图片 `loading=lazy + decoding=async`；首页底部哨兵提前 480px 取下一批。

**在线阅览的取页边界**：ZIP 只读中央目录，正文按 local header 偏移定点取，**整本书从不进内存**；
解压走 `maxOutputLength` 上限（默认单条目 16MB）挡解压炸弹，加密条目与非 store/deflate 算法直接拒绝；
`p=` 参数只允许命中包内既有条目（`../`、绝对路径、带协议的一律不解析），下发的图片再按魔数复核，
SVG/PDF 之类可携带脚本的类型即使包内声明也不放行；每个响应都 `no-store`。
**PDF 走另一条边界**：`pdfjs-dist` 在服务端读，`getDocument({ isEvalSupported: false })` 关掉求值（读的是不可信文件），
分节取自 PDF 书签、正文只取**文字层**，**不做服务端光栅化**——页内既没有 `canvas` 也没有位图，
因此不担渲染的 CPU 与内存，代价是扫描件在阅览页为空、版式不复现（需要核对版式请下载原文件）。
两种书型的正文过**同一个**阅读白名单净化器，所以阅览页始终满足严格 CSP。
阅览令牌与下载同一枚（10 分钟），图片 src 里带的就是它——因此它会出现在访问日志中，与下载直链同一取舍；
前端把它存在 `sessionStorage`（随标签页关闭即清），所以正文里的跨章链接可以是普通的站内整页跳转，
刷新与直达链接都不必重输口令；令牌一旦被吊销或过期，接口回 403 时前端立即收回解锁态并回到口令门。

> 明文口令存储是需求指定项，属于已知取舍。公网部署前务必：改默认口令、启用 `BW_HASH_PASSWORDS=1`、
> 用 Nginx 的 `location ~ /\.` 与扩展名黑名单挡住数据目录。

## 六、环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `BW_PORT` / `BW_HOST` | `8787` / `127.0.0.1` | 后端监听；生产只监听回环，由 Nginx 反代 |
| `NODE_ENV` | — | `production` 时启用 CSP 与 `Secure` Cookie |
| `BW_DATA_DIR` | `server/data` | 数据目录 |
| `BW_SECRET` | 自动生成 `.secret` | 会话与签名密钥；多实例必须显式统一 |
| `BW_HASH_PASSWORDS` | `0` | `1` 时口令以 scrypt 存 CSV |
| `BW_SHOW_PASSWORDS` | `0` | `1` 时名册接口才回显口令列 |
| `BW_ALLOW_TOOL_UA` | `0` | `1` 时放行 curl/wget 等 UA（仅本机调试用） |
| `BW_LIBRARY_MAX_MB` | `120` | 镜像单本体积上限（MB） |
| `BW_READ_SPLIT_MB` | `10` | 超过该体积的 EPUB 强制按章节分页，不提供整本渲染 |
| `BW_READ_PAGE_MAX_KB` | `128` | 单页正文上限；一章过长按小节再切 |
| `BW_READ_WHOLE_MAX_KB` | `1024` | "全本通读"单次输出上限 |
| `BW_READ_ENTRY_MAX_MB` | `16` | 包内单个条目解压后的上限（防解压炸弹） |
| `BW_PDF_PAGES_PER_CHAPTER` | `12` | PDF 无书签时的退化分节粒度（每节最多几页） |
| `BW_REVISION_KEEP` | `30` | 每档保留的完整快照版数；超出后丢最旧的一版（台账是核查用，不是备份盘） |
| `BW_WRITE_LIMIT_PER_MIN` | `40` | 登录写操作每分钟上限；命中返回 429。批量导入/自检时可临时调高，**不要**在生产放宽 |

## 七、部署与获取方式

**发布只提供两种形态**（GitHub Releases 上就这两个资产，取舍理由记在 `DEVELOPMENT.md` 的 D-15）：

| 形态 | 拿它来做什么 | 里面有什么 |
| --- | --- | --- |
| **① 一键安装包** `bianwang-<版本>-nginx.zip` | 直接在一台机器上把站跑起来 | `api/`（后端 + 平铺好的生产依赖）· `web/dist/`（前端产物）· `dashboard/`（仪表盘源码，目标机现编）· `installer/`（**Windows 一键：环境/部署/自启/卸载**）· `nginx/` · `ops/`（含 `verify-deploy.mjs` 验收）· `docs/` · `MANIFEST.md` + `SHA256SUMS.txt` |
| **② 源码** （git clone 或 Release 页的 Source code 包） | 读代码、改代码、自己构建 | 完整仓库；需自备 pnpm 并按 §一 的四步跑 |

> 包内**不含任何运行态**：`.secret`（会话与图片签名主密钥）、`sessions.json`、`security.log`、`login-attempts.json`、
> `口令.txt` 都被出包脚本挡在包外并逐条打印；`api/data/` 会被整目录清空后按出厂种子重播。
> 也**不含预编译二进制**——仪表盘 exe 在目标机现编。

见 `DEPLOY.md`：构建 → 拷贝 `web/dist` → 配 Nginx（`nginx/bianwang.conf` + `bianwang-proxy.inc`）→ systemd 托管后端 → 备份数据目录。

**Windows 目标机可以整段跳过上面的手工步骤**：解压部署包后用管理员 cmd 跑 `installer\setup.cmd`
（环境 → 部署 → 两个计划任务自启 → 实访校验，一条命令做完，卸载用 `installer\uninstall.cmd`），
能力对照、Win10 与 Server 2019 的差别、端口与 `口令.txt` 的口径都在 [`USAGE.md` §10](USAGE.md)。
Linux 侧仍是 systemd + Nginx 那套；`installer/` 只处理 Windows。

> **拷机部署有一条硬规矩：只拷 `server/` 起不来。** pnpm 的依赖农场在仓库根的 `node_modules/.pnpm/` 里，
> `server/node_modules/*` 只是指向它的软链接，压缩解压会把包自身带过去、**兄弟依赖留下**，
> 于是换机才炸 `ERR_MODULE_NOT_FOUND: 'ip-address'`。部署包里的 `api/` 用 `--config.node-linker=hoisted`
> 平铺成实体目录（零软链接），而且**出包时会把它拷到 `%TEMP%` 下一个祖先目录没有任何 `node_modules` 的位置真起一次**——
> 只有真起来了、`/api/menu` 回 200 且拿得到条目才允许出包。这条闸是 v1.0.0 翻车之后加的，见 `DEVELOPMENT.md` §六 A-11 / F-18。

## 八、外部参照与许可

页脚「框架与开源协议」表由 `scripts/gen-license-manifest.mjs` 从已安装依赖的 `package.json` **实测生成**，
并单列「外部参照与使用边界」：MiniSearch（MIT，已作依赖引入）、vue-masonry-wall（MIT，仅算法对照，
因其 Vue 2-only 且最短列调度会破坏置顶/自定义顺序，未采用）、lozad.js（MIT，仅懒加载细节参照）、
AFP verification-plugin（MIT，仅"声明—证据—结论"字段与措辞参照）、Typemill（MIT，仅防护思路参照）。
许可声明缺失的项目一律只读思路、不取代码。详见 `THIRD_PARTY_NOTICES.md`。

**选型纪律：先找现成开源，再决定自研。** 每个要自研的能力都先扫一轮候选仓库，许可**落到包自带的
LICENSE / `package.json` 实测**（不看 README 的口头声明）。按这条规则，本站把四处自研换成了现成库：
正文逐词比对用 `diff`（BSD-3-Clause）、EPUB 的 XML 用 `@rgrove/parse-xml`（ISC，零传递依赖）、
用户名册 CSV 用 `csv-parse` + `csv-stringify`（MIT）、PDF 阅览用 `pdfjs-dist`（Apache-2.0）——
其中换掉正则 XML 解析与换掉自写 CSV 转义**各发现并修掉一个真实缺陷**（章节次序静默丢失、口令里的换行造出幽灵账号）。
反过来，也有一批现成方案经核实后**明确不引入**（`pino`/`pino-roll`、`fast-xml-parser`、Loki/Grafana/Tempo 的 AGPL-3.0、
Graylog 的未声明许可、Vector 的 MPL-2.0、`yauzl`/`fflate`/`adm-zip`/`jszip`、`steno`/`lowdb`、`express-brute`、
`file-type`、`jsondiffpatch`、`isbot`），逐条理由与实测许可记在 `DEVELOPMENT.md` §三 3.4。

**依赖一律精确 pin**（无 `^`/`~`/范围符），因为交付物是"解压即放到 Nginx 上跑"的包，重装拿到不同版本不可接受。
`scripts/pin-guard.mjs` 在 `pnpm build` 前挡人：核对每条声明是精确版本、实装与声明一致、
许可落在宽松白名单内（两个已单独核实的例外见下）、每个包都有"一句话用途"与可回指的出处。

**EPUB 的 ZIP 层仍是自写**：`server/src/library/zipRead.js` 的中央目录读取与按偏移定点解压没有引第三方库
（理由：本站要的是"只取一个条目 + 自己握三道闸"，现成库要么是全量解压 API、要么仍需在其上再写这层校验）。
XML 层则改用 `@rgrove/parse-xml`（见上），因此阅览功能新增的许可面只有它一个（ISC）。

**唯一的 copyleft 例外：CKEditor 5。** 富文本基底按要求取用其**免费版**（`ckeditor5@48.5.2` 伞包），
许可证为 **GPL-2.0-or-later**（与商业许可双轨），因此：

- 配置里显式声明 `licenseKey: 'GPL'`，不伪装商业授权，也不去掉任何许可提示；
- 保留包内 `COPYING.GPL` 与 `LICENSE.md`，页脚与 `THIRD_PARTY_NOTICES.md` 同步登记；
- GPL 的传染义务由**分发**触发。**本仓库已作为开源整站公开分发**，触发点已到：因此**整份源码（含前端）按 GPL-2.0-or-later 释出**，
  见仓库根目录的 `LICENSE`。这不是可选装饰，而是内嵌 CKEditor 5 后公开发布的必然结果——
  只要构建物里仍组合 GPL 的 CKEditor，就不能改用 MIT/Apache 之类的宽松许可（除非另行购入 CKEditor 商业许可并替换该依赖）。
- 只用免费构件：`SourceEditing`、`GeneralHtmlSupport`、`Export to Word/PDF` 等属 premium，未引入也无需引入——
  圈划与划线本站自定义插件解决；
- 工具条原生按钮的中文提示取自伞包自带的简体词典 `ckeditor5/translations/zh-cn.js`（同属 GPL-2.0-or-later，
  不是第三方翻译服务）。该文件只是纯数据默认导出，Vite 下没有构建插件替它挂载，故在创建实例前并入
  CKEditor 读取的全局 `window.CKEDITOR_TRANSLATIONS`，并把 `language.ui` 设为 `zh-cn`。

## 九、验证

| 层次 | 命令 | 覆盖 | 本轮结果 |
| --- | --- | --- | --- |
| 接口 | `node scripts/api-smoke.mjs` | 权限边界、置顶唯一、HTML 净化、限流、锁定、签名直链过期、魔数与尺寸校验、反爬 UA、菜单读写（清单按 `modules/registry.js` 派生）、版本与馆务端点、全站版本台账总表 | 48/48 |
| 全量 | `node scripts/full-sweep.mjs` | 7 个隔离实例各跑一遍：建档/修订/删档、媒体与签名直链、资源库增删藏、镜像站口令门控与吊销、EPUB 分页阅览（章节页/小节再切/整本拒绝/图片门控与包外路径）、**PDF 阅览与逐本预览白名单**、**版本台账（保留数截断、两版比对、`BW_REVISION_KEEP`）**、**全站版本台账总表（按档案筛选、记忆化即时失效、删档后 `alive=false` 仍在册）**、**媒体三方对账与点名清理**、**用户名册 CSV 特殊字符往返**、**写限流按配置真的会挡（`BW_WRITE_LIMIT_PER_MIN`）**、出厂示例实体逐项在位（演示链接、`demo` 用户可删可恢复、五章册逐章阅览、带书签 PDF、站内路径资源）、生产模式响应头与接口不被单页兜底吞掉、scrypt 哈希模式、登录锁定、旧菜单文件自动补齐 | 218/218 |
| 界面 | `node scripts/walkthrough.mjs` | 真实浏览器（CDP）跑登录→建档（材料源出处链接随档渲染）→CKEditor 画圈/划线→变色→解除标注→插图→用印→对勘呈现→重排→菜单编辑→置顶→删除→**修订一次→版本台账两版/词级 ins-del/同版提示**→镜像口令→**在线阅览翻页/插图/跨章单页链接/全本/令牌收回**→**架上检索命中章节→直达该节**→**预览开关往返**→**PDF 分节/页眉措辞/文字层/无光栅化**→**馆务台账（对账读数、预演不改盘、确认框可取消、日志按事件筛选）**→**版本台账总表（口径五分栏、按动作筛选、清空筛选、行链跳版本清单）**→页脚出处链接→**凡例「出厂示例」表（8 行）**，并逐屏截图（窄屏含馆务台账、版本台账总表与逐档版本台账三张表）；桌面端外壳几何（批注栏标题横排、页眉铺满不缩进） | 165/165，控制台零输出、CSP 零违规 |
| 契约 | `pnpm audit:ui` | Yan 阵营根属性、元素/布局/交互/动效语法、控件面预算、无障碍与仿制陈词 | PASS（52 个前端文件，无告警） |
| 色域 | `audit-palette-separation.mjs` | 12 家族色域互斥与对比度 | PASS（最近对 lungmen/yan：field ΔE 14.9） |
| 依赖 | `pnpm guard:deps`（`prebuild` 自动跑） | 全部声明精确 pin、实装与声明一致、许可在宽松白名单内、每个包有用途与出处、同一包不在两工作区各装一份 | PASS（19 条声明 / 17 个运行时依赖） |
| 构建 | `pnpm build` | 许可登记表再生 → 依赖守卫 → Vite 分包 | 通过；游客首屏 = index.html + 5 个入口资源（含 Vue 运行时），gzip 合计约 63KB；CKEditor 整体只进登录后才加载的编辑页分包（782.6KB / gzip 210.2KB），在线阅览页分包 9.6KB / gzip 4.5KB，两者游客都不下载 |
| 出包 | `pnpm package:zip` | 四道拒绝出包的硬闸：运行态文件扫描 → `api/node_modules` 软链接数为 0 → **孤立自足性**（`%TEMP%` 下祖先无 `node_modules` 处真起后端 + `/api/menu` 200 且有条目）→ 包内每个 `.cmd/.bat` 必须 CRLF 且纯 ASCII | 通过（软链接 0 · started / 200 / 12 项 · CRLF+ASCII · 26.3 MB / 2442 件） |
| Windows 一键安装 | `installer\*.cmd` 实跑（真包解压到**仓库树外**） | 环境检测与两条分支（抬闸门逼出"太旧" rc 2、无 winget 退回官方页 rc 3）、部署（七目录 + 目标机现编 exe）、三条拒绝分支（源码仓库里部署 rc 1 / 包拷到自身 rc 6 / 无端口记录 rc 2 **不猜端口**）、起站后 `/` 200 与 `/api/menu` 200、`口令.txt` 落站点根、端口占用幂等、卸载 `/quiet` 留档与 `DELETE` 全删自清、`creds` 三态 | **全流程通过**；唯一未正面验证的是 `ONSTART`+`SYSTEM` 注册——本机已提权但 `schtasks` 被客户端策略拒绝，脚本按设计降级（仍注册登录任务 + 直接起站 + rc 4 说明），见 `DEVELOPMENT.md` §七 R-15 |

**三套脚本必须串行跑**（走查/自检与数据变更并发会产生幻影失败，见 `DEVELOPMENT.md` §六 F-6）。
走查脚本每轮先 `reseed` 取确定基线，并自带恢复：改过的顺序、菜单与置顶在用完后复位，可反复执行。
浏览器走查需先起一个调试端口：`chrome --headless=new --remote-debugging-port=9223 about:blank`。
