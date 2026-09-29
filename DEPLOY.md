# 部署手册（Nginx + Node + JSON 文件存储）

架构：Nginx 只做静态托管与反向代理，Node 进程只监听 `127.0.0.1:8787`，数据以 JSON/CSV 落在服务端目录。

```
浏览器 ──HTTPS──> Nginx ──┬── /            → web/dist（静态产物）
                          └── /api/…       → 127.0.0.1:8787（Node，仅回环）
                                             └── server/data/*.json · users.csv · media/
```

## 一、准备产物

```bash
pnpm install
pnpm build                 # 先跑 prebuild 生成许可登记表，再产出 web/dist
node server/scripts/reseed.js   # 可选：写入演示数据（正式环境请跳过或先清空 data）
```

需要拷贝到服务器的两样东西：`web/dist/` 与 `server/`（含 `node_modules`，或用 `pnpm install --prod` 在目标机安装）。

## 二、Linux（systemd + Nginx）

```bash
# 1. 放置文件
sudo mkdir -p /var/www/bianwang /srv/bianwang
sudo cp -r web/dist/* /var/www/bianwang/
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

Windows 注意：`server/data` 必须放在 **Nginx root 之外**；配置文件里已用扩展名与路径黑名单兜底，但不要把 `data/` 拷进 `www/`。

## 四、必做的安全收口

1. **改默认口令**：登录后进「用户名册」，同名提交 `admin` 即改密（新密码 ≥8 位）。
   名册出厂另有 `demo` / `demo-pass`（示例馆员，角色 editor），可直接移除；重跑 `pnpm seed` 只会补回这一行，
   **不会覆盖任何已改过的口令**。
2. **启用哈希存储**：`BW_HASH_PASSWORDS=1` 后再改一次密码，CSV 里即存 scrypt 摘要。
   需求指定的明文形态只应在内网或演示环境使用。
3. **备份**：`server/data` 整目录即为全量状态（档案、话题、菜单、名册、图片、审计日志、
   镜像书目 `library.json` 与口令表 `library-keys.json`）；镜像原件在 `server/data/library/`，
   登记信息只是索引，两处都要备。建议 `tar`/`robocopy` 每日快照；恢复即整目录替换后重启进程。
4. **密钥**：`BW_SECRET` 决定会话与图片签名，多实例必须一致；缺失时首次启动会自动生成 `.secret`（权限 0600），不要提交到仓库。
5. **Nginx 层复核**：`client_max_body_size 5m`（与后端一致）、`/api/` 限流、`location ~ /\.` 拒绝隐藏文件、`autoindex off`。
   在线阅览走 `location ~ ^/api/library/[^/]+/(reader|asset)`（复用 `bw_media` 频控），下载走 `/api/library/files/`（关缓冲、长超时）；
   两条都不得改成公共缓存——响应带 `no-store`，且 URL 上有口令令牌。
6. **访问日志里的令牌**：取书与阅览插图把 10 分钟时效的令牌放在查询串里，会进 `access_log`。
   日志须仅本机可读（`chmod 640`），或按需对 `/api/library/` 单设 `access_log off`；过期后令牌自废，吊销口令即刻作废已发令牌。

## 五、验证清单

```bash
node scripts/api-smoke.mjs        # 31 项接口自检（权限、置顶唯一、净化、限流、签名直链、反爬）
node scripts/full-sweep.mjs       # 149 项：另起 5 个隔离实例，含镜像口令门控、EPUB 分页阅览边界与出厂示例实体
node scripts/walkthrough.mjs      # 119 项浏览器端到端走查 + 截图（需先起 Chrome 调试端口）
node scripts/browser-probe.mjs http://127.0.0.1:8787/   # 主线程是否阻塞 / 关键节点计数
```

浏览器手工核对：首页瀑布流滚动到接近底部会自动取下一批；点卡片进详情看双栏对勘与图上圈划；
未登录时「新增图文 / 重排 / 菜单编辑 / 用户名册」应被引导到登录页；页脚协议表与实际依赖一致；
`/library` 输入口令后点「在线阅览」，翻到下一章地址栏应变成 `?c=N` 且不整页闪白，10MB 以上的书只给分页、不给整本。

## 六、常见故障

| 现象 | 判断路径 |
| --- | --- |
| 图片显示"链接已过期" | 签名有效期默认 30 分钟；`BW_SECRET` 变更后旧链接全部失效，刷新页面即可 |
| 登录提示 429 | 同一 IP **或同一用户名** 连续失败 5 次锁 10 分钟，计数存 `data/login-attempts.json`，删该文件可本地复位 |
| 保存提示"缺少有效的操作令牌" | 会话已换发 CSRF 令牌，刷新页面重新取 `/api/auth/me` |
| 列表 403 deep-page | 游客翻页超过 20 页需登录，属反批量抓取设计 |
| 上传 415 | 只按文件头魔数判定 JPEG/PNG/GIF/WebP/AVIF，改扩展名无效 |
| 改动未生效 | JSON 写入是内存即时 + 磁盘排队；若磁盘不可写会打印 `[store] 写入 … 失败` |
