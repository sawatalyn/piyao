# 部署手册（Nginx + Node + JSON 文件存储）

架构：Nginx 只做静态托管与反向代理，Node 进程只监听 `127.0.0.1:8787`，数据以 JSON/CSV 落在服务端目录。

```
浏览器 ──HTTPS──> Nginx ──┬── /            → web/dist（静态产物）
                          └── /api/…       → 127.0.0.1:8787（Node，仅回环）
                                             └── server/data/*.json · users.csv · media/
```

## 一、准备产物

两条路，二选一：

### A. 从仓库自己构建

```bash
pnpm install
pnpm build                 # 先跑 prebuild：生成许可登记表 → 依赖守卫（精确 pin 与许可白名单，不合格即失败），再产出 web/dist
node server/scripts/reseed.js   # 可选：写入演示数据（正式环境请跳过或先清空 data）
```

需要拷贝到服务器的两样东西：`web/dist/` 与 `server/`（含 `node_modules`，或用 `pnpm install --prod` 在目标机安装）。
**目标机安装请用 `pnpm install --frozen-lockfile`**：所有依赖已精确 pin 且 lockfile 同步，
这样拿到的字节与本机验证过的完全一致（本项目交付的是"解压即放到 Nginx 上跑"的包，浮动版本不可接受）。

### B. 部署包：离线完整安装包（推荐交付形态）与站点树

```bash
pnpm build
node scripts/make-nginx-package.mjs                      # 预演：列出包内去向，并点名"哪些运行态被挡在包外"
node scripts/make-nginx-package.mjs --write              # 生成 outputs/package/bianwang-<版本>-nginx/（站点树，零 exe）
node scripts/make-nginx-package.mjs --write --zip        # 再压成同名 .zip（Linux/Nginx 路线直接用它）
node scripts/make-offline-package.mjs                    # 离线包预演：点名要用哪两个外部二进制与各自校验值
pnpm package:offline                                     # 出 bianwang-<版本>-offline-win.exe（单个自解压 exe）
```

**Windows 机器只给一种东西：那个自解压 exe。** 站点树（`-nginx/` 与 `-nginx.zip`）仍在生产线上，但它是**离线包的输入**与 Linux/Nginx 路线的产物，不再作为 Windows 交付物：

