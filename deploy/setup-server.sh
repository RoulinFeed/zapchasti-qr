#!/usr/bin/env bash
# Первичная настройка чистого сервера для «Складского учёта» (база начинается пустой).
# Запускать от root на чистом Ubuntu 22.04/24.04 или Debian 12:
#
#   curl -fsSL https://raw.githubusercontent.com/RoulinFeed/zapchasti-qr/main/deploy/setup-server.sh -o setup.sh
#   bash setup.sh
#
# Скрипт спрашивает всё нужное сам. Его можно запускать повторно: сделанные шаги пропускаются.
# Приложение он не собирает (на сервере 1 ГБ памяти): готовый образ привозит GitHub Actions.
set -euo pipefail

REPO_RAW=https://raw.githubusercontent.com/RoulinFeed/zapchasti-qr/main
DEPLOY_USER=${DEPLOY_USER:-deploy}
APP_DIR=/home/$DEPLOY_USER/zapchasti-qr

say()  { printf '\n\033[1;32m== %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m!! %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31mОшибка: %s\033[0m\n' "$*" >&2; exit 1; }
ask()  { local v; read -r -p "$1 " v </dev/tty; printf '%s' "${v:-$2}"; }

[ "$(id -u)" = 0 ] || die "запустите от root (sudo bash setup.sh)"

say "1. Файл подкачки"
# Postgres + Node + Caddy в 1 ГБ памяти без подкачки могут упасть при всплеске нагрузки.
if [ -z "$(swapon --show --noheadings)" ]; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo 'vm.swappiness=10' > /etc/sysctl.d/99-swap.conf && sysctl -q -p /etc/sysctl.d/99-swap.conf
  echo "Подкачка 2 ГБ включена"
else
  echo "Подкачка уже есть"
fi

say "2. Docker"
if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
  apt-get update -qq && apt-get install -y -qq curl ca-certificates gzip >/dev/null
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker >/dev/null
docker compose version

say "3. Пользователь $DEPLOY_USER для автообновления"
id "$DEPLOY_USER" >/dev/null 2>&1 || useradd -m -s /bin/bash "$DEPLOY_USER"
usermod -aG docker "$DEPLOY_USER"
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"
KEYS=/home/$DEPLOY_USER/.ssh/authorized_keys
touch "$KEYS"
if [ -s "$KEYS" ]; then
  echo "Ключ уже добавлен ($(wc -l < "$KEYS") шт.)"
else
  echo "Вставьте ОТКРЫТЫЙ ключ (одна строка, начинается с ssh-ed25519 или ssh-rsa)."
  echo "Закрытый ключ сюда не вставлять: он идёт только в секрет DEPLOY_KEY на GitHub."
  PUB=$(ask ">" "")
  case "$PUB" in
    ssh-ed25519\ *|ssh-rsa\ *|ecdsa-sha2-*) echo "$PUB" >> "$KEYS" ;;
    *PRIVATE*) die "это закрытый ключ. Нужен открытый, из файла .pub" ;;
    *) die "не похоже на открытый SSH-ключ" ;;
  esac
fi
chown "$DEPLOY_USER:$DEPLOY_USER" "$KEYS" && chmod 600 "$KEYS"

say "4. Папка приложения $APP_DIR"
install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$APP_DIR" "$APP_DIR/backups" "$APP_DIR/data" "$APP_DIR/data/photos"
curl -fsSL "$REPO_RAW/docker-compose.yml" -o "$APP_DIR/docker-compose.yml"
cd "$APP_DIR"

say "5. Настройки (.env)"
if [ ! -s .env ]; then
  DOMAIN=$(ask "Домен сайта [5-182-87-217.sslip.io]:" "5-182-87-217.sslip.io")
  ALOGIN=$(ask "Логин администратора [ruslan]:" "ruslan")
  ANAME=$(ask "Имя администратора [Руслан]:" "Руслан")
  APIN=$(ask "PIN администратора (4+ цифр, им вы войдёте в приложение):" "")
  [ ${#APIN} -ge 4 ] || die "PIN должен быть не короче 4 символов"
  cat > .env <<ENV
DOMAIN=$DOMAIN
DB_PASSWORD=$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9')
ADMIN_LOGIN=$ALOGIN
ADMIN_NAME=$ANAME
ADMIN_PIN=$APIN
ENV
else
  echo "Беру существующий .env, домен: $(grep '^DOMAIN=' .env | cut -d= -f2)"
fi
chmod 600 .env

say "6. База данных"
docker compose up -d db
for i in $(seq 1 30); do docker compose exec -T db pg_isready -U app -d zapchasti >/dev/null 2>&1 && break; sleep 2; done
docker compose exec -T db pg_isready -U app -d zapchasti >/dev/null || die "база не запустилась: docker compose logs db"
echo "База запущена. Таблицы и администратора приложение создаст само при первом запуске."
chown -R "$DEPLOY_USER:$DEPLOY_USER" "$APP_DIR"

say "Готово"
cat <<TXT
Сервер подготовлен. Дальше:
  1. На GitHub поменять секреты: DEPLOY_HOST=$(curl -fsS4 --max-time 5 https://ifconfig.me 2>/dev/null || echo 5.182.87.217),
     DEPLOY_USER=$DEPLOY_USER, DEPLOY_PATH=$APP_DIR, DEPLOY_KEY = закрытая половина вставленного ключа.
     Секреты из .env (пароль базы) на GitHub не нужны: они остаются только на этом сервере.
  2. Направить домен $(grep '^DOMAIN=' .env | cut -d= -f2) на этот IP (для *.sslip.io ничего делать не нужно).
  3. На GitHub: Actions → deploy → Run workflow. Он привезёт приложение и запустит его.
TXT
