#!/usr/bin/env bash
# Установка dom-mirror на чистый Ubuntu/Debian: Docker, настройки, HTTPS, запуск.
# Запуск из папки проекта: sudo bash install.sh   (повторный запуск ничего не ломает и снова покажет адрес и пароль)
set -euo pipefail
cd "$(dirname "$0")"

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
die() { printf '\033[31mОшибка: %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "запустите через sudo: sudo bash install.sh"

# --- 1. Docker -------------------------------------------------------------
say "Docker"
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  echo "уже установлен: $(docker --version)"
else
  apt-get update -qq
  apt-get install -y -qq curl ca-certificates >/dev/null
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker >/dev/null 2>&1 || true

# --- 2. Настройки ----------------------------------------------------------
say "Настройки"
[ -f .env ] || cp .env.example .env

set_var() {  # set_var ИМЯ значение
  if grep -q "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else echo "$1=$2" >> .env; fi
}
get_var() { grep "^$1=" .env | head -1 | cut -d= -f2- || true; }
json_field() { sed -n "s/.*\"$1\": *\"\([^\"]*\)\".*/\1/p" | head -1; }
has_tty() { (exec </dev/tty) 2>/dev/null; }   # без терминала (например, через ssh -T) вопросов не задаём
ask() {  # ask "вопрос" значение_по_умолчанию → ответ (Enter — по умолчанию)
  local answer=""
  if has_tty; then read -rp "$1 [$2]: " answer </dev/tty || true; fi
  echo "${answer:-$2}"
}

# Страна IP: от неё зависят часовой пояс и язык браузера — сайты сверяют их с IP.
# Бесплатные сервисы геолокации часто отказывают облачным IP, поэтому пробуем несколько по очереди.
geo_try() {  # geo_try URL поле_ip поле_пояса поле_страны → "ip пояс страна" или ничего
  local json
  json=$(curl -fsS --max-time 10 "$1" 2>/dev/null || true)
  [ -n "$(json_field "$3" <<<"$json")" ] || return 1
  echo "$(json_field "$2" <<<"$json") $(json_field "$3" <<<"$json") $(json_field "$4" <<<"$json")"
}
GEO=$(geo_try https://ipapi.co/json/ ip timezone country_code \
  || geo_try https://ipinfo.io/json ip timezone country \
  || geo_try http://ip-api.com/json/ query timezone countryCode \
  || true)
read -r IP TZ_GEO COUNTRY <<<"$GEO" || true
[ -n "${IP:-}" ] || IP=$(curl -fsS --max-time 10 https://api.ipify.org || curl -fsS --max-time 10 https://ifconfig.me) \
  || die "не удалось определить внешний IP сервера"
echo "IP сервера: $IP"

# Домен: <IP>.sslip.io указывает на сервер сам, свой домен должен быть уже направлен на этот IP.
CURRENT_DOMAIN=$(get_var DOMAIN)
DEFAULT_DOMAIN="$IP.sslip.io"
[ -n "$CURRENT_DOMAIN" ] && [ "$CURRENT_DOMAIN" != ":80" ] && DEFAULT_DOMAIN=$CURRENT_DOMAIN
DOMAIN=$(ask "Домен (Enter — оставить)" "$DEFAULT_DOMAIN")
set_var DOMAIN "$DOMAIN"

languages_for() {  # код страны → языки браузера, как у местного пользователя
  case "$1" in
    RU|BY) echo "ru-RU,ru,en-US,en" ;;      KZ) echo "ru-KZ,ru,kk,en-US,en" ;;
    UA) echo "uk-UA,uk,en-US,en" ;;          DE|AT) echo "de-DE,de,en-US,en" ;;
    CH) echo "de-CH,de,fr,en-US,en" ;;       NL) echo "nl-NL,nl,en-US,en" ;;
    FI) echo "fi-FI,fi,en-US,en" ;;          FR) echo "fr-FR,fr,en-US,en" ;;
    PL) echo "pl-PL,pl,en-US,en" ;;          ES) echo "es-ES,es,en-US,en" ;;
    IT) echo "it-IT,it,en-US,en" ;;          PT) echo "pt-PT,pt,en-US,en" ;;
    BR) echo "pt-BR,pt,en-US,en" ;;          SE) echo "sv-SE,sv,en-US,en" ;;
    NO) echo "nb-NO,nb,no,en-US,en" ;;       DK) echo "da-DK,da,en-US,en" ;;
    CZ) echo "cs-CZ,cs,en-US,en" ;;          TR) echo "tr-TR,tr,en-US,en" ;;
    LT) echo "lt-LT,lt,en-US,en" ;;          LV) echo "lv-LV,lv,en-US,en" ;;
    EE) echo "et-EE,et,en-US,en" ;;          GE) echo "ka-GE,ka,en-US,en" ;;
    AM) echo "hy-AM,hy,ru,en-US,en" ;;       RS) echo "sr-RS,sr,en-US,en" ;;
    JP) echo "ja-JP,ja,en-US,en" ;;          KR) echo "ko-KR,ko,en-US,en" ;;
    GB|IE) echo "en-GB,en" ;;                US|CA|AU|NZ|SG) echo "en-US,en" ;;
    *) echo "" ;;
  esac
}
LANGS=$(languages_for "${COUNTRY:-}")
if [ -n "${TZ_GEO:-}" ]; then set_var TZ "$TZ_GEO"; fi
if [ -n "$LANGS" ]; then set_var ACCEPT_LANGUAGES "$LANGS"; fi
if [ -n "${TZ_GEO:-}" ] && [ -n "$LANGS" ]; then
  echo "страна сервера $COUNTRY: часовой пояс $TZ_GEO, языки $LANGS"