| | `bianwang-<版本>-offline-win.exe` | `bianwang-<版本>-nginx.zip` |
| --- | --- | --- |
| 面向 | Windows 10 / Server 2019 及以上，x64 | 任何有 Nginx 的平台（含 Windows） |
| 装机机要预装什么 | **什么也不用**：包内 `runtime\BianwangRuntime.exe` 就是 Node 24.21.0（Electron 44.5.1 内建） | Node.js ≥ 20.19.0（这棵树不带随包运行时） |
| 怎么开始装 | 双击这个 exe：提权 → 选目录 → 整棵树解过去 → 起四段界面（自检/安装/自启/维护） | 解压后跑 `installer\setup.cmd /cli`（这棵树里没有图形安装器，双击 `setup.cmd` 会直接告诉你它找不到 `runtime\BianwangRuntime.exe`） |
| 体积 | 171 MB 量级（Electron 运行时占大头） | 26 MB 量级 |
| 前置条件 | 无（Server Core 没有图形子系统 → 只能走 `setup.cmd /cli`；它仍把随包运行时当 Node 用，Core 上这一条**未实机验过**，不行就删 `runtime\` 换系统 Node，见 `USAGE.md` §10 与 R-19） | 见"面向"那一栏 |

`package:offline` 的门同样是**硬**的，而且比上一版多三道：**外部二进制按 sha256 取用**（Electron 官方运行包与 NSIS 工具包都先比对声明的字节数与摘要，对不上直接停，不"顺手用本地那份"）、**交付物内 `.exe` 白名单**（只允许 `runtime\` 那一套 Electron 可执行文件，别处冒出来就拒绝出包）、**依赖探针清单三处同源**（`installer\startup-imports.json` ↔ `installer-app\core.cjs` ↔ `dashboard\Dashboard.cs`）。站点那半的六道闸（含孤立自足性真起后端）一次不少地先跑一遍。接收方拿到 exe 先自己算一遍：

```cmd
certutil -hashfile bianwang-<版本>-offline-win.exe SHA256
```

> 这一行的摘要**每次出包都会变**，因为包内容变了；但它和上一版**没有"必须相同"也没有"必须不同"的关系**——比对的对象是 Release 说明里那一条，不是历史包。
> 装完之后还有一层逐文件的：包内 `SHA256SUMS.txt`（`api/node_modules` 那行是聚合摘要，读法见包内 `MANIFEST.md`）。

`api/` 由打包脚本**每次现做**（内部跑 `pnpm --filter server deploy --legacy --prod`），不接受手工先跑一遍留下的旧快照：
实测踩过一次——改了 `server/src/index.js` 之后包里的 `api/` 还是修复前的那份，因为 `.api-deploy` 是更早的 deploy 产物。
`pnpm api:prod` 只在你想单独看一眼 deploy 产物时用它。

包结构：`web/dist/`（Nginx root；后端在没有 Nginx 时也按 `api/../../web/dist` 自己伺服，便于单机先点一遍）·
`api/`（Node 后端 + 生产依赖 + 出厂 data）· `nginx/`（站点与安全片段）·
`ops/`（env 样例、systemd 单元、起停脚本、`verify-deploy.mjs` 验收）· `docs/`（四份文档）·
`dashboard/`（Windows 仪表盘源码，exe 在目标机现编）· `installer/`（**Windows 一键安装的六个引擎**：`runtime.cmd`（运行时判定只此一处）+ `env` / `deploy`（认 `/inplace`）/ `autostart` / `run-site` / `uninstall` / `creds`，全部 CRLF + 纯 ASCII；离线包另带 `offline.nsi` 与 `startup-imports.json`。图形界面在 `runtime\resources\app`，见 `USAGE.md` §10）·
`MANIFEST.md` 与 `SHA256SUMS.txt`（逐件校验值；`api/node_modules` 2300+ 个文件不逐条列，改为末行一条 `# 注释`里的聚合摘要，所以 `sha256sum -c SHA256SUMS.txt` 应当**全部 OK、退出码 0**）。

**zip 现在在 Linux 上也解得开**：条目名一律用 `/` 且全部 ASCII（压缩步骤由 `scripts/make-zip.ps1` 代做，压完读回中央目录把这两条当闸门）。
旧版用 `Compress-Archive` 时 2463 条条目**全部带 `\`**，`unzip` 会把每条解成一个"文件名里有反斜杠"的平面文件，目录树根本不成立；
包内非 ASCII 的条目名还会按机器码页写、不带 UTF-8 标志位，换一端就是乱码——受影响的正是镜像站按文件名取实体的三本演示册，
所以演示件的**文件名**改成 `bianwang-demo-*`（**标题**仍是中文，界面与自检都按 title 匹配）。成因与实测见 `DEVELOPMENT.md` A-25 / A-26。

**打包脚本会刻意把运行态挡在包外**（清单里逐条打印）：`api/data/.secret`（会话与全部签名的主密钥）、
`sessions.json`（活着的会话）、`security.log*`（含来源 IP 的审计流水）、`login-attempts.json`（锁定计数）。
包内的 `api/data/` 会被**整目录清空后重播**（跑包内自己的 `scripts/reseed.js`），
所以出厂态与 `pnpm seed` 完全一致，不会夹带开发期经界面上传的图片；
`reseed` 顺带生成的 `.secret` 也在出包前删掉，让部署机首启各自生成。
最后再扫一遍包内是否还有运行态文件，有就拒绝出包。
`node_modules` 现在由 `pnpm deploy --config.node-linker=hoisted` **平铺成实体目录**（零软链接）后才进包，所以拷到没有软链接权限的 Windows 机上也不会碎。
这条不是美化：默认的 isolated 链接器 + 复制时解引用会**把包和它的兄弟依赖拆开**——`express-rate-limit` 的文件跟着走了，它 import 的 `ip-address` 留在原机的根农场里，
于是包在开发机上测什么都正常（仓库根的农场是它的祖先目录，静默兜住了），换机才炸。
出包脚本因此在**每次出包时硬校验两件事**：① 包内 `api/node_modules` 的软链接条数必须为 0；
② 把 `api/` 拷到 `%TEMP%` 下一个**祖先目录里没有任何 `node_modules`** 的位置（校验前会先确认这点，否则拒绝校验）真起一次后端并请求 `/api/menu`，
只有"进程起来 + HTTP 200 + 拿到条目"才允许出包。这条 gate 是那次线上翻车之后加的，见 DEVELOPMENT §四 与 §六。

**出包后要再做一次"解压到别处以带 `.` 的目录 + 就地起"**（本机 `Expand-Archive` 到 `.scratch-*` 或部署路径本身以 `.` 开头，
例如 `.httpdocs`）：`node api/src/index.js` 起来后 `node ops/verify-deploy.mjs http://127.0.0.1:<端口> --expect-prod`。
这一步不是走过场——它抓到过一个只在"换机 + 换路径"时才暴露的缺陷（DEVELOPMENT §六 A-6）：
单页兜底原来传的是绝对路径，`send` 会把整条路径按段做隐藏文件检查，站点被放进点开头目录时首页直接 404，
而 `web/dist` 的静态伺服却照常 200，看起来像"包坏了"而不是"路径写法有问题"。

