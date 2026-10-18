#!/usr/bin/env bash
# Installs or updates the «Семейный бюджет» server on a Linux machine with systemd.
#
#   curl -fsSL https://raw.githubusercontent.com/amkmonk/buh/main/deploy/install.sh | sudo bash -s -- --domain budget.example.org
#
# Options:
#   --domain NAME    domain pointing to this server; enables HTTPS with a free Let's Encrypt certificate
#   --port N         port of the app (default 8443); port 80 must be free for the certificate
#   --no-https       plain HTTP on --port, without a domain (for a home network)
#   --login NAME     login of the first user (default: admin)
#   --version vX.Y.Z install a specific release instead of the latest
#
# Running it again updates the server and keeps the data and settings.
set -euo pipefail

REPO="amkmonk/buh"
DOMAIN=""
PORT="8443"
HTTPS=1
LOGIN="admin"
VERSION="latest"

while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --no-https) HTTPS=0; shift ;;
    --login) LOGIN="$2"; shift 2 ;;
    --version) VERSION="$2"; shift 2 ;;
    -h|--help) sed -n '2,14p' "$0" 2>/dev/null || true; exit 0 ;;
    *) echo "Неизвестный параметр: $1" >&2; exit 1 ;;
  esac
done

say() { printf '\033[1m==> %s\033[0m\n' "$*"; }
die() { printf 'Ошибка: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "запустите от root (через sudo)"
command -v systemctl >/dev/null || die "нужен systemd"
command -v curl >/dev/null || die "нужен curl"

case "$(uname -m)" in
  x86_64|amd64) ARCH=amd64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  *) die "архитектура $(uname -m) не поддерживается" ;;
esac

FIRST_INSTALL=0
[ -f /etc/buh/buh.env ] || FIRST_INSTALL=1

if [ "$FIRST_INSTALL" -eq 1 ]; then
  if [ "$HTTPS" -eq 1 ] && [ -z "$DOMAIN" ]; then
    die "укажите домен: --domain budget.example.org (или --no-https для домашней сети)"
  fi
  case "$DOMAIN" in
    my-budget.duckdns.org|budget.example.org|example.*|*.example.org|ваш-домен*)
      die "в команде остался пример домена ($DOMAIN). Замените его на свой домен, который указывает на этот сервер" ;;
  esac
  busy() { ss -tlnH "( sport = :$1 )" 2>/dev/null | grep -q .; }
  if [ "$HTTPS" -eq 1 ] && busy 80; then die "порт 80 занят: он нужен для получения сертификата"; fi
  if busy "$PORT"; then die "порт $PORT занят, выберите другой: --port 9443"; fi
fi

if [ "$VERSION" = "latest" ]; then
  URL="https://github.com/$REPO/releases/latest/download/buh-server-linux-$ARCH"
else
  URL="https://github.com/$REPO/releases/download/$VERSION/buh-server-linux-$ARCH"
fi

say "Скачиваю сервер ($ARCH)"
TMP="$(mktemp)"
curl -fSL --progress-bar -o "$TMP" "$URL" || die "не удалось скачать $URL"
chmod 0755 "$TMP"

id buh >/dev/null 2>&1 || useradd --system --no-create-home --home-dir /var/lib/buh --shell /usr/sbin/nologin buh
install -d -m 0755 /opt/buh
install -d -m 0750 -o root -g buh /etc/buh
mv -f "$TMP" /opt/buh/buh-server

if [ "$FIRST_INSTALL" -eq 1 ]; then
  if [ "$HTTPS" -eq 1 ]; then
    printf 'BUH_DOMAIN=%s\nBUH_HTTPS_ADDR=:%s\nBUH_HTTP_ADDR=:80\nBUH_DB=/var/lib/buh/buh.db\n' "$DOMAIN" "$PORT" > /etc/buh/buh.env
  else
    printf 'BUH_ADDR=:%s\nBUH_DB=/var/lib/buh/buh.db\n' "$PORT" > /etc/buh/buh.env
  fi
  chown root:buh /etc/buh/buh.env && chmod 0640 /etc/buh/buh.env
fi

cat > /etc/systemd/system/buh.service <<'UNIT'
[Unit]
Description=Семейный бюджет (buh-server)
After=network-online.target
Wants=network-online.target

[Service]
User=buh
Group=buh
EnvironmentFile=/etc/buh/buh.env
Environment=GOMEMLIMIT=40MiB
ExecStart=/opt/buh/buh-server
Restart=on-failure
RestartSec=3
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
NoNewPrivileges=true
StateDirectory=buh
StateDirectoryMode=0700
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
PrivateDevices=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true
MemoryHigh=48M
MemoryMax=64M
CPUQuota=50%
TasksMax=64
Nice=5

[Install]
WantedBy=multi-user.target
UNIT

say "Запускаю службу buh"
systemctl daemon-reload
systemctl enable buh >/dev/null 2>&1
systemctl restart buh
sleep 2
systemctl is-active --quiet buh || { journalctl -u buh -n 20 --no-pager; die "служба не запустилась"; }

CLI="runuser -u buh -- env BUH_DB=/var/lib/buh/buh.db /opt/buh/buh-server"
if [ -z "$($CLI user list 2>/dev/null)" ]; then
  PASS="$(LC_ALL=C tr -dc 'A-HJ-NP-Za-km-z2-9' </dev/urandom 2>/dev/null | head -c 14 || true)"
  $CLI user add "$LOGIN" "$LOGIN" "$PASS" >/dev/null
  CREATED="Первый пользователь: логин $LOGIN, пароль $PASS (смените в приложении)"
fi

. /etc/buh/buh.env
if [ -n "${BUH_DOMAIN:-}" ]; then ADDR="https://$BUH_DOMAIN:${BUH_HTTPS_ADDR#:}"; else ADDR="http://<адрес сервера>:${BUH_ADDR#:}"; fi
echo
say "Готово: $ADDR"
[ -n "${CREATED:-}" ] && echo "$CREATED"
echo "Откройте адрес в браузере или укажите его в приложении на экране входа."
