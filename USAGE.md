# 辨妄阁 · 使用说明书

面向**馆员与运营**的操作手册：怎么新增图文、怎么查入馆口令、怎么增删用户、怎么管菜单，
以及一份**从零到上线的 Nginx 部署建站指南**。

- 想先跑起来看效果：见 [§0 起步](#0-起步三分钟跑起来)。
- 只想改内容：看 [§2 新增图文](#2-新增图文核心)。
- 只管站点：看 [§7 Nginx 部署建站](#7-nginx-部署建站指南从零到上线)。
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
> - 放进 **Nginx html 根**的，只有前端产物 **`web/dist/`**（`index.html` + `assets/`）——静态部分单独打包见交付物 `nginx-html-webdist.zip`。
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

面板里六行，逐行给结论与动作：

| 行 | 判据 | 缺了会怎样 |
| --- | --- | --- |
| 站点目录 | 向上找到 `server/src/index.js`（源码）或 `api/src/index.js`（部署包） | 找不到就直接判定失败并说明该把 exe 放哪 |
| Node.js | `node -v` 且 **>= 20.19.0**（与 `package.json` 的 `engines` 一致） | 必需项，不过就不让起站 |
| pnpm | `pnpm -v` | 源码模式下是装依赖/构建要用；部署包模式已自带依赖，不算缺 |
| 依赖 | `node_modules` 是否存在 | 给一个「装依赖」按钮，代跑 `pnpm install` |
| 前端产物 | `web/dist/index.html` | 给「构建前端」按钮，代跑 `pnpm build`；没有它只有接口、页面是空的 |
| 数据 | `server/data/posts.json` | 给「灌演示数据」按钮，代跑 `reseed` |

边界划得很明确：**只有站点自己的东西才代跑**（装依赖、构建、灌种子——都在仓库目录内、可重做）。要往机器上装**系统级软件**（Node、pnpm）时，它只给「指引」按钮打开官方下载页，不静默安装、不提权。原因很直接：本机就没有 winget，自动安装只剩"下载官方安装包并替你点确认"这一条路，而那是你的机器，不该由一个启动器替你决定。

启动时它还会把站点根目录的 `口令.txt` 一并生成（和命令行起后端同一行为），方便查入馆口令——见 §3。

### 9.6 关掉窗口会怎样

后端是仪表盘拉起的子进程，所以关窗时会问你一句：**停掉它**、**留着继续跑**（仪表盘退出、站点不动），或**取消**。选"留着继续跑"之后站点独立存活，要再管它得重新打开仪表盘——它认得出端口上已经有一个在跑。