`web/dist/` 内含编译后的 CKEditor（GPL-2.0-or-later），因此包里带 `LICENSE-NOTE.txt` 与 `LICENSE-CKEDITOR-COPYING.GPL`：
自用部署不触发分发义务，**把包交给第三方或公开整站时，整份前端源码须按同许可释出**（见 §四 R-3 与 LICENSE-NOTE）。

## 二、Linux（systemd + Nginx）

> 下面 §二 §三 按**路线 A**（从仓库构建）写，后端目录叫 `server/`。走**路线 B** 的部署包时把它换成 `api/`：
> 目标机**不需要** `pnpm install --prod`（生产依赖已在包内且解引用成实体目录），
> systemd 的 `WorkingDirectory=/srv/bianwang/api`、`ExecStart=/usr/bin/node src/index.js` 不变，
> `BW_DATA_DIR` 要么另指一个包外目录（推荐，升级时整目录替换 `api/` 不碰数据），要么留空用包内 `api/data/`。

```bash
# 1. 放置文件
sudo mkdir -p /var/www/bianwang/dist /srv/bianwang
sudo cp -r web/dist/* /var/www/bianwang/dist/     # nginx/bianwang.conf 里的 root 就是 /var/www/bianwang/dist
sudo cp -r server /srv/bianwang/server
sudo chown -R bianwang:bianwang /srv/bianwang

# 2. 环境变量（密钥与数据目录）
sudo tee /etc/bianwang.env >/dev/null <<'ENV'
NODE_ENV=production
BW_HOST=127.0.0.1
BW_PORT=8787
BW_DATA_DIR=/srv/bianwang/data
BW_SECRET=请替换为 64 位以上随机串
BW_HASH_PASSWORDS=1
# 可选：BW_REVISION_KEEP=30（每档留几版快照）、BW_WRITE_LIMIT_PER_MIN=40（登录写操作每分钟上限）
ENV
sudo chmod 600 /etc/bianwang.env

# 3. systemd
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
sudo systemctl enable --now bianwang

# 4. Nginx（**二选一**：有证书装 bianwang.conf，暂时没有证书装 bianwang-http.conf）
sudo cp nginx/bianwang-proxy.inc /etc/nginx/
sudo cp nginx/bianwang.conf /etc/nginx/sites-available/bianwang          # HTTPS 版：80→443 + 证书 + HSTS
# sudo cp nginx/bianwang-http.conf /etc/nginx/sites-available/bianwang   # HTTP 版：无证书也能上线，防护齐、只是不加密
sudo ln -sf /etc/nginx/sites-available/bianwang /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

改 `server_name` 与证书路径；证书建议用 certbot 签发后由 Nginx 终止 TLS。

**为什么有两份**：`bianwang.conf` 假定你已经有证书（80 一律 301 到 https），没证书照装会得到一个"永远跳转打不开"的站。
`bianwang-http.conf` 保留全部防护（限流、反爬指纹、数据文件封禁、CSP、`server_tokens off`），只去掉 TLS 与 HSTS——
**故意不发 HSTS**，因为它一旦发布就很难撤回，等真上了 HTTPS 再换回 `bianwang.conf` 才有。
后端自己也是同一条判据：`NODE_ENV=production` 只决定"要不要发 CSP 与禁缓存"，而 HSTS 与 CSP 里的
`upgrade-insecure-requests` 看的是**这一条请求有没有真走 TLS**（经 Nginx 时由 `X-Forwarded-Proto` 带上，后端自签时由 TLS 监听决定）。
直连后端跑明文 HTTP 时若照样发 UIR，浏览器会把每个请求改写成 https，而那台机器上并没有 TLS 监听，症状是"页面全白、接口一条不发"（实测见 `DEVELOPMENT.md` E-10）。
两份的 `limit_req_zone` 同名，同时启用 `nginx -t` 会直接报 duplicate zone 拒绝加载（不会静默混用两套规则）。

> 明文 HTTP 上线的边界要说清楚：口令与会话 cookie 在这条链路上是可读的，只应在受信网段开放，不要把 80 端口映射到公网。
> 后端这边已经配合到位：会话 cookie 的 `Secure` 按**请求是否真走 TLS** 判（`trust proxy` 已开，认 `X-Forwarded-Proto`），
> 所以 HTTP 部署不会被自己的 cookie 属性打死（详见 `USAGE.md` §9.9、`DEVELOPMENT.md` R-16）。
> Windows 单机不想上 Nginx 时，还有第三条路：在仪表盘把协议选成 HTTPS + 本机后端持证书，node 自己以 TLS 监听（自签证书一键生成）。

## 三、Windows（nginx.exe + 计划任务）

> **只想双击装完就用**：双击离线包 `bianwang-<版本>-offline-win.exe`，它会提权、问一个安装目录、把整棵树解过去，再起四段窗口（自检 → 安装 → 自启选择 → 维护）把环境检测、部署、自启注册、
> 实活检查按顺序做完；只有选"开机即起"那一段才真正需要管理员（解包本身就要）。装完之后随时可以再开同一个界面：双击 `runtime\BianwangRuntime.exe`，或 `installer\setup.cmd`。
> 拿的是站点树 zip（Linux/Nginx 路线，或手里只有 `-nginx.zip`）时，`installer\setup.cmd` 会明确告诉你这里没有随带运行时、图形安装器起不来，并把你引向 `setup.cmd /cli`。
> 没有图形界面（SSH / 无键盘 / Server Core）时就用 `installer\setup.cmd /cli [D:\Sites\bianwang]`——纯批处理、**不建窗口**；
> 但起后端用的仍是随包那个 `runtime\BianwangRuntime.exe`（只是以 Node 身份跑，Core 上没实机验过，不行就删 `runtime\` 换系统 Node）。
> 全程对应 `USAGE.md` §10。下面这段是它做的四件事的**手工等价**，供需要自己控制落点或接入既有 nginx 安装时使用。

```bat
:: 1. 产物就位
xcopy /E /I web\dist C:\bianwang\www
xcopy /E /I server C:\bianwang\server
cd C:\bianwang\server && pnpm install --prod

