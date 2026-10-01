#!/usr/bin/env bash
# 辨妄阁后端启动器（Linux/无 systemd 时的手工起法；生产建议用 bianwang.service.example）
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API="$HERE/../api"
[ -f "$API/src/index.js" ] || { echo "[X] 没找到 api/src/index.js，请在解压出的包根目录里跑本脚本"; exit 1; }

export NODE_ENV="${NODE_ENV:-production}"
export BW_HOST="${BW_HOST:-127.0.0.1}"
export BW_PORT="${BW_PORT:-8787}"
export BW_DATA_DIR="${BW_DATA_DIR:-$API/data}"
export BW_HASH_PASSWORDS="${BW_HASH_PASSWORDS:-1}"

if [ -z "${BW_SECRET:-}" ] && [ ! -f "$BW_DATA_DIR/.secret" ]; then
  echo "[!] BW_SECRET 未设置：首次启动会在 data/ 下生成 .secret（0600）。"
  echo "[!] 多实例必须显式统一 BW_SECRET，否则会随机 403；这个文件请纳入备份但**不要**再打进新的部署包。"
fi

command -v node >/dev/null || { echo "[X] 未安装 Node.js（需要 >=20.19.0）"; exit 1; }
# 协议跟着证书走：给了 BW_TLS_PFX（或 BW_TLS_KEY/BW_TLS_CERT 成对）就以 TLS 监听，否则明文 HTTP（默认）。
BW_SCHEME=http
[ -n "${BW_TLS_PFX:-}${BW_TLS_KEY:-}" ] && BW_SCHEME=https
echo "[*] Node $(node --version) · $BW_SCHEME://$BW_HOST:$BW_PORT · 数据 $BW_DATA_DIR"
cd "$API"
exec node src/index.js
