# 辨妄阁 · 辟谣档案库

类 wiki 的图文辟谣站点：以 **谣言 ↔ 辟谣双栏对勘** 为基本体例，重点处可画圈与划线，材料源逐条登记出处。
前端 pnpm + Vue 3 + Vite 8 + Pinia 4 + Vue Router 5，后端 Express 5 + JSON 文件存储，Nginx 托管。

界面语法取自 `terra-faction-ui` 技能包的 **Yan / 炎国 archival** 家族，深度 **maximal（最高规格）**，
色域固定在 `neutral-light-ink-paper`（纸白 / 墨黑 / 矿物灰，印朱仅用于承诺态）。
这是证据驱动的 Terra 阵营界面（受《明日方舟》世界观启发），**不是**任何官方界面，未使用任何官方标识或美术资源。

> 文档分工：本 README 讲**是什么与怎么用**；[`DEPLOY.md`](DEPLOY.md) 讲**怎么上线**；
> [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) 讲**用了谁的什么**；
> [`DEVELOPMENT.md`](DEVELOPMENT.md) 是**开发纪实**——需求落地对照、技术选型理由、决策记录、踩坑实录与风险警示。

---

## 一、快速开始

```bash
# 1. 安装依赖（.npmrc 已配 127.0.0.1:7897 代理，可按需删除）
pnpm install

# 2. 写入出厂示例（6 条档案 + 4 张演示图片 + 话题表 + 13 条资源库 + 2 本自产演示册 + 示例用户）
node server/scripts/reseed.js

# 3. 开发模式：后端 8787 + 前端 5173（前端已配 /api 代理）
pnpm dev
#   打开 http://127.0.0.1:5173

# 4. 生产构建 + 单进程自测（Node 直接伺服 dist，便于无 Nginx 时验证）
pnpm build
NODE_ENV=production node server/src/index.js
#   打开 http://127.0.0.1:8787

# 5. 接口自检（31 项：权限、置顶唯一、净化、限流、签名直链、反爬…）
node scripts/api-smoke.mjs
```

默认账号 `admin` / 默认口令 `admin`。**首次登录后请立即改密。**

出厂示例账号另有一名 `demo` / `demo-pass`（角色 editor，显示名「示例馆员（可删除）」），
用于让用户名册在初始状态就有可改可删的对象；`/users` 页可直接移除它。
**每项功能都随包附一份实体示例**（对勘图文、原始载体与材料源链接、资源库条目、可在线阅览的 EPUB、菜单与卷次顺序），
清单见公开页 `/about` 的「出厂示例」表；演示链接一律取 RFC 2606 保留域 `example.org`，不冒充真实文献。

| 脚本 | 作用 |
| --- | --- |
| `pnpm dev` | 前后端并行开发 |
| `pnpm build` | 生成许可登记表 + Vite 产物到 `web/dist` |
| `pnpm start` | 生产模式启动（同时伺服 `web/dist`） |
| `pnpm seed` | 重置演示数据 |
| `pnpm smoke` | 接口端到端自检 |
| `pnpm audit:ui` | 阵营界面契约审计 |
| `pnpm walkthrough` | 真实浏览器端到端界面走查（119 项断言 + 截图，见"九、验证"） |

> `pnpm seed` 只重写演示数据与 4 张固定 id 的演示图片（`demomedia01-04.png`，反复播种不会堆积新文件）；
> 此前经界面上传的图片文件仍留在 `server/data/media/`，索引里不再引用它们，需要清理时自行比对索引删除。
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
  src/views/      含 LibraryView（镜像与口令管理）· ReaderView（按章节在线阅览）
  src/directives/ reveal.js   共享 IntersectionObserver 懒加载
  src/composables/useWaterfall.js 保序瀑布流
server/     Express 5 + JSON 文件存储
  src/store/      jsonStore(原子写) / posts / menu / users(CSV) / sessions / resources / library
  src/library/    zipRead(ZIP 中央目录与定点解压) / epubRead(spine 分页与阅读净化)
  src/security/   middleware(头/CSRF/反爬) / media(魔数+签名) / sanitize / audit
  src/search/     vectorIndex（MiniSearch + 中文 bigram 分词）
  data/           posts.json · tags.json · menu.json · users.csv · resources.json ·
                  library.json · library-keys.json · media/ · library/