:: 2. 环境变量（当前会话示例；正式建议写入系统环境变量）
setx /M NODE_ENV production
setx /M BW_HOST 127.0.0.1
setx /M BW_PORT 8787
setx /M BW_DATA_DIR C:\bianwang\data
setx /M BW_HASH_PASSWORDS 1

:: 3. 后端常驻（用任务计划程序开机自启，或 nssm 注册为服务）
schtasks /Create /TN BianwangAPI /TR "node C:\bianwang\server\src\index.js" /SC ONSTART /RU SYSTEM /F
schtasks /Run /TN BianwangAPI

:: 4. Nginx：把 nginx/bianwang.conf 的 root 改成 C:/bianwang/www，
::    放入 conf.d/，然后
cd C:\nginx && start nginx
nginx -t
nginx -s reload
```

Windows 注意：`server/data`（路线 B 则是 `api/data`）必须放在 **Nginx root 之外**；配置文件里已用扩展名与路径黑名单兜底，
但不要把数据目录拷进 web root（本手册的 Windows 示例里那是 `C:\bianwang\www`）。

## 四、必做的安全收口

1. **改默认口令**：登录后进「用户名册」，同名提交 `admin` 即改密（新密码 ≥8 位）。
   名册出厂另有 `demo` / `demo-pass`（示例馆员，角色 editor），可直接移除；重跑 `pnpm seed` 只会补回这一行，
   **不会覆盖任何已改过的口令**。
2. **启用哈希存储**：`BW_HASH_PASSWORDS=1` 后再改一次密码，CSV 里即存 scrypt 摘要。
   需求指定的明文形态只应在内网或演示环境使用。
3. **备份**：`server/data` 整目录即为全量状态（档案、话题、菜单、名册、图片、图片索引、审计日志、
   **档案版本台账 `revisions.json`**、镜像书目 `library.json` 与口令表 `library-keys.json`）；
   镜像原件在 `server/data/library/`，登记信息只是索引，两处都要备。建议 `tar`/`robocopy` 每日快照；
   恢复即整目录替换后重启进程。恢复后**不必**重启也能生效的只有按数据代次失效的那几类（列表、检索、书目）；
   版本台账与媒体索引建议重启一次以免读到混合状态。
4. **密钥**：`BW_SECRET` 决定会话与图片签名，多实例必须一致；缺失时首次启动会自动生成 `.secret`（权限 0600），不要提交到仓库。
5. **Nginx 层复核**：`client_max_body_size 5m`（与后端一致）、`/api/` 限流、`location ~ /\.` 拒绝隐藏文件、`autoindex off`。
   在线阅览走 `location ~ ^/api/library/[^/]+/(reader|asset)`（复用 `bw_media` 频控），下载走 `/api/library/files/`（关缓冲、长超时）；
   两条都不得改成公共缓存——响应带 `no-store`，且 URL 上有口令令牌。
6. **访问日志里的令牌**：取书与阅览插图把 10 分钟时效的令牌放在查询串里，会进 `access_log`。
   日志须仅本机可读（`chmod 640`），或按需对 `/api/library/` 单设 `access_log off`；过期后令牌自废，吊销口令即刻作废已发令牌。

## 五、验证清单

上线后**先跑部署包自带的验收**（默认只读，不写任何东西；报告落盘 `ops/verify-report-<时间戳>.md`）：

```bash
node ops/verify-deploy.mjs https://你的域名 --expect-prod
# 要看写链路（建档→修订→比对→置顶→删除，跑完自清）：
node ops/verify-deploy.mjs https://你的域名 --expect-prod --mutate --user admin --pass '改过的口令'
```

> `--mutate` 会临时转移一次全局置顶（置顶唯一），跑完请在页面上把原置顶重新点一次。
> 三项判读口径写进报告开头：**FAIL**＝站点真不通；**WARN**＝只在生产入口才要求（如 CSP）；
> **INFO**＝只有请求经过 Nginx 才成立（如 `/assets/` 的 `immutable`），永不判红。

开发仓库侧的全量自检（三套必须串行，且不能与数据变更并发）：

```bash
node scripts/pin-guard.mjs         # 依赖守卫：精确 pin / 许可白名单 / 用途登记，不绿就别上线
node scripts/api-smoke.mjs         # 48 项接口自检（权限、置顶唯一、净化、限流、签名直链、反爬、版本与馆务端点、全站版本台账总表）
node scripts/full-sweep.mjs        # 221 项：另起 7 个隔离实例，含镜像口令门控、EPUB/PDF 阅览边界、预览白名单、版本台账与全站台账总表、媒体对账与出厂示例实体、会话 cookie 的 Secure 与 HSTS/UIR 跟随真实协议
node scripts/walkthrough.mjs       # 165 项浏览器端到端走查 + 截图（需先起 Chrome 调试端口）
node scripts/browser-probe.mjs http://127.0.0.1:8787/   # 主线程是否阻塞 / 关键节点计数
pnpm audit:ui                      # Yan 阵营界面契约（51 个前端文件）
```

> 三套自检**必须串行**（并发跑会撞数据基线，产生幻影失败）；走查每轮先 `reseed` 取确定基线。

浏览器手工核对：首页瀑布流滚动到接近底部会自动取下一批；点卡片进详情看双栏对勘与图上圈划；
未登录时「新增图文 / 重排 / 菜单编辑 / 用户名册 / 馆务台账 / 版本台账总表」应被引导到登录页；页脚协议表与实际依赖一致；
`/library` 输入口令后点「在线阅览」，翻到下一章地址栏应变成 `?c=N` 且不整页闪白，10MB 以上的书只给分页、不给整本；
**未勾选「允许在线预览」的书不应出现阅览入口**，直接敲 URL 应回"此书未加入预览白名单，仅可下载"；
PDF 那本按书签逐节翻，页内**不该出现位图或 canvas**（只走文字层）；
详情页「版本台账」修订一次后应有两版，比对页正文按字与词标出增删；
`/ops` 馆务台账能读出媒体四栏对账，「先预演」不改盘，清理按钮必须走二次确认；
`/ledger` 版本台账总表能读出全站口径五分栏，按档案/动作筛选生效，删过的档案其历史版本标「已撤档」仍在册。

## 六、常见故障

| 现象 | 判断路径 |
| --- | --- |
| 图片显示"链接已过期" | 签名有效期默认 30 分钟；`BW_SECRET` 变更后旧链接全部失效，刷新页面即可 |
| 登录提示 429 | 同一 IP **或同一用户名** 连续失败 5 次锁 10 分钟，计数存 `data/login-attempts.json`，删该文件可本地复位 |
| 保存提示"缺少有效的操作令牌" | 会话已换发 CSRF 令牌，刷新页面重新取 `/api/auth/me` |
| 列表 403 deep-page | 游客翻页超过 20 页需登录，属反批量抓取设计 |
| 上传 415 | 只按文件头魔数判定 JPEG/PNG/GIF/WebP/AVIF，改扩展名无效 |
| 改动未生效 | JSON 写入是内存即时 + 磁盘排队；若磁盘不可写会打印 `[store] 写入 … 失败` |
| 阅览回 403 `preview-off` | 该书没勾「允许在线预览」。这是设计不是故障：在 `/library` 书目管理里逐本开启，或让馆员重新登记 |
| 阅览回 409 `asset-epub-only` | 对 PDF 请求了包内插图（PDF 没有"包内路径"概念）；PDF 只出文字层 |
| PDF 阅览页是空的 | 该 PDF 无文字层（扫描件）。当前不做服务端光栅化，请下载原文件核对版式 |
| 修订后版本台账只有一版 | `revisions.json` 是本轮新增的文件；老装机需要 `pnpm seed` 补一份建档快照，或让馆员修订一次自然累积 |
| 台账/比对页 429 | 写操作上限默认 40 次/分（`BW_WRITE_LIMIT_PER_MIN`）。批量导入时临时调高，跑完改回；**不要**在生产放宽 |
| 馆务台账里"索引死链"不为零 | 档案正文仍引用已不存在的图片文件。修法是按提示**重传**，不要删索引记录（删了图就永久无解） |
| `security.log` 一直涨 | 512KB 逐级轮转、保留 5 份（`security.log.1..5`）。要长期留存请外接采集器——`audit()` 只有一个写点、事件名与字段是稳定契约 |
| 换机后起不来，报 `ERR_MODULE_NOT_FOUND`（如 `Cannot find package 'ip-address'`） | **只拷了 `server/` 没拷仓库根**：pnpm 的依赖农场在根 `node_modules/.pnpm/`，`server/node_modules/*` 只是指向它的软链接，压缩解压会被解引用、兄弟依赖留在原机。改用本包的 `api/`（`pnpm deploy --config.node-linker=hoisted` 产出、平铺无软链接，出包时已在 `%TEMP%` 下孤立真起一次），或在**仓库根**跑 `pnpm install --frozen-lockfile`。详见 `USAGE.md` §9.8 |
| 双击 `installer\setup.cmd` 后没有界面，只说"找不到随包运行时" | 你手上拿的是**站点树**（`-nginx.zip`），里面本来就没有 `runtime\BianwangRuntime.exe`——图形安装器就是那个文件，没有它就没有界面。两条出路：① 改拿离线包那个 exe；② 就在这棵树上走 `installer\setup.cmd /cli`，它只需要 PATH 上有 Node ≥ 20.19.0（太旧会拒绝而不是硬起）。**不再需要 `csc.exe`**：旧版在这里让你去开 .NET 组件、是因为它要先现编一个安装器，那一步已经随 WinForms 形态退役（`DEVELOPMENT.md` D-19） |
| 双击离线包 `bianwang-<版本>-offline-win.exe` 弹出 SmartScreen「已保护你的电脑」 | 未签名 exe 的必然表现（本机出包不签证书）。先按 §一 B 用 `certutil -hashfile` 核对 sha256 与 Release 说明那一行一致，再点「更多信息 → 仍要运行」。摘要对不上就**别运行**，那是包被替换过。只要命令行交付的路线请走站点树 zip + `setup.cmd /cli` |
| 双击离线包**没有任何反应，或者文件从目录里消失了** | 第三方杀软的"未知程序"处置，本机实测由 360 主动防御做出（Defender 无查杀记录；`DEVELOPMENT.md` A-24）。① **别在 `%TEMP%`／浏览器下载目录的临时解压里直接双击**，先把 exe 放到常规目录再跑；② 仍被拦就先 `certutil -hashfile` 核对摘要，然后在杀软里"恢复并加信任"；③ 不想碰图形界面就 `installer\setup.cmd /cli`（纯批处理、不建窗口；注意它**仍以随包运行时当 Node**，真被拦就删 `runtime\` 换系统 Node ≥ 20.19.0，六个引擎会自动落到 PATH 上的 `node`） |
| 装了半天，起的是**包里那份**而不是目标目录的站（口令记录、`run-site.log` 落进了包目录） | 这是旧版安装器的缺陷（A-17）：装完之后引擎脚本必须从 `<目标>\installer\` 那份调用，只有 `deploy.cmd` / `env.cmd` 留在包目录跑（它们的"包根"是自己的上一层）。用本包的安装器不会遇到；手工操作时记得 `cd` 到 `<目标>\installer\` 再跑 `autostart.cmd` |
| `installer\autostart.cmd` 说"需要管理员" | `schtasks /sc onstart /ru SYSTEM` 是非提权做不到的动作，脚本用 `net session` 探到就直接拒绝，**这是设计**：半权限注册出来的任务会在开机时静默不跑。开提权 cmd 重跑即可；只想看现状用 `autostart.cmd /status`，那个不需要提权。**"登录后自动起"这一档不需要管理员**——它走 `HKCU\...\Run`，因为实测非提权时连 `schtasks /sc onlogon` 都被拒 |
| 已提权仍报"could not create the boot task (access denied)" | 客户端 Windows（实测 Windows 11 专业版）的组策略可以不让管理员令牌把任务身份设成 `SYSTEM`，任务计划程序只回"拒绝访问"。脚本会**降级而不是放弃**：仍注册登录任务、仍把站点直接拉起来并探端口确认，最后 rc 4 并写明"重启后不会自愈"。Server 2019 正常允许。三条出路见 `USAGE.md` §10.4 |
| 开机后站点没起来 | 看 `<目标>\installer\run-site.log`。最常见是没有端口可绑：`run-site.cmd` 只认 `installer\port.txt`，其次才是仪表盘记住的端口（`%LOCALAPPDATA%\Bianwang\dashboard.cfg`），**两个都没有就拒绝启动并写日志**，绝不猜一个默认值去撞别人的服务。跑一次 `autostart.cmd /port <端口>` 记下即可。另一常见原因是 `node` 不在 `SYSTEM` 账户的 PATH 里——Node 要按**机器范围**装（MSI），装在个人目录下开机任务找不到 |
| 选了 HTTPS 之后"站点起不来"，日志写着 `拒绝启动（不会退回明文 HTTP）` | **这不是故障，是设计**：协议是 HTTPS + 本机后端持证书，但 `dashboard.cfg` 里记的 `tls_pfx` 不存在。三条出路：仪表盘点「生成本机自签证书」（系统自带 PowerShell，不要管理员）／把已有 pfx 的路径填进证书框／改选「前置 Nginx」或退回 HTTP。`run-site.cmd` 在这种情况下退出码 4——它宁可不上，也不会起一个"你以为加密了其实没有"的站 |
| 浏览器打开 `https://…` 报"您的连接不是私密连接" | 自签证书的正常表现（实测：按真实信任链访问会被 `DEPTH_ZERO_SELF_SIGNED_CERT` 拒）。内网自用可以点继续；正式对外必须换域名证书，或把 TLS 交给 Nginx。仪表盘在生成证书前就把这句写在对话框里 |
| 站点明明活着，安装器/探针却报"无应答" | 两个原因都在 `.NET Framework 4.x` 这一侧：① 它默认协议表里没有 **TLS 1.2**，而 Node 20+ 只接受 1.2 以上；② 自签证书过不了默认校验。本包的安装器已显式开 TLS 1.2 并**只对回环地址**放行自签（A-19）。你自己写的监控脚本要按同样两条改 |
| 生产模式（`NODE_ENV=production`）下 HTTP 访问能打开页面但**登录不上**（口令正确） | 旧版给会话 cookie 硬加 `Secure`，而浏览器对 `http://内网IP` 一律拒收 `Secure` cookie。现已改为按请求真实协议判（TLS 才加 `Secure`）。若你手工回退过 `middleware.js` 的 `sessionCookie`，把这条改回来 |
| `env.cmd /install` 说 winget 不可用 | Windows 10 早期版本与 **Server 2019 默认不带 App Installer**。脚本会退回"打印官方下载地址并替你打开浏览器"，手动跑 `.msi` 再重跑 setup 就行；这不是失败 |
| `deploy.cmd` 报 robocopy 失败（码 ≥ 8） | 目标不可写或路径太长。换一个当前账户可写的目录（`deploy.cmd D:\sites\bianwang`），或在提权窗口里跑。robocopy 的 1–7 都是**成功**码，脚本只把 ≥8 当失败，别被"有码"吓到 |
| `deploy.cmd` 说"包已经坐在目标目录里" | 拒绝把自己拷到自己身上（那样 robocopy 会把每个文件报成"跳过，同一文件"，看着像部署失败）。要把新文件放上去，先把新解压的包放在别处再指过去；只想重注册自启就跑 `autostart.cmd` |
| 卸载打印"系统找不到指定的路径"或返回码 1 | 旧版缺陷，已修：cmd.exe 逐行懒读批处理，脚本住在它要删的树里就会读不到后续行。现在卸载由 `%TEMP%` 里的一份副本执行删除与结论，**弹出的那个新窗口才是答题和看报告的地方**，别提前关。若报"仍在原处"，是有句柄占着目录——关掉仪表盘和任何停在该目录的命令行 |