else
  echo "страну сервера определить не удалось полностью — сейчас TZ=$(get_var TZ), ACCEPT_LANGUAGES=$(get_var ACCEPT_LANGUAGES)"
  echo "  при необходимости поправьте их в .env и запустите install.sh ещё раз"
fi

gen_password() { tr -dc 'A-Za-z0-9' </dev/urandom | head -c 16 || true; }
if [ -n "$(get_var PASSWORD)" ]; then
  echo "пароль: уже задан, оставляю"
else
  PASSWORD=""
  if has_tty; then
    while true; do
      read -rsp "Пароль для входа (Enter — сгенерировать): " PASSWORD </dev/tty || true; echo
      [ -z "$PASSWORD" ] && break
      [[ "$PASSWORD" =~ ^[A-Za-z0-9._-]{8,}$ ]] && break
      echo "  минимум 8 символов: латинские буквы, цифры, . _ -"
    done
  fi
  [ -n "$PASSWORD" ] || PASSWORD=$(gen_password)
  set_var PASSWORD "$PASSWORD"
fi

# Порты 80 и 443 нужны Let's Encrypt и браузеру; у хостера их тоже может понадобиться открыть.
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
  ufw allow 80/tcp >/dev/null && ufw allow 443/tcp >/dev/null && ufw allow 443/udp >/dev/null
  echo "в ufw открыты порты 80 и 443"
fi

# --- 3. Запуск -------------------------------------------------------------
say "Загрузка и запуск (первый раз скачивается около 700 МБ — обычно пара минут)"
docker compose pull
docker compose up -d

say "Браузер"
READY=no
for _ in $(seq 1 60); do
  if docker compose exec -T dom-mirror curl -fs http://127.0.0.1:8080/health >/dev/null 2>&1; then READY=yes; break; fi
  sleep 2
done
[ "$READY" = yes ] && echo "запущен" || echo "ещё запускается — проверьте позже: sudo docker compose logs dom-mirror"

say "Сертификат HTTPS"
cert_ok() { docker compose logs caddy 2>/dev/null | grep -qi "certificate obtained"; }
CERT=no
for _ in $(seq 1 40); do
  if cert_ok; then CERT=yes; echo "получен"; break; fi
  sleep 3
done
[ "$CERT" = yes ] \
  || echo "пока не получен — проверьте, что у хостера открыты порты 80 и 443; Caddy продолжит попытки сам"

# --- Итог ------------------------------------------------------------------
cat <<INFO

========================================================
  Готово!

  Адрес:   https://$DOMAIN/
  Пароль:  $(get_var PASSWORD)

  Если страница не открывается — разрешите у хостера
  входящие порты 80 и 443 (TCP).
========================================================
INFO
