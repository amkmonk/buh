#!/usr/bin/env bash
# For development: builds the server from this checkout (web client inside) and installs it on your
# server over ssh, replacing the binary of an installation made with deploy/install.sh.
#
#   BUH_HOST=root@203.0.113.10 deploy/deploy.sh
set -euo pipefail

HOST="${BUH_HOST:?укажите сервер: BUH_HOST=root@адрес deploy/deploy.sh}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/release/buh-server-linux-amd64"

echo "==> web client"
(cd "$ROOT/app" && { [ -d node_modules ] || npm install --no-audit --no-fund --silent; } && npm run build --silent)

echo "==> server for linux/amd64"
WEB="$ROOT/server/web"
find "$WEB" -mindepth 1 ! -name .keep -exec rm -rf {} +
cp -r "$ROOT/app/dist/." "$WEB/"
mkdir -p "$ROOT/release"
(cd "$ROOT/server" && GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o "$OUT" .)
find "$WEB" -mindepth 1 ! -name .keep -exec rm -rf {} +

echo "==> upload to $HOST"
scp -q "$OUT" "$HOST:/tmp/buh-server"
ssh "$HOST" 'set -e
  test -f /etc/buh/buh.env || { echo "сервер ещё не установлен: сначала deploy/install.sh"; exit 1; }
  install -m 0755 /tmp/buh-server /opt/buh/buh-server.new && mv -f /opt/buh/buh-server.new /opt/buh/buh-server && rm -f /tmp/buh-server
  systemctl restart buh && sleep 2 && systemctl is-active buh && journalctl -u buh -n 3 --no-pager -o cat'
