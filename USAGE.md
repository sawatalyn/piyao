# 辨妄阁 · 使用说明书

面向**馆员与运营**的操作手册：怎么新增图文、怎么查入馆口令、怎么增删用户、怎么管菜单，
以及一份**从零到上线的 Nginx 部署建站指南**。

- 想先跑起来看效果：见 [§0 起步](#0-起步三分钟跑起来)。
- 只想改内容：看 [§2 新增图文](#2-新增图文核心)。
- 只管站点：看 [§7 Nginx 部署建站](#7-nginx-部署建站指南从零到上线)。
- 一台干净的 Windows 机器，双击装完就自启：看 [§10 一键安装包](#10-一键安装包-installerwindows)。
- 部署细节与故障：仓库另有 [`DEPLOY.md`](DEPLOY.md)（本手册 §7 是它的可照做版）。

> **权限模型先说清楚**：本站只有"游客 / 已登录"两档，**没有按角色分权**。
> 用户名册里的"角色（编辑 / 管理员）"只是一个署名标签，不改变任何能力——
> **任何登录用户都能编辑全部档案、用户、菜单与口令**。因此只把账号发给可信的馆员。
> "菜单权限"指的是**控制哪些功能出现在导航里**（全局开关，见 [§5](#5-管理菜单导航暴露与排序)），不是给不同用户配不同菜单。

---

## 0. 起步（三分钟跑起来）

Windows 双击仓库根目录的 **`start.cmd`**；macOS / Linux / WSL 执行 **`./start.sh`**。
脚本只补做还缺的步骤：装依赖 → 写演示数据 → 构建前端 → 生产模式起在 **http://127.0.0.1:8787**。

手动等价步骤：

```bash
pnpm install
node server/scripts/reseed.js     # 写入演示数据（6 条档案、3 本自产演示册、示例口令等）
pnpm build                        # 产出 web/dist
NODE_ENV=production node server/src/index.js
```

- 默认账号 **`admin` / `admin`**（另有演示账号 `demo` / `demo-pass`）。**首次登录后立刻改 admin 口令。**
- 启动时会在**项目根目录生成 `口令.txt`**，列出所有登录口令与镜像入馆口令，方便本地查阅（含明文，已 gitignore，勿提交/分发；`BW_CRED_FILE=0` 可关）。
- 开发热更新（前后端分离两端口）：`pnpm dev`（后端 8787 + 前端 5173）。

登录后，右上角"登录"会变成你的显示名 + "登出"；卷首顶部导航与左侧批注栏里带"登录"标记的入口此时全部可用。

---

## 1. 界面地图

| 区域 | 内容 |
| --- | --- |
| **页眉（header）** | 批注栏开合、站标、全站检索框、登录/登出 |
| **卷首索引（页眉下方一行）** | 由"菜单编辑"驱动的顶部导航（卷首 / 检索 / 话题索引 / 资源库 / 镜像 / 新增图文 …） |
| **批注栏（左侧边栏）** | 功能入口、卷面密度与夜读、辟谣话题导轨、资源库速览、镜像入口 |
| **卷身（main）** | 当前页正文 |
| **卷尾（footer）** | 体例说明 + **框架与开源协议登记表**（每个依赖的名称/版本/许可/用途/出处） |

需要登录才能进入的页面：新增图文、卷次重排、菜单编辑、用户名册、馆务台账、版本台账总表。

---

## 2. 新增图文（核心）

入口：卷首索引或侧栏的「**新增图文**」（需登录）→ 路由 `/edit`。修改已有档案走详情页的「修改」→ `/edit/<档案 id>`。

编辑器把一份档案拆成**四叶**（顶部"一二三四"标签切换），右上角有**合式度**进度条，列出还缺哪些必填项：

### 第一叶 · 标题与判定
- **标题**（≤120 字）：写成一句可被核验的话，如"××会致癌？"。首页卡片直接取此标题。
- **结论判定**（单选，必选其一）：`不实` / `误导` / `部分属实` / `存疑`。措辞含义见页脚体例。
- **谣言来源平台**、**发现时刻**（日期）、**原始载体链接**（可选，只接受 http(s)）。
- **责任编辑**（留空则记为建档人）、**危害等级**（高/中/低）、**复核期限**（日期，到期提醒复核）、**传播范围**。

### 第二叶 · 谣言案例（富文本 + 圈划 + 图上批注）
- 富文本编辑器（CKEditor 5）：加粗 / 斜体 / 下划线 / 删除线、有序/无序列表、引用、插入链接。
- **照录原话**，不要改写；然后用工具条上的三个批注按钮标重点：
  - **画圈**（`yanAnnotationCircle`）：先**选中一段文字**再点，用笔色圈出关键断言。
  - **划线**（`yanAnnotationLine`）：给选中文字加下划线式标记。
  - **解除标注**（`yanAnnotationClear`）：去掉选区上的圈划。
  - 未选中文字时圈划/划线按钮不可用，编辑器下方会提示"未选中文字…"。
- **笔色**（编辑器上方单选）：`朱砂`（默认）/ `藤黄` / `花青` / `墨`。笔色作用于**下一次**圈划。
- **插入插图**（工具条 `yanImagePicker`）：选本地图片（PNG/JPEG/GIF/WebP/AVIF，单图 ≤5MB），入库后插入正文。
  插图后，本页下方出现「**图片标注**」区，可在图上画**矢量**圈/线（不烧进像素，详情页按数据复原到图上）。
- **话题 tag**：纯文本标签列表（≤20 个），用于检索与侧栏话题导轨。

### 第三叶 · 辟谣内容（富文本）
- 同样一套富文本 + 圈划工具。建议**先给结论，再列证据与推理**，关键处同样可圈划。

### 第四叶 · 材料源与批注
- **材料源**（可增删行，≤20 条）：每行含 标题 / 链接 / 机构 / 采集日期 / 备注 / 上传凭证图片。
  这是"逐条登记出处"的落点；危险协议（如 `javascript:`）在写入层即被拒。
- 底部显示当前图片标注总笔数，随档案一并存档。

### 归档
- 点「**用印归档**」（新建）/「**用印修订**」（编辑）→ 弹确认框，摘要列出标题、判定、话题数、材料源数、标注笔数 → 确认。
- 必填六项：标题、结论判定、谣言案例、话题标签、辟谣内容、至少一条材料源。缺项会跳回对应叶并提示。
- 归档后自动进入详情页。
- **每次建档与修订都会存一份完整版本快照**：详情页「版本台账」→ 任选两版比对（正文按字/词标 `<del>`/`<ins>`）。撤档不抹历史。

### 置顶与排序（归档之后）
- **置顶**：详情页右上「置顶」，全局唯一——置顶新条目会自动解除旧置顶。
- **卷次重排**：侧栏/导航「卷次重排」→ 拖动或用 ↑↓ 调整首页顺序 → 保存。

---

## 3. 查看入馆口令（洛琪希图书馆镜像）

镜像站给"借书柜台"的访谈/翻译合集做本地备份。**目录人人可读，取书与在线预览需要口令**。口令由登录馆员管理。三种查看途径：

1. **根目录 `口令.txt`**（最方便）：服务启动即生成，明文列出每条口令的名称、范围、状态、到期。仅本机，勿外传。
2. **`/library` 页 → 登录后底部「口令管理」表**：`口令` 列直接以明文显示每条口令，并给出名称、范围（全部 / 指定 N 册）、到期、取书次数、状态。
3. **数据文件 `server/data/library-keys.json`**（或部署机的 `BW_DATA_DIR` 下同名文件）：原始存储，明文，与用户名册同一安全取舍。

### 签发 / 停用 / 吊销口令（需登录，在「口令管理」区）
- **签发**：填 `口令`（4–40 字符）、`名称`（如"对外发放·2026 秋"）、`范围`（全部在架书 / 指定书目可多选）、`到期`（留空＝长期）、`给读者的提示` → 「**签发口令**」。
- **停用 / 启用**：行内「停用」/「启用」按钮。停用后持有者验印即失败，但记录保留，可随时启用。
- **吊销**：行内「吊销」→ 二次确认 → **永久删除**，已发出的 10 分钟令牌随即失效，读者需重新索取。
- 口令明文存于服务端数据目录——**这是需求指定的形态**，只适合内网/可信环境；对外发放前把演示口令（如 `roxy-guest`）改掉或吊销。

### 读者侧：入馆 → 取书 / 在线阅览
1. 打开 `/library`，在「入馆口令」框输入口令 → 「**验印入馆**」。成功后显示"已解锁至 <时刻>"（单次令牌 10 分钟）。
2. 架上每本「取书」按钮变为可点（下载原文件）。
3. 「在线阅览」入口**只对馆员勾选了「允许在线预览」的书出现**（预览白名单，默认关）。未勾选的书即使知道 URL 也回"此书未加入预览白名单，仅可下载"。
4. 连错若干次会按 IP 冷却（与登录锁定分开的口令验印限流）。

> 在线阅览边界：EPUB 逐章分页、>10MB 的书强制分页不给整本；PDF 只走**文字层 + 书签分节**，不做服务端光栅化（扫描件会是空的，需下载原件）。

---

## 4. 新增用户与管理用户（用户名册）

入口：导航「**用户名册**」（需登录）→ `/users`。名册即服务端 `users.csv` 的读写界面。

### 登记新用户
表单「登记新用户」：
- **用户名**：2–32 位，仅限字母、数字、`_ . -`。
- **初始口令**：至少 8 位。
- **显示名**：可空（默认取用户名）。
- **角色**：编辑 / 管理员（**仅署名标签，不影响权限**，见开头"权限模型"）。
- 点「**用印登记**」。

### 改密
**同名提交即为改密**：在登记表单填**相同用户名** + 新口令（≥8 位）提交即可。
改密后**该用户的所有会话立即失效**（需重新登录）。

### 移除
名册表每行「移除」→ 二次确认。
- 内置 `admin` **不可删除**（按钮禁用）。
- 演示账号 `demo`（示例馆员）可直接移除；重跑 `pnpm seed` 只会补回 `demo` 这一行，**不会覆盖任何已改过的口令**。
- 移除后该用户会话失效，但其已归档条目仍保留作者署名。

### 安全提示条
- 若仍是默认口令，页面顶部黄条提示"默认口令仍在使用，请立即修改 admin 口令"。
- 口令列显示当前存储形态：`明文` 或 `scrypt`。

### 切换到哈希存储（可选，生产推荐）
设环境变量 `BW_HASH_PASSWORDS=1` 重启，然后**再改一次密码**，`users.csv` 里即存 scrypt 摘要（`scrypt$<salt>$<hash>`），不再落明文。
注意：哈希模式生效后，`口令.txt` 对账号口令会显示"（已哈希，无法回显）"。

---

## 5. 管理菜单（导航暴露与排序）

入口：导航「**菜单编辑**」（需登录）→ `/menu-editor`。
这里控制**哪些功能出现在卷首索引与侧栏**，以及它们的**顺序**与**显示名**——是全局设置，对所有访客生效。

- 每一行是一个功能模块，含：勾选框（是否暴露）、**显示名**（≤24 字，可自定义）、路由、`需登录` 标记、模块 id、用途说明。
- **拖动行左侧的界尺把手**可调整顺序。
- 顶部工具条：「**用印保存菜单**」（有改动才可点）、「放弃改动」、「全部显示」、「全部隐藏」。
- 右侧实时计数"暴露 N / M 项"；「卷首索引预览」按当前身份（游客/已登录）显示效果。
- **至少保留一个可见项**，否则保存被拒（否则卷首将无导航）。
- 功能**本体**由前端模块注册表定义（共 12 项：卷首、检索、话题索引、资源库、洛琪希图书馆镜像、新增图文、卷次重排、菜单编辑、用户名册、馆务台账、版本台账总表、凡例）；菜单编辑只改**可见性与顺序**，不能新增功能。

> 说明：把某项从菜单隐藏，只是**不在导航里出现**，直接访问其 URL 仍可达（受各自的"需登录"门控约束）。真正限制访问靠"需登录"，不是靠隐藏菜单。

---

## 6. 馆务台账与版本台账总表（运维视角，需登录）

- **`/ops` 馆务台账**：① 媒体三方对账（磁盘 / 索引 / 在档引用），分"在档引用·无引用记录·磁盘孤儿·索引死链"四栏；清理**默认只预演**、须逐个点名且二次确认，越界路径与仍被引用者一律拒绝。② `security.log` 聚合（按事件/IP/用户/日 + 需盯信号），只读可筛。
- **`/ledger` 版本台账总表**：全站口径的版本数、涉及档案、快照占用字节、每档保留数、已撤档仍在册数；可按档案/动作筛选，行链跳到该档版本清单。用于盯 `revisions.json` 会不会涨太大。

（其余：`/resources` 资源库、`/tags` 话题索引、`/about` 凡例为公开页。）

---

## 7. Nginx 部署建站指南（从零到上线）

> **先回答"能不能只用 Nginx"：不能。**
> 本站后端是 **Node/Express 进程 + JSON 文件存储**，负责登录会话、CSRF、图片签名直链、HTML 净化、
> 检索、EPUB/PDF 解析与在线阅览、审计日志等**动态逻辑**——Nginx 只是静态服务器 + 反向代理，**没有 JS 运行时，跑不了这些**。
> 所以部署形态固定为：**Nginx（静态托管 + 反代 + TLS）+ 一个常驻的 Node 后端进程**。
>
> - 放进 **Nginx html 根**的，只有前端产物 **`web/dist/`**（`index.html` + `assets/`）——它就在那个一键安装包里（`<包>\web\dist\`），把它指给 Nginx 的 `root` 即可，**没有单独打包的"纯静态 zip"**（那个形态已于 2026-09-30 撤下，理由见 README §七 与 DEVELOPMENT D-15：只拷前端会得到一套没有接口的页面）。
> - 后端 **`api/`（或仓库 `server/`）** 必须用 `node` 常驻运行（systemd / 任务计划 / nssm），Nginx 通过 `proxy_pass http://127.0.0.1:8787` 把 `/api/…` 转给它。
> - 极端省事：不装 Nginx 也能跑——`api/` 里的 Express 会**同时伺服 `web/dist` 与 API**（单机自测模式，见 §0）。
>   但生产仍建议 Nginx 前置，拿 TLS、频控、静态长缓存与数据目录隔离。

**架构**：Nginx 只做静态托管 + 反向代理；Node 后端只监听 `127.0.0.1:8787`；数据以 JSON/CSV 落在服务端目录。

```
浏览器 ──HTTPS──> Nginx ──┬── /            → web/dist（前端静态产物）
                          └── /api/…       → 127.0.0.1:8787（Node，仅回环）
                                             └── data/*.json · users.csv · media/ · library/
```

**两条产物路线，二选一：**

| | 路线 A：从仓库构建 | 路线 B：用部署包（推荐交付） |
| --- | --- | --- |
| 前端 | `pnpm build` 产出 `web/dist/` | 包内 `web/dist/` 已备好 |
| 后端 | 拷 `server/`，目标机 `pnpm install --prod` | 包内 `api/` 已含生产依赖（解引用，无软链） |
| 生成包 | — | `node scripts/make-nginx-package.mjs --write --zip` |

> 走路线 B 时，下文所有 `server/` 换成 `api/`，且**目标机不需要** `pnpm install`。
> `BW_DATA_DIR` 建议指到包外目录，这样升级时整目录替换 `api/` 不碰数据。

### 7.1 Linux：systemd + Nginx（完整可照做）

**① 放置产物**（示例用路线 A；路线 B 把 `server` 换成解压出的 `api`，`web/dist` 换成包内 `web/dist`）

```bash
sudo useradd -r -s /usr/sbin/nologin bianwang            # 专用低权账号
sudo mkdir -p /var/www/bianwang/dist /srv/bianwang /srv/bianwang/data
sudo cp -r web/dist/* /var/www/bianwang/dist/            # 这就是 nginx.conf 里的 root
sudo cp -r server    /srv/bianwang/server
sudo chown -R bianwang:bianwang /srv/bianwang
```

**② 环境变量** `/etc/bianwang.env`（密钥、端口、数据目录）

```bash
sudo tee /etc/bianwang.env >/dev/null <<'ENV'
NODE_ENV=production
BW_HOST=127.0.0.1
BW_PORT=8787
BW_DATA_DIR=/srv/bianwang/data
BW_SECRET=替换为至少64位随机串_用openssl_rand_hex_32生成
BW_HASH_PASSWORDS=1
# 可选：BW_REVISION_KEEP=30   BW_WRITE_LIMIT_PER_MIN=40   BW_LIBRARY_MAX_MB=120
ENV
sudo chmod 600 /etc/bianwang.env
```

- `BW_SECRET` 决定会话与**所有签名**（图片直链、镜像令牌、CSRF）。多实例必须一致；留空则首启自动生成 `data/.secret`（0600）。
- `BW_HASH_PASSWORDS=1` 让新写入的口令走 scrypt（改一次密码后生效）。

**③ systemd 常驻**

```bash
sudo tee /etc/systemd/system/bianwang.service >/dev/null <<'UNIT'
[Unit]
Description=Bianwang rumor-debunk archive API
After=network.target

[Service]
User=bianwang
EnvironmentFile=/etc/bianwang.env
WorkingDirectory=/srv/bianwang/server
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/srv/bianwang/data
PrivateTmp=true
LimitNOFILE=4096

[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable --now bianwang
systemctl status bianwang --no-pager
curl -s -o /dev/null -w '%{http_code}\n' -A 'Mozilla/5.0' http://127.0.0.1:8787/api/health   # 期望 200
```

**④ Nginx 站点**

```bash
sudo cp nginx/bianwang-proxy.inc /etc/nginx/
sudo cp nginx/bianwang.conf /etc/nginx/sites-available/bianwang
sudo ln -sf /etc/nginx/sites-available/bianwang /etc/nginx/sites-enabled/bianwang
sudo nginx -t && sudo systemctl reload nginx
```

改 `bianwang.conf` 里的 `server_name`（示例是 `bianwang.example.org`）为真实域名。
证书用 certbot 签发：`sudo certbot --nginx -d 你的域名`（会写入 `/etc/letsencrypt/live/你的域名/`，与 conf 里的路径对齐）。

**⑤ 防火墙**：只放行 80/443，**不要**对外开放 8787（后端只监听回环）。

### 7.2 `bianwang.conf` 逐段解读（改之前先懂它在防什么）

| 段落 | 作用 |
| --- | --- |
| `limit_req_zone …` | 四类频控：`bw_api` 30r/m、`bw_page` 60r/m、`bw_media` 120r/m、`bw_login` 6r/m；`bw_conn` 限并发 |
| `map $http_user_agent $bw_bot` | 抓取型 UA 指纹（curl/scrapy/python-requests/空 UA 等）命中即要求带会话，否则 403 |
| `server 80 → 301 https` | HTTP 全跳 HTTPS |
| `ssl_*` | 仅 TLS1.2/1.3、强套件、OCSP stapling |
| `server_tokens off` / `client_max_body_size 5m` | 隐藏版本；上传上限与后端一致（5MB） |
| `add_header …` | HSTS、nosniff、X-Frame-Options DENY、Referrer/Permissions/CORP，以及**严格 CSP**（`style-src 'self'`，无 `unsafe-inline`——所以批注只用预置 class） |
| `location ~ /\.` / `\.(json\|csv\|log…)$` / `^/(data\|server\|node_modules\|\.git)/` | **数据目录与隐藏文件绝不经 web 暴露**（`posts.json`/`users.csv`/`security.log` 一律 404） |
| `location = /api/auth/login`、`= /api/library/unlock` | 登录与入馆验印单独更严限流，挡爆破/穷举 |
| `location ^~ /api/library/files/` | 取书：关缓冲、长超时（整本流式下发） |
| `location ~ ^/api/library/[^/]+/(reader\|asset)` | 在线阅览逐章取页 + 带令牌插图，高频，`no-store` |
| `location ^~ /api/media/` | 图片签名直链，`private, max-age=1200` |
| `location /api/` | 其余接口：`no-store` + `X-Robots-Tag noindex` |
| `location /assets/` | 带哈希构建产物：`1y` + `immutable`，关访问日志 |
| `location /` | SPA history 回退 `try_files … /index.html` |

> **不要**给 `/api/library/*`、`/api/media/*` 加公共缓存：响应带 `no-store` 且 URL 上有 10 分钟令牌。
> 令牌会进 `access_log` → 日志须仅本机可读（`chmod 640`），或对 `/api/library/` 单设 `access_log off`。

### 7.3 Windows：nginx.exe + 后端常驻

```bat
:: 1) 产物就位
xcopy /E /I web\dist  C:\bianwang\www
xcopy /E /I server    C:\bianwang\server
cd C:\bianwang\server && pnpm install --prod

:: 2) 环境变量（正式写入系统环境变量）
setx /M NODE_ENV production
setx /M BW_HOST 127.0.0.1
setx /M BW_PORT 8787
setx /M BW_DATA_DIR C:\bianwang\data
setx /M BW_HASH_PASSWORDS 1

:: 3) 后端开机自启（任务计划，或改用 nssm 注册为服务）
schtasks /Create /TN BianwangAPI /TR "node C:\bianwang\server\src\index.js" /SC ONSTART /RU SYSTEM /F
schtasks /Run /TN BianwangAPI

:: 4) Nginx：把 bianwang.conf 的 root 改成 C:/bianwang/www，server_name/证书路径改真实值，放入 conf.d\
cd C:\nginx && start nginx && nginx -t && nginx -s reload
```

Windows 铁律：`data` 目录（`C:\bianwang\data`）**必须在 Nginx root（`C:\bianwang\www`）之外**；
`.cmd` 启动器保持纯 ASCII（cmd.exe 按 OEM 代码页读，中文会乱码）。

### 7.4 上线后验收（用包自带的脚本）

```bash
# 只读（不写任何东西）：26 项
node ops/verify-deploy.mjs https://你的域名 --expect-prod
# 含写链路（建档→修订→比对→置顶→删除，跑完自清）：36 项
node ops/verify-deploy.mjs https://你的域名 --expect-prod --mutate --user admin --pass '改过的口令'
```

报告落盘 `ops/verify-report-<时间戳>.md`。判读：**FAIL**＝站点真不通；**WARN**＝只在生产入口才要求（如 CSP）；**INFO**＝只有经 Nginx 才成立（如 `/assets/` 的 `immutable`）。

### 7.5 必做的安全收口（上线前逐条过）

1. **改默认口令**：用户名册里同名提交 `admin` 即改密（≥8 位）。移除演示账号 `demo`。
2. **删根目录 `口令.txt`**（或 `BW_CRED_FILE=0` 关掉生成），别让明文口令躺在服务器上。
3. **开哈希**：`BW_HASH_PASSWORDS=1` 后再改一次密码。
4. **备份**：`data` 整目录即全量状态（档案、话题、菜单、名册、图片与索引、审计日志、`revisions.json`、`library.json`、`library-keys.json`）；镜像原件在 `data/library/`，两处都要备。恢复＝整目录替换后重启进程。
5. **Nginx 复核**：`client_max_body_size 5m`、`/api/` 限流、`location ~ /\.` 拒隐藏文件、`autoindex off`、数据目录不在 web root 下。
6. **只把账号发给可信馆员**（无按角色分权）。

---

## 8. 常见问题（运营侧）

| 现象 | 原因 / 处理 |
| --- | --- |
| 图片显示"链接已过期" | 签名直链默认 30 分钟有效，刷新页面即重新签发；改过 `BW_SECRET` 会让旧链接全废 |
| 登录 429 | 同 IP 或同用户名连错 5 次锁 10 分钟（计数存 `data/login-attempts.json`） |
| 保存提示"缺少有效的操作令牌" | 会话换发了 CSRF，刷新页面重取 `/api/auth/me` |
| 游客翻页 403 | 超过 20 页需登录（反批量抓取设计） |
| 上传 415 | 只按文件头魔数判 JPEG/PNG/GIF/WebP/AVIF，改扩展名无效 |
| 在线阅览回 403 `preview-off` | 该书没勾「允许在线预览」——在 `/library` 书目管理里逐本开启 |
| PDF 阅览页空白 | 该 PDF 无文字层（扫描件）；当前不做服务端光栅化，请下载原件 |
| 圈划/划线按钮灰着 | 先在正文里选中一段文字再点；未选中不可用 |
| 菜单改完首页没变 | 忘了点「用印保存菜单」；或至少保留一项的约束拦下了 |
| 台账/比对页 429 | 写操作默认 40 次/分（`BW_WRITE_LIMIT_PER_MIN`），批量导入临时调高、跑完改回 |
| 馆务台账"索引死链"非零 | 档案仍引用已不存在的图片，按提示**重传**，别删索引记录 |

更细的部署故障排查见 [`DEPLOY.md` §六](DEPLOY.md)；设计取舍与踩坑见 [`DEVELOPMENT.md`](DEVELOPMENT.md)。

---

## 9. Windows 桌面仪表盘（`dashboard/`）

给"不想记命令行、就想双击开站"的 Windows 机器用的**可视化起停面板**：填端口、起后端、开浏览器、看后端输出、体检运行环境，并可登记登录自启。

### 9.1 为什么是这么个东西

它**不是** Electron，也不需要 Python。`dashboard/Dashboard.cs` 是一份 WinForms 源码，由 **Windows 自带的 .NET Framework 4.x 编译器**（`%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe`）在目标机上现编成一个约 26 KB 的 exe。这样做的理由很实在：

- 本项目有条铁律是**只收宽松许可的依赖**，而 Electron 会一次性往仓库里塞进上百 MB 的依赖树并逼着重写许可台账；Python 等于再引入第二个运行环境。
- **包里不放预编译好的二进制**。这条和"`api/` 每次出包现做"是同一个道理——预置的 exe 会像预置的 deploy 产物一样，某天带着改之前的旧快照被打包出去。`install.cmd` 现编一次只要 1 秒。
- 站点本身**完全不需要** .NET，只有这个仪表盘需要；缺了它站点照常跑。

### 9.2 装（三个脚本，都在 `dashboard/` 下）

| 脚本 | 干什么 | 要管理员吗 |
| --- | --- | --- |
| `build.cmd` | 只用自带 csc 把 `Dashboard.cs` 编成 `BianwangDashboard.exe` | 不要 |
| `install.cmd` | 先报"编译器在不在、Node 在不在"，再编译，然后登记**登录自启**并放一个开始菜单快捷方式 | 不要（全程只写 HKCU 与用户目录） |
| `uninstall.cmd` | 只撤 `install.cmd` 加的那两样（启动项 + 快捷方式），**不碰数据、不碰口令文件、不卸载 Node** | 不要 |

双击 `install.cmd` 即可；它每步都打印结论，编译器缺失时会直接告诉你去开哪个系统功能，而不是静默失败。

### 9.3 端口：手动启动每次都得重填

这是刻意设计的，不是没做完：

- 手动双击打开时，**端口框一律空白**，不预填、不读配置；不填（或填了不在 1–65535 里的值）时「启动站点」按钮是**禁用**的。
- 理由是端口是全局唯一资源。一个"顺手记住"的号很容易悄悄撞上别的程序正在用的口，或者撞上同机第二个实例，表现为"站点起不来"却看不出为什么。
- 监听地址默认 `127.0.0.1`（只回环，交给 Nginx 反代）。改成 `0.0.0.0` 会**直接把站点对全网开放**，界面上把这行警告写在了旁边。

### 9.4 开机自启与"记住端口"的关系

登录自启和"每次填端口"天然冲突——开机时没人来填。取舍是这样的：

- 勾选「登录 Windows 后自动起站」（或跑 `install.cmd`）后，自启走 `--autostart` 参数，**沿用你上一次确认过的端口**，登录后自动把站起起来，同时窗口照常打开，你随时能停、能改端口。
- **第一次开机时如果还没有确认过的端口，它不会猜一个**。那种情况下窗口只是打开等你填，端口一个都不占——宁可等你一次，也不要拿个默认值去撞别人的服务。
- 改过端口并点过一次「启动」之后，自启用的就是新端口。

### 9.5 环境体检那一栏（缺什么说什么）

面板里七行，逐行给结论与动作：

| 行 | 判据 | 缺了会怎样 |
| --- | --- | --- |
| 站点目录 | 向上找到 `server/src/index.js`（源码）或 `api/src/index.js`（部署包） | 找不到就直接判定失败并说明该把 exe 放哪 |
| Node.js | `node -v` 且 **>= 20.19.0**（与 `package.json` 的 `engines` 一致） | 必需项，不过就不让起站 |
| pnpm | `pnpm -v` | 源码模式下是装依赖/构建要用；部署包模式已自带依赖，不算缺 |
| 依赖 | **真跑一次启动期 `import`**（不是看 `node_modules` 目录在不在，见 §9.8） | 必需项。标红时列出具体哪几个包解析不了，并禁用「启动站点」 |
| 前端产物 | `web/dist/index.html` | 给「构建前端」按钮，代跑 `pnpm build`；没有它只有接口、页面是空的 |
| 数据 | `server/data/posts.json` | 给「灌演示数据」按钮，代跑 `reseed` |
| **协议** | 按 §9.9 那一档给结论：明文 HTTP（提示）· 本机证书就位（正常，带到期日）· 前置 Nginx（提示，不校验别人那一侧）· **HTTPS 但证书不在（缺失，行内直接给「出自签证书」按钮）** | 缺证书时点「启动」会被**拒绝**，不会退回明文起站 |

边界划得很明确：**只有站点自己的东西才代跑**（装依赖、构建、灌种子——都在仓库目录内、可重做）。要往机器上装**系统级软件**（Node、pnpm）时，它只给「指引」按钮打开官方下载页，不静默安装、不提权。原因很直接：本机就没有 winget，自动安装只剩"下载官方安装包并替你点确认"这一条路，而那是你的机器，不该由一个启动器替你决定。

启动时它还会把站点根目录的 `口令.txt` 一并生成（和命令行起后端同一行为），方便查入馆口令——见 §3。

### 9.6 关掉窗口会怎样

后端是仪表盘拉起的子进程，所以关窗时会问你一句：**停掉它**、**留着继续跑**（仪表盘退出、站点不动），或**取消**。选"留着继续跑"之后站点独立存活，要再管它得重新打开仪表盘——它认得出端口上已经有一个在跑（端口被占时直接拒绝再起一个，而不是起了再 `EADDRINUSE` 退出）。

### 9.7 中文显示（乱码）已经处理过，如果你仍看到方块

这个面板的文案、后端日志和状态标记全是中文，乱码风险有四处，源码里都已封死：

| 风险 | 处理 |
| --- | --- |
| 编译器按机器 ANSI 代码页猜源码编码，把乱码烤进 exe | `build.cmd` 固定 `/codepage:65001`，源文件带 UTF-8 BOM |
| 写死某个中文字体，换台机器没装就变方块 | 启动时按候选链探测本机实际装了哪个中文字体，全都没有才退回系统默认字体 |
| 日志框用等宽西文字体（`Consolas` 无中文字形） | 日志改用同一个已解析的中文字体，正确性优先于等宽 |
| `✓` / `✗` 这类符号在中文字体里常缺字形 | 状态标记改用文字 `正常` / `警告` / `缺失` |

所以：**如果你看到的界面是乱码，几乎一定是拿旧版 exe 在跑**。`build.cmd` 会拒绝覆盖正在运行的 exe（它会直接提示"先关掉仪表盘窗口"），
所以正确顺序是：关掉仪表盘窗口 → 重跑 `dashboard\build.cmd`（或 `install.cmd`）→ 再启动。
三个 `.cmd` 脚本本身保持**纯 ASCII**，因为 cmd.exe 按 OEM 代码页读批处理，脚本里写中文只会打印成乱码。

### 9.8 往另一台机器拷文件：别只拷 `server/`（会起不来）

**症状**：拷过去用仪表盘点「启动」，日志里报

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'ip-address'
imported from ...\server\node_modules\express-rate-limit\dist\index.mjs
```

**为什么**：pnpm 的依赖树不在 `server/node_modules` 里，而在**仓库根**的 `node_modules/.pnpm/` 里——
`server/node_modules/express-rate-limit` 只是一个**指向根农场的软链接**。
你把 `server/` 单独压走再解压到别的机器，链接会被解引用成实体目录（包自己的文件带过去了），
但它的**兄弟依赖**（`ip-address` 这类）留在原来那台机器的根农场里，没跟过去。
于是 `express-rate-limit` 找得到、它 import 的东西找不到，Node 直到加载阶段才炸。

**三条正确路线，按推荐排序**：

| 做法 | 怎么做 | 适用 |
| --- | --- | --- |
| **用部署包**（推荐） | 把 `bianwang-<版本>-nginx.zip` 整个解压到目标机，用里面的 `api/` 起。`api/node_modules` 是 `pnpm deploy` 产出的**自足、无软链接**目录，拷机拷得动 | 生产部署、给别人一套能跑的 |
| 目标机上装依赖 | 把**整个仓库**（含根 `package.json`、`pnpm-lock.yaml`、`.npmrc`）拷过去，在**根目录**跑 `pnpm install --frozen-lockfile`，再 `pnpm build` | 目标机能联网/有代理 |
| 连根 `node_modules` 一起拷 | 必须连 `node_modules/.pnpm` 整棵树一起拷，且 Windows 上要保证软链接不被解引用（普通压缩会破坏它） | 不推荐，容易再踩 |

**仪表盘现在会替你挡住这件事**：「依赖」那一行不再只看 `node_modules` 目录在不在，
而是**真的把后端启动期要 import 的包逐个解析一遍**（`express` / `express-rate-limit` / `sanitize-html` /
`multer` / `cookie-parser` / `csv-*` / `diff` / `@rgrove/parse-xml` / `pdfjs-dist`）。
只拷了 `server/` 时它会标成**缺失**、列出具体哪几个包解析不了、写明是这个原因，
并且**禁用「启动站点」按钮**——不再放一个必死的进程出去。

> 顺带一句：ESM 的裸模块名是按**发起 import 的文件位置**向上找 `node_modules` 的，跟进程 cwd 无关。
> 所以这个探针脚本必须落在 `server/` 目录里跑，放 `%TEMP%` 会把一套完好的安装误判成"全部缺包"。

### 9.9 访问协议：HTTP 还是 HTTPS（默认 HTTP）

面板第一栏「运行端口与全局访问协议」下面那两个单选钮就是它。**默认 HTTP**——这不是偷懒，而是当前的现实：
生产环境暂时拿不到 SSL 证书，明文 HTTP 上线是被支持的一条路，不是一个待修的缺陷。

| 档位 | 站点实际怎么监听 | 谁能访问 | 要管理员吗 |
| --- | --- | --- | --- |
| **HTTP**（默认） | node 直接 `http://<监听>:<端口>` | 内网；**别把这个端口朝公网开放**（口令与会话在链路上是明文） | 不要 |
| **HTTPS · 本机后端持证书** | node 用 `https` 监听同一个端口 | 内网/自用；自签证书浏览器会先弹告警 | 不要 |
| **HTTPS · 前置 Nginx** | node 仍按明文只监听回环，443 与域名证书由 Nginx 负责 | 正式对外的形态 | 配 Nginx 那侧要 |

三件事值得单独说清楚：

- **「TLS 由谁终结」不是措辞游戏，它决定后端要不要证书。** 选「本机后端持证书」而证书文件不在时，
  仪表盘**拒绝起站**并写明三条出路（点「生成本机自签证书」／填已有的 pfx 路径／改回 HTTP 或选 Nginx）。
  这条拒绝是刻意的：悄悄退回明文起站，你会以为链路加密了。`run-site.cmd`（开机自启那条路）同样按这个判据拒绝，退出码 4。
- **自签证书用系统自带的能力出**：`New-SelfSignedCertificate` 在当前用户证书库里签一张（SAN 含 `localhost`、本机名与监听地址），
  再用 `Export-PfxCertificate` 导成 pfx 落到 `%LOCALAPPDATA%\Bianwang\tls\`。不装任何第三方工具，也不要管理员。
  点按钮前会弹一次明示：自签＝浏览器告警、私钥只靠 NTFS 权限保护、正式站点请换域名证书或交给 Nginx。
- **会话 Cookie 的 `Secure` 跟着真实协议走，不再跟着 `NODE_ENV`。** 后端 `production` 模式过去会硬给 cookie 加 `Secure`，
  而"生产 + 无证书 + HTTP"恰好是现在这台机器的组合——浏览器对 `http://内网IP` 这类来源一律拒收 `Secure` cookie，
  症状是"口令明明对却登不进去"。现在按请求是不是 TLS 进来判（`trust proxy` 已开，所以 Nginx 终结那条路也会正确带上 `Secure`）。

协议记在 `%LOCALAPPDATA%\Bianwang\dashboard.cfg`（`scheme=` / `tls_from=` / `tls_pfx=`），
和端口同处一份文件——所以**开机自启、`run-site.cmd`、安装器读到的都是同一个口径**，不会一个界面说 https 一个进程在听明文。
站点跑起来时协议栏是**灰的**：中途改协议会让界面显示 https 而进程还在明文听，比不给开关更糟，要改先点「停止」。

> 一个已知限制：证书路径里**不要有中文**。`run-site.cmd` 用 cmd 的 OEM 码页读配置，含中文的 pfx 路径它会读成乱码；
> 仪表盘在协议提示里会明确警告这一点。手工起站（点「启动」）不受影响，因为路径是从界面直接递给 node 的。

---

## 10. 离线完整安装包（`installer/` + `runtime/`，Windows）

交付只有**一个文件**：`bianwang-<版本>-offline-win.exe`。它是自解压安装器（NSIS，zlib 压缩），双击后提权、问一个安装目录，把「站点 + 随带运行时 + 图形安装器」整棵树解到那里，再问你要不要立刻打开安装器。

装完之后目录里是：`api\`（后端与平铺好的依赖）· `web\dist\`（前端产物）· `runtime\`（**随带运行时**，兼安装器宿主）· `dashboard\`（仪表盘源码，安装时在本机现编 exe）· `installer\`（六个 `.cmd` 引擎）· `nginx\` · `ops\` · `docs\`。

**同一个 `runtime\BianwangRuntime.exe` 有两个身份**，这是这一版形态的核心：

| 怎么起它 | 它是什么 | 谁在用 |
| --- | --- | --- |
| 带 `ELECTRON_RUN_AS_NODE=1` 起脚本 | Node 24.21.0（Electron 44.5.1 内建），行为与 `node <脚本> <参数>` 一致 | `installer\runtime.cmd` 判定后交给 `run-site.cmd`、`deploy.cmd` 的播种、仪表盘的启动与依赖探针 |
| 直接双击 | 图形安装器：四段窗口（① 自检 → ② 安装 → ③ 自启选择 → ④ 维护） | 你，以及 NSIS 安装完那一步 |

所以装机机**不需要装 Node.js，也不需要 .NET 组件**：`env.cmd` 会明说"运行时由包自己提供"，`deploy.cmd` 与 `run-site.cmd` 也不再要求 PATH 上有 `node`。要换回系统 Node 也成——把 `runtime\` 整个删掉，解析顺序就落到 PATH 上的 `node`（低于 20.19.0 会被**拒绝起站**而不是硬跑）。

**拿到的那个 exe 是不是原样**（防"包被人换过"，不是防病毒）：

```cmd
certutil -hashfile bianwang-<版本>-offline-win.exe SHA256
```

对 Release 说明里那一行；装完之后包内还有 `SHA256SUMS.txt` 可逐文件比对（`sha256sum -c`，聚合行的读法见包内 `MANIFEST.md`）。

`.exe` 一律不签名，首次运行可能弹 SmartScreen——那是未签名的必然结果，不是站点坏了。

> **双击没反应、或者文件从目录里消失了**：这是本机实测撞到的一种杀软处置（360 主动防御会把"临时目录里来历不明的 exe"执行掉再删文件；Windows Defender 无查杀记录，见 DEVELOPMENT A-24）。
> ① **别在 `%TEMP%`／浏览器下载的临时解压目录里直接双击**，先放到常规目录（例如 `D:\bianwang-offline-win.exe`）；
> ② 被拦时**先按上面的摘要核对**，确认没被替换后再选"恢复并加信任"；
> ③ 完全不想碰图形界面，就用命令行出口 `installer\setup.cmd /cli [D:\Sites\bianwang]`——它是纯批处理，**不建窗口**，
> Server Core（没有图形子系统）也只能走这条。但别说它"不碰 exe"：起后端用的仍是随包那个 `runtime\BianwangRuntime.exe`（只是以 Node 身份跑）。
> Core 上 Electron 能不能以 Node 身份起来**我们没实机验过**（R-19）；真不行就把 `runtime\` 整个删掉、装系统 Node ≥ 20.19.0，六个引擎会自动落到 PATH 上的 `node`。

安装器不重写安装逻辑——它就是那几个 `.cmd` 引擎的前置：`runtime.cmd` / `env.cmd` / `deploy.cmd` / `autostart.cmd` / `run-site.cmd` / `uninstall.cmd` / `creds.cmd`。**逻辑只有一份**，所以你从界面点、从命令行调、或者在 SSH 里没有图形界面时跑脚本，走的是同一条代码。整套只依赖系统自带的 `cmd`、`PowerShell`、`robocopy`、`schtasks`、`reg`，不装任何第三方工具。

### 10.1 一个入口 + 四个能力

| 层 | 名字 | 用法 | 要管理员吗 |
| --- | --- | --- | --- |
| **入口** | **`bianwang-<版本>-offline-win.exe`**（解包并起界面）· 装完后 **`installer\setup.cmd`** 或直接双击 `runtime\BianwangRuntime.exe` | 双击即可进界面 | 解到 `Program Files` 与"开机自启"要 |
| 界面 | `runtime\BianwangRuntime.exe` | 四段：自检 / 安装 / 自启 / 维护。**没有命令行动词**——脚本化请走下面那条批处理出口 | 同上 |
| **⓪ 运行时判定** | `runtime.cmd` | 被别的脚本 `call`，不单独跑。它设 `BW_NODE` / `BW_RUNTIME_KIND` / `BW_RUNTIME_VER`：随包的赢，否则用 PATH 上的 `node`（低于 20.19.0 返回 3，不硬跑） | 不要 |
| **① 运行环境** | `env.cmd` | `env.cmd`（只检测）· `env.cmd /install`（缺了就装） | 装 Node 看 winget 脸色，脚本本身不提权 |
| **② 部署程序** | `deploy.cmd` | `deploy.cmd <目录>`（拷过去）· `deploy.cmd <目录> /inplace`（**离线包走这条**：包已经在要跑的地方，只核对 + 播种 + 现编仪表盘） | 看目标目录是否可写 |
| **③ 自启** | `autostart.cmd` + `run-site.cmd` | `/port 8787` · `/site:boot\|none` · `/dash:on\|off` · `/status` · `/remove` | **只有 `ONSTART`+`SYSTEM` 那条要** |
| **④ 卸载** | `uninstall.cmd` | `uninstall.cmd`（交互全删）· `/quiet`（只停不删）· `/data D:\bak`（删前先拷数据）。控制面板那条卸载是 NSIS 的卸载器：先跑 `/quiet`，再删目录 | 删计划任务那一步要 |
| 查口令 | `creds.cmd` | `creds.cmd` · `creds.cmd /show` · `/root D:\x` | 不要 |

机器只能 SSH 进、没有键盘，或者干脆是 Server Core：`setup.cmd /cli` 就是那条线性四步流程（环境 → 部署 → 自启 → 实活校验），`setup.cmd /check` 只跑环境检测。**任一步失败就停下来报是哪一步**，不会把你带进"装了一半"的状态。

> **别搞混两个 `uninstall.cmd`**，它们删的东西差一个数量级：
> `dashboard\uninstall.cmd`（§9）只撤仪表盘自己登记的登录启动项和快捷方式，**不碰数据、不碰站点**；
> `installer\uninstall.cmd`（本节）是**整个部署的全删**，含 `api\data`。想收掉一个 GUI 启动器却跑错了脚本，档案就没了。

### 10.2 图形安装器的四段

**① 自检**——十项，每项给"通过 / 提示 / 失败"和一句"怎么处理"。它拦得住真问题，也不会为假问题拦你：只有**前五项**（包根 · 安装引擎 · 站点内容 · 运行时 · 依赖完整性）判失败才禁用安装按钮，其余是"知道了再继续"。

| 检查 | 判据（不是"看目录在不在"） |
| --- | --- |
| 包根 | `api\src\index.js` 在不在——它同时是"这是完整离线包"和"已经装过、这次就地维护"的判据（后者会写明"已安装，就地维护"） |
| 安装引擎 | `runtime.cmd` / `env.cmd` / `deploy.cmd` / `autostart.cmd` / `run-site.cmd` / `uninstall.cmd` / `creds.cmd` / `creds.ps1` / `setup.cmd` **九个齐**——缺任何一个直接失败，因为界面只是这些脚本的前置，逻辑只有一份 |
| 站点内容 | 后端 `api/src/index.js` · 前端产物 `web/dist/index.html` · Nginx 站点配置 `nginx/bianwang-http.conf` 三件逐个查 |
| 运行时 | 随包的 `runtime\BianwangRuntime.exe`（带 `ELECTRON_RUN_AS_NODE=1` 就是内建 Node 24.21.0）优先，没有才退回 PATH 上的 `node`；**低于 20.19.0 判失败**，判据与 `package.json` 的 `engines` 同源 |
| **依赖完整性** | **往 `api\` 里落一个探针、真 `import` 那 11 个启动期包**（清单读 `installer\startup-imports.json`），再把探针删掉。只看 `node_modules` 存在是不够的——v1.0.0 那个包就是这么带着缺失的 `ip-address` 发出去的（A-11）。装过的树在 `<目标>\api` 上跑探针，没装过在包内 `api\` 上跑。「**祖先链上不许有别的 `node_modules`**」那条判定在出包那一侧的孤立自足性闸里做（F-18），安装器这条只证明"这份 `api\` 在它现在待的位置真解析得开" |
| 落点可写 | 真写一个临时文件 + 读回来 + 删掉；失败时分"你没提权"和"这个盘写不进去/满了"两种说法 |
| 仪表盘 | `dashboard\build.cmd` 在 → 提示"安装时在本机现编"；缺了只是警告——站点本身跟 .NET 无关，用 `run-site.cmd` 照样起 |
| **访问协议** | 读仪表盘的 `dashboard.cfg`（`scheme` / `tls_from` / `tls_pfx`）后给四态结论：明文 HTTP（通过，默认档）· HTTPS 由前置 Nginx（通过，本程序不校验 Nginx）· **HTTPS + 本机证书就位**（通过）· **HTTPS + 证书不在**（**失败**：`run-site.cmd` 会拒绝起站，这不是装坏了） |
| 站点实况 | 先试端口有没有人听着，再 `GET /api/menu`——"没人听（正常）/ 200 / 有人听着但没回 200（可能不是本站那个口）"三种结论分开给 |
| 自启现状 | 两个计划任务（`BianwangSite` / `BianwangDashboard`）与 HKCU Run 键**各自读回来**，加一句是否已提权。任务查不到时会区分"确认没有"与"没查成"（`unknown`），不把查询失败说成"未注册" |

> 安装器里所有"访问地址"与实访探针都跟着上面那条协议走（`http://` 还是 `https://`），
> 探自签证书时只对**回环地址**放行、并且显式打开 TLS 1.2——这两件事不做，探针会在站点完全健康时报"无应答"（A-19）。

**② 安装**——填目标目录与端口，看流式日志。**离线包默认就是"就地安装"**（目标 ＝ 包所在目录，走 `deploy.cmd /inplace`：只核对内容、缺数据时灌一次出厂演示数据、在本机现编仪表盘，不把 400 MB 拷到别处）；填了**别的**目录才走拷贝那条路。"用 winget 代装 Node"只在没有随包运行时的树上用得到（离线包自带，通常一辈子见不着它）。**已装过再点一次就是更新**：`api\data` 与站根的口令记录都不动。

**③ 自启选择**——三选一，每个都对应一个**真实可用**的机制，不发明第三种：

| 选它 | 机制 | 权限 | 边界（界面上也照这个写） |
| --- | --- | --- | --- |
| 不注册自启 | 什么都不登记，只把站点起一次 | 不要 | 重启后要手动起 |
| 登录后自动起 | 写 `HKCU\...\Run` → `BianwangDashboard.exe --autostart`，由它沿用记录过的端口把站点带起来 | **不要管理员** | 登录前网站不可达 |
| 开机即起，无人登录也可访问 | 计划任务 `BianwangSite`（`ONSTART` / `SYSTEM`）执行 `run-site.cmd` | **要** | 客户端 Windows 即便提权也可能被策略拒绝；被拒时**自动降级成"登录后自动起"**并在日志里写明，绝不报"已装好" |

> 实测本机（Windows 11 专业版）**非提权时连 `schtasks /create /sc onlogon` 都被拒**，所以"登录态"一律走注册表 Run 键，不建登录任务——这不是省事，是那条路在别人机器上根本不通。

**④ 维护**——打开站点、实活检查 `/api/menu`、起站点（现在）、停站点（只杀占这个端口的进程，不 `taskkill /im node.exe` 乱杀）、打开口令记录、打开仪表盘；卸载分两档：**只停服务与自启（留文件）** 与 **彻底卸载（连 `api\data` 一起删）**，后者还要在弹出的小窗口里输入 `DELETE`。

**为什么站点是"另起会话"而不是安装器的子进程**：实测四种 `start` 写法都会让被派生的站点**继承调用方的 stdout 管道**，于是 `Start-Process -Wait`、`cmd | findstr`、CI 步骤会被一个跑得很好的站点卡到超时。安装器改用 ShellExecute 起独立会话，再自己探端口给结论。

### 10.3 每一步到底做了什么

**① 环境（`env.cmd`）** —— 检测三样，判据各不相同：

- **Node.js ≥ 20.19.0**：必需项，和 `package.json` 的 `engines` 一致。版本比较是逐段数字比（`v24.14.1` 拆主/次/修订），不是字符串比。
- **pnpm**：只报状态，**从不因为它缺而拦你**。部署包的依赖已经平铺在 `api\node_modules` 里，纯部署机一辈子用不到 pnpm；只有从源码树跑才需要。
- **winget**：安装通道。`/install` 时跑 `winget install --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements`。

**没有"静默装软件"这一条**：检测是免费的，安装必须有 `/install` 开关（`setup.cmd` 是在你答过一次"要"之后才加的）。winget 不存在（Windows 10 早期版本、部分 Server SKU 就没带）或者下载失败（代理、组策略、离线机）时，它**退回到指引**：打印官方下载地址并替你打开浏览器，让你自己点。网络走 `127.0.0.1:7897`，可用 `BW_PROXY` 覆盖。

"太旧"和"没有"走的是同一条 winget 路。**如果那台机器上的 Node 是当初手动装 MSI 装进去的**，winget 可能因为"这个包不是我装的"而拒绝，
脚本不会硬来——它把 winget 的返回码打出来，然后照样退回官方下载页，由你自己升上去。这条路慢一点，但不会在你机器上留下一个来历不明的安装。

还有一个容易漏的细节：winget 报成功之后，它**不信 PATH**，直接去 `%ProgramFiles%\nodejs\node.exe` 找——刚装完的 Node 不会出现在当前这个控制台的 PATH 里。

**② 部署（`deploy.cmd`）** —— 从包目录往运行位置拷：

| 去处 | 内容 |
| --- | --- |
| `<目标>\api\` | 后端 + 自足无软链接的 `node_modules` |
| `<目标>\web\dist\` | 前端产物 |
| `<目标>\dashboard\` | 仪表盘源码，**在这台机器上现编成 exe** |
| `<目标>\docs\ ops\ nginx\ installer\` | 文档、起停脚本、Nginx 片段、本套脚本 |

三条要紧的规矩：

- **不认源码仓库**。它要求旁边就有 `api\src\index.js` 和 `web\dist\index.html`，在源码仓库里直接拒绝执行并告诉你先出包。因为源码树里没有解析好的依赖，拷了也起不来。
- **`api\data` 永不被覆盖**。目标里已经有 `posts.json` 就跳过（拷贝时用 `/XD` 排除），只在目标缺数据时灌一次出厂演示数据。升级重跑这一遍，你的档案、图片、书库、口令 CSV 都原样在。
- **不信任包里的任何二进制**。exe 是在目标机上调 `dashboard\build.cmd` 现编的；编不出来也只是警告——站点本身跟 .NET 无关，照常能起。

它会挡住"把自己拷到自己身上"：源目录和目标目录解析成同一个绝对路径时直接退出，不然 robocopy 会把每个文件都报成"跳过，同一文件"，看着像失败。

**③ 自启（`autostart.cmd`）** —— 三种形态由安装器界面的第三段选出来，脚本层用开关表达：`/site:boot`（注册 `ONSTART`+`SYSTEM` 任务）· `/site:none`（什么都不注册，只把端口记进 `port.txt`）· `/dash:on|off`（要不要顺带注册仪表盘的登录任务）。默认 `boot` + `on`，也就是 `setup.cmd /cli` 走的那条线性四步。**"登录后自动起"这一档只有界面会做**：它写的是 HKCU Run 键，不属于 `autostart.cmd` 的职责（见下面 10.4 的手写办法）。

`ONSTART` 那条回答的问题是"**机器一通网就可达，不必有人登录**"——Server 上做内网服务就是这一条：

| 任务名 | 触发 | 以谁的身份 | 意图 |
| --- | --- | --- | --- |
| `BianwangSite` | `ONSTART` | `SYSTEM`，最高权限，无窗口 | 无人登录也可访问 |
| `BianwangDashboard` | `ONLOGON` | 登录的那个用户 | GUI 跟着会话回来，能看状态、读日志、改端口。它**不会**再起一个后端——先探端口，已有进程在服务就退让 |

而"登录后自动起"这一档**故意不走计划任务**：实测非提权连 `ONLOGON` 任务都建不出来，所以它落 `HKCU\...\Run` = `BianwangDashboard.exe --autostart`，普通用户权限就能成，代价是登录前不可达。写完安装器会**把注册表读回来核对**，不看"函数返回成功"就算数。

端口是这里唯一的输入。`autostart.cmd` 把答过的端口记进 `installer\port.txt`，`run-site.cmd`（计划任务真正执行的脚本）按 **`port.txt` → 仪表盘记住的端口（`%LOCALAPPDATA%\Bianwang\dashboard.cfg`）→ 没有就拒绝启动并写日志** 的顺序取值。
**第三步是故意的**：开机时没人来填端口，宁可不上，也不会猜一个默认值去撞别人正在用的服务——这条和 §9.4 是同一个取舍。取值之后还会先探一次端口，若已有进程在服务就记一句"无事可做"正常退出，避免每次开机多留一个孤儿进程。
**协议也从同一份 `dashboard.cfg` 取**（`scheme` / `tls_from` / `tls_pfx`，见 §9.9）：`https` + 本机后端且证书在，就以 `BW_TLS_PFX` 起 node（真 TLS 监听）；`https` + 前置 Nginx，后端仍按明文只听回环；`https` + 证书不在，**退出码 4 并写明拒绝原因**，不会退回明文糊你一次"启动成功"。

注册完它会 `schtasks /run` 立刻跑一遍**并真的去连端口**确认，这样你不用重启就能知道开机这条路通不通。`/status` 在**非提权**下也能用（读注册信息是无害动作，所以它放在提权闸门之前）。

**④ 卸载（`uninstall.cmd`）** —— 按你的要求**全删，含 `api\data`**。顺序：停住端口的 node 进程 → 删两个计划任务 → 撤登录启动项和开始菜单快捷方式 → 删整个程序目录。

因为不可撤销，它要求打出 `DELETE` 才动手，并先给一次"删前拷一份 `api\data`"的机会（只拷、从不删那份拷贝）。`/quiet` 是"只停不删"的半程卸载，`/data D:\bak` 直接指定拷贝去处。

> **它为什么自己再跑一遍**：cmd.exe 是**逐行懒读**批处理文件的，而这个脚本平时就住在它要删的树里。实测过一次干净的卸载：目录确实没了，但 `rd` 之后的每一行都变成"系统找不到指定的路径"，返回码 1——把结论打成失败。所以它会先把自身拷进 `%TEMP%`（树外），由那份拷贝来删并给结论，启动器在**同一行**上退出。**你答问题、看报告的是那个新弹出的窗口**，别提前关它。

### 10.4 Windows 10 与 Server 2019 的差别

两处会不一样，其余（计划任务、PowerShell 5.1、自带 `csc.exe`、robocopy）两版都有：

| | Windows 10 桌面版 | Windows Server 2019 |
| --- | --- | --- |
| **管理员** | 常见是单个交互用户，`setup.cmd` 在非提权窗口里会**警告并继续**：①②照样成，③注册不了 `ONSTART`+`SYSTEM`。要在提权 cmd 里重跑 | 服务机默认就该由管理员装；提权窗口是常态。注意 `SYSTEM` 账户的 PATH 里未必有 Node——按机器范围装的 MSI 才对所有账户可见，装在个人目录下的那种开机任务找不到 `node` |
| **winget** | 新版本随 App Installer 带上；早期 1809 之前的版本没有 | **默认不带**（Server 的 App Installer 要另装）。`env.cmd` 在这条路上会退回"打开官方下载页"，你手动跑 `.msi` 即可 |

对 Server 上还有一条：**`BianwangSite` 是隐藏任务、无控制台**，所以它的输出去 `installer\run-site.log`，出问题先看那个文件而不是界面。

**实测撞到的一条差异，别当成"装坏了"**：在客户端 Windows（本机 Windows 11 专业版）上，**即便窗口已提权**，
`schtasks` 也可能拒绝把任务身份设成 `SYSTEM`——客户端 SKU 的"作为批处理登录 / 作为服务登录"策略会拦，
而任务计划程序只回一句"拒绝访问"，不告诉你是哪一条。此时 `autostart.cmd` **不会整段放弃**：
照常注册仪表盘的登录任务（`ONLOGON`，在这个提权窗口里建得出来）→ 直接把站点拉起来（证明程序本身能跑）→ 探端口确认 → 以 **rc 4** 退出，
并明写"这样起来的站点重启后不会自己回来"。Server 2019（服务器 SKU）上这条 normally 通。图形安装器遇到 rc 4 时还会多做一步：把选择**降级成"登录后自动起"**，也就是替你写下面那条 Run 键。
如果你的机器也报拒绝访问，三条出路：① 在界面第 3 段改选**"登录后自动起"**——它不碰任务计划程序，
写的是你自己账户下的 `HKCU\...\Run`（值名 `BianwangDashboard`，数据是 `"<目标>\dashboard\BianwangDashboard.exe" --autostart`），**免管理员**；
只有界面的第三段会写这条键，`setup.cmd /cli` 撞到 rc 4 时只起本次会话并提示你改选它。纯 SSH 的机器想自己补，就照上面那对"值名＋数据" `reg add` 一次，
然后跑 `installer\setup.cmd /check` 或看界面"自启现状"那一项读回来的结果（写完必须读回，别信"命令没报错"）；
注意"登录后自动起"如果走 `schtasks /sc onlogon`，在**非提权**窗口里同样会被拒（实测），
所以这一档就是 Run 键，不是任务；② 用服务包装器把后端注册成服务（**引第三方件前先核许可**，本项目只收宽松许可）；
③ 请管理员检查该机的"Log on as a batch job / Log on as a service"策略。

### 10.5 口令文件在哪里

后端**第一次启动时**在站点根目录生成 `口令.txt`（中文命名），列出所有登录口令与镜像入馆口令，明文，含默认 `admin` / `admin`。

- 部署之后它在 `<目标>\口令.txt`，**不在包里**，也不随包分发。
- 批处理脚本里不能出现这个文件名（cmd.exe 按 OEM 代码页读 `.cmd`，写中文只会打印成乱码），所以打开它交给 `creds.ps1` 按码点拼出名字——**用 `installer\creds.cmd`**，`/show` 只报位置不弹窗。
- 它就在文件系统里躺着，**权限即边界**：那台机器上能读该目录的人就等于拿到了全部口令。第一次登录就改 `admin`，别用它对外。
- 卸载会连它一起删（明文文件没有理由在站点没了之后留下）。`BW_CRED_FILE=0` 可以关掉生成，见 [README §六 环境变量](README.md)。
