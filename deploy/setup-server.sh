#!/usr/bin/env bash
# Первичная настройка нового сервера для «Складского учёта» и перенос данных со старого.
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

say "5. Перенос со старого сервера"
DUMP=""; PHOTOS=""
echo "Откуда брать данные:"
echo "  1 — забрать со старого сервера по SSH (он должен быть ещё включён)"
echo "  2 — из файлов резервной копии, уже загруженных на этот сервер"
echo "  3 — начать с пустой базы"
MODE=$(ask "Выбор [1]:" 1)
case "$MODE" in
  1)
    OLD=$(ask "Старый сервер, пользователь@адрес (например root@1.2.3.4):" "")
    [ -n "$OLD" ] || die "адрес старого сервера не указан"
    OLD_DIR=$(ask "Папка приложения на старом сервере [~/zapchasti-qr]:" "~/zapchasti-qr")
    mkdir -p migrate
    # Одно соединение на все команды, чтобы пароль спросили один раз.
    SSHO=(-o StrictHostKeyChecking=accept-new -o ControlMaster=auto -o ControlPath=/tmp/zq-mig-%C -o ControlPersist=120)
    echo "Подключаюсь к $OLD. Если спросит пароль, это пароль старого сервера."
    ssh "${SSHO[@]}" "$OLD" "cd $OLD_DIR && cat .env" > migrate/old.env
    ssh "${SSHO[@]}" "$OLD" "cd $OLD_DIR && docker compose exec -T db pg_dump -U app --no-owner zapchasti | gzip" > migrate/zapchasti.sql.gz
    ssh "${SSHO[@]}" "$OLD" "cd $OLD_DIR && tar czf - -C data/photos ." > migrate/photos.tar.gz || warn "фото со старого сервера не скопированы"
    DUMP=migrate/zapchasti.sql.gz; PHOTOS=migrate/photos.tar.gz
    [ -s .env ] || cp migrate/old.env .env
    ;;
  2)
    DUMP=$(ask "Путь к файлу базы (zapchasti_ГГГГ-ММ-ДД.sql.gz):" "")
    PHOTOS=$(ask "Путь к архиву фото (photos_ГГГГ-ММ-ДД.tar.gz), Enter если нет:" "")
    OLDENV=$(ask "Путь к старому .env, Enter если нет:" "")
    [ -n "$OLDENV" ] && [ ! -s .env ] && cp "$OLDENV" .env
    ;;
  3) ;;
  *) die "непонятный выбор: $MODE" ;;
esac
if [ -n "$DUMP" ]; then
  [ -s "$DUMP" ] || die "файл базы $DUMP пуст или не найден"
  gzip -t "$DUMP" || die "файл базы $DUMP повреждён"
  gunzip -c "$DUMP" | grep -q 'CREATE TABLE' || die "в $DUMP нет таблиц: похоже, дамп не снялся"
fi

say "6. Настройки (.env)"
if [ ! -s .env ]; then
  DOMAIN=$(ask "Домен сайта [5-182-87-217.sslip.io]:" "5-182-87-217.sslip.io")
  ALOGIN=$(ask "Логин администратора [ruslan]:" "ruslan")
  ANAME=$(ask "Имя администратора [Руслан]:" "Руслан")
  APIN=$(ask "PIN администратора (только для пустой базы):" "")
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

say "7. База данных"
docker compose up -d db
for i in $(seq 1 30); do docker compose exec -T db pg_isready -U app -d zapchasti >/dev/null 2>&1 && break; sleep 2; done
docker compose exec -T db pg_isready -U app -d zapchasti >/dev/null || die "база не запустилась: docker compose logs db"
if [ -n "$DUMP" ]; then
  TABLES=$(docker compose exec -T db psql -U app -d zapchasti -tAc "select count(*) from information_schema.tables where table_schema='public'")
  if [ "$TABLES" != "0" ]; then
    warn "в базе уже есть таблицы, загрузку пропускаю (чтобы не задвоить данные)"
  else
    gunzip -c "$DUMP" | docker compose exec -T db psql -q -v ON_ERROR_STOP=1 -U app -d zapchasti >/dev/null
    echo "База загружена. Записей в журнале операций:"
    docker compose exec -T db psql -U app -d zapchasti -tAc "select count(*) from ops" || true
  fi
fi
if [ -n "$PHOTOS" ] && [ -s "$PHOTOS" ]; then
  tar xzf "$PHOTOS" -C data/photos && echo "Фото: $(ls data/photos | wc -l) файлов"
fi
chown -R "$DEPLOY_USER:$DEPLOY_USER" "$APP_DIR"

say "Готово"
cat <<TXT
Сервер подготовлен. Дальше:
  1. На GitHub поменять секреты: DEPLOY_HOST=$(curl -fsS4 --max-time 5 https://ifconfig.me 2>/dev/null || echo 5.182.87.217),
     DEPLOY_USER=$DEPLOY_USER, DEPLOY_PATH=$APP_DIR, DEPLOY_KEY = закрытая половина вставленного ключа.
  2. Направить домен $(grep '^DOMAIN=' .env | cut -d= -f2) на этот IP (для *.sslip.io ничего делать не нужно).
  3. На GitHub: Actions → deploy → Run workflow. Он привезёт приложение и запустит его.
TXT
