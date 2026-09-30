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

### B. 直接打"解压即用"的部署包（推荐交付形态）

```bash
pnpm build
node scripts/make-nginx-package.mjs              # 预演：列出包内去向，并点名"哪些运行态被挡在包外"
node scripts/make-nginx-package.mjs --write      # 生成 outputs/package/bianwang-<版本>-nginx/
node scripts/make-nginx-package.mjs --write --zip # 再压成同名 .zip（解压即部署）
```

`api/` 由打包脚本**每次现做**（内部跑 `pnpm --filter server deploy --legacy --prod`），不接受手工先跑一遍留下的旧快照：
实测踩过一次——改了 `server/src/index.js` 之后包里的 `api/` 还是修复前的那份，因为 `.api-deploy` 是更早的 deploy 产物。
`pnpm api:prod` 只在你想单独看一眼 deploy 产物时用它。

包结构：`web/dist/`（Nginx root；后端在没有 Nginx 时也按 `api/../../web/dist` 自己伺服，便于单机先点一遍）·
`api/`（Node 后端 + 生产依赖 + 出厂 data）· `nginx/`（站点与安全片段）·
`ops/`（env 样例、systemd 单元、起停脚本、`verify-deploy.mjs` 验收）· `docs/`（四份文档）·
`MANIFEST.md` 与 `SHA256SUMS.txt`（逐件校验值，`api/node_modules` 用一行聚合值）。

**打包脚本会刻意把运行态挡在包外**（清单里逐条打印）：`api/data/.secret`（会话与全部签名的主密钥）、
`sessions.json`（活着的会话）、`security.log*`（含来源 IP 的审计流水）、`login-attempts.json`（锁定计数）。
包内的 `api/data/` 会被**整目录清空后重播**（跑包内自己的 `scripts/reseed.js`），
所以出厂态与 `pnpm seed` 完全一致，不会夹带开发期经界面上传的图片；
`reseed` 顺带生成的 `.secret` 也在出包前删掉，让部署机首启各自生成。
最后再扫一遍包内是否还有运行态文件，有就拒绝出包。
`node_modules` 复制时**解引用**（pnpm 的符号链接农场不进 zip），所以解压到没有软链接权限的 Windows 机上也不会碎。

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

# 4. Nginx
sudo cp nginx/bianwang-proxy.inc /etc/nginx/
sudo cp nginx/bianwang.conf /etc/nginx/sites-available/bianwang
sudo ln -sf /etc/nginx/sites-available/bianwang /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

改 `bianwang.conf` 里的 `server_name` 与证书路径；证书建议用 certbot 签发后由 Nginx 终止 TLS。

## 三、Windows（nginx.exe + 计划任务）

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
node scripts/full-sweep.mjs        # 218 项：另起 7 个隔离实例，含镜像口令门控、EPUB/PDF 阅览边界、预览白名单、版本台账与全站台账总表、媒体对账与出厂示例实体
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
| 换机后起不来，报 `ERR_MODULE_NOT_FOUND`（如 `Cannot find package 'ip-address'`） | **只拷了 `server/` 没拷仓库根**：pnpm 的依赖农场在根 `node_modules/.pnpm/`，`server/node_modules/*` 只是指向它的软链接，压缩解压会被解引用、兄弟依赖留在原机。改用本包的 `api/`（`pnpm deploy` 产出、自足无软链接），或在**仓库根**跑 `pnpm install --frozen-lockfile`。详见 `USAGE.md` §9.8 |