nginx/      站点配置与安全片段
scripts/    许可登记表生成 · 接口自检
```

## 三、存储选型：为什么最终是 JSON

需求要求"优先 JSON，若无法动态无刷新呈现才换数据库"。实测结论：**JSON 足够**，
因为动态性来自「后端 API + Pinia 响应式状态」，而不是存储介质：

- 写入用「临时文件 + 原子改名」，读改写按文件排队，避免并发丢写；
- 内存常驻一份状态，改动即时可读，磁盘写异步串行落盘；
- 检索索引常驻内存，写档案后置脏、下次查询重建，因此**新增/修订/置顶/重排均无需刷新**即反映到列表与搜索；
- 话题 tag 表（`tags.json`）由档案自动汇总，供向量检索与话题索引页消费。

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
| 每项功能都配一份可删可改的实体示例 | `server/scripts/reseed.js`：6 条对勘图文（含圈划/划线/图上批注/材料源出处链接）、`demo` 示例馆员账号、13 条资源库（含 1 条站内路径 `/library`）、2 本自产演示册（其一五章，可在线逐章阅览）；清单公开在 `/about`「出厂示例」表 |
| 置顶唯一、自动解除原置顶 | `posts.setPinned`，接口返回被解除者标题并在界面提示 |
| 拖动重排序 | `/reorder`（SortableJS 把手 + ↑↓ 键盘等价操作） |
| logo 位置同参考图 | 页眉最左，`BrandMark.vue` 原始 SVG（版框 + 界栏 + 「辨」字） |
| 菜单编辑（暴露/隐藏） | `/menu-editor` 改可见性与顺序，`modules/registry.js` 定义功能本体 |
| 详情页修改 | 登录后可修订，仍走同一编辑器 |
| header/sidebar/main/footer 四段 | header：批注栏开合 + logo + 搜索 + 登录登出 + 卷首索引；sidebar：重排序/菜单编辑入口（登录可见）+ **辟谣话题 tag 列表**（所有人可见）+ **辟谣常用资源库**（所有人可见）+ **洛琪希图书馆镜像**入口（所有人可见）；footer：框架与开源协议登记表（每行给出该框架官网或 GitHub 出处链接，地址由 `package.json` 的 homepage/repository 实测取得） |
| 辟谣常用资源库（无职转生专题） | `resources.json` + `/resources` 页 + 侧栏块：分五组（官方一手出处 / 中文区查证载体 / 访谈与翻译合集 / 事实核对工具 / 常见误传题材），每条记名称、入口、能核实什么、可信度；游客可读，登录用户增删改 |
| 洛琪希图书馆 EPUB 本地镜像 | `server/data/library/` 存文件 + `library.json` 书目 + `library-keys.json` 口令；`/library` 页：目录对所有人公开，**输入口令后即可在线阅览或取书**（HMAC 短时效令牌 + 范围校验 + 按 IP 冷却防爆破）；口令由登录馆员签发/停用/吊销 |
| EPUB 在线阅览（按章节分页） | `/library/:id/read?c=&p=`：解析包内 `container.xml → OPF spine → nav/ncx`，**一章一个可阅览网页**；**10MB 以上的书只允许分页**（整本渲染接口直接 409），单章过长再按一~三级标题切成小节；正文经阅读白名单净化（丢脚本/行内样式/svg/form），插图改写为同口令门控的站内资产地址、按需懒加载；阈值以下另可选"全本通读"（单次输出另有 1MB 上限） |

## 五、安全与懒加载实现

**防攻击**：写操作需会话 + CSRF 双提交；登录按 IP 与用户名双维度限次（5 次锁 10 分钟，计数落盘、重启不清零）；
登录接口独立限流；富文本服务端白名单净化 + 前端二次净化；请求体 640KB、单图 5MB；登录蜜罐字段；
安全事件写 `data/security.log`（JSONL，超 512KB 轮转）。

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

## 七、部署

见 `DEPLOY.md`：构建 → 拷贝 `web/dist` → 配 Nginx（`nginx/bianwang.conf` + `bianwang-proxy.inc`）→ systemd 托管后端 → 备份数据目录。

## 八、外部参照与许可

页脚「框架与开源协议」表由 `scripts/gen-license-manifest.mjs` 从已安装依赖的 `package.json` **实测生成**，
并单列「外部参照与使用边界」：MiniSearch（MIT，已作依赖引入）、vue-masonry-wall（MIT，仅算法对照，
因其 Vue 2-only 且最短列调度会破坏置顶/自定义顺序，未采用）、lozad.js（MIT，仅懒加载细节参照）、
AFP verification-plugin（MIT，仅"声明—证据—结论"字段与措辞参照）、Typemill（MIT，仅防护思路参照）。
许可声明缺失的项目一律只读思路、不取代码。详见 `THIRD_PARTY_NOTICES.md`。

**EPUB 与 ZIP 解析未引入任何第三方库**：`server/src/library/` 下的目录解析、定点解压与 spine/nav 读取均为
本站自写（参照 EPUB 3 规范的公开结构，不复制他人实现），因此在线阅览功能没有新增许可面，也没有新增依赖。

**唯一的 copyleft 例外：CKEditor 5。** 富文本基底按要求取用其**免费版**（`ckeditor5@48.5.2` 伞包），
许可证为 **GPL-2.0-or-later**（与商业许可双轨），因此：

- 配置里显式声明 `licenseKey: 'GPL'`，不伪装商业授权，也不去掉任何许可提示；
- 保留包内 `COPYING.GPL` 与 `LICENSE.md`，页脚与 `THIRD_PARTY_NOTICES.md` 同步登记；
- GPL 的传染义务由**分发**触发。本站为自有服务器托管、不向他人交付构建物，义务限于随源码保留许可文本；
  一旦要开源整站或对外发安装包/源码包，整份前端源码须按 GPL-2.0-or-later 一并释出（这一点在改动前请先确认）；
- 只用免费构件：`SourceEditing`、`GeneralHtmlSupport`、`Export to Word/PDF` 等属 premium，未引入也无需引入——
  圈划与划线本站自定义插件解决；
- 工具条原生按钮的中文提示取自伞包自带的简体词典 `ckeditor5/translations/zh-cn.js`（同属 GPL-2.0-or-later，
  不是第三方翻译服务）。该文件只是纯数据默认导出，Vite 下没有构建插件替它挂载，故在创建实例前并入
  CKEditor 读取的全局 `window.CKEDITOR_TRANSLATIONS`，并把 `language.ui` 设为 `zh-cn`。

## 九、验证

| 层次 | 命令 | 覆盖 | 本轮结果 |
| --- | --- | --- | --- |
| 接口 | `node scripts/api-smoke.mjs` | 权限边界、置顶唯一、HTML 净化、限流、锁定、签名直链过期、魔数与尺寸校验、反爬 UA、菜单读写 | 31/31 |
| 全量 | `node scripts/full-sweep.mjs` | 5 个隔离实例各跑一遍：建档/修订/删档、媒体与签名直链、资源库增删藏、镜像站口令门控与吊销、EPUB 分页阅览（章节页/小节再切/整本拒绝/图片门控与包外路径）、**出厂示例实体逐项在位（演示链接、`demo` 用户可删可恢复、五章册逐章阅览、站内路径资源）**、生产模式响应头与接口不被单页兜底吞掉、scrypt 哈希模式、登录锁定、旧菜单文件自动补齐 | 149/149 |
| 界面 | `node scripts/walkthrough.mjs` | 真实浏览器（CDP）跑登录→建档（材料源出处链接随档渲染）→CKEditor 画圈/划线→变色→解除标注→插图→用印→对勘呈现→重排→菜单编辑→置顶→删除→镜像口令→**在线阅览翻页/插图/跨章单页链接/全本/令牌收回**→页脚出处链接→**凡例「出厂示例」表**，并逐屏截图（窄屏含凡例三列表） | 119/119，控制台零输出、CSP 零违规 |
| 契约 | `pnpm audit:ui` | Yan 阵营根属性、元素/布局/交互/动效语法、控件面预算、无障碍与仿制陈词 | PASS（47 个前端文件，无告警） |
| 色域 | `audit-palette-separation.mjs` | 12 家族色域互斥与对比度 | PASS（最近对 lungmen/yan：field ΔE 14.9） |
| 构建 | `pnpm build` | 许可登记表再生 + Vite 分包 | 通过；游客首屏 = index.html + 4 个入口资源（含 Vue 运行时），gzip 合计约 61KB；CKEditor 整体只进登录后才加载的编辑页分包（782.6KB / gzip 211.6KB），在线阅览页分包 8.1KB / gzip 3.9KB，两者游客都不下载 |

走查脚本每轮先 `reseed` 取确定基线，并自带恢复：改过的顺序、菜单与置顶在用完后复位，可反复执行。
浏览器走查需先起一个调试端口：`chrome --headless=new --remote-debugging-port=9223 about:blank`。
