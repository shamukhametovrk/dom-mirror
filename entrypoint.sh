#!/bin/sh
# Виртуальный экран → обычный Chrome с окном → сервер зеркала, который подключается к Chrome по CDP.
set -e
export DISPLAY=:99
# часовой пояс и языки должны совпадать с местом, откуда «выходит» IP, иначе сайт видит несостыковку
export TZ="${TZ:-Europe/Moscow}"
PROFILE=/data/profile
mkdir -p "$PROFILE/Default"
# профиль лежит в volume и переживает пересоздание контейнера; снимаем lock-файлы прошлого запуска
rm -f "$PROFILE"/SingletonLock "$PROFILE"/SingletonSocket "$PROFILE"/SingletonCookie

# Языки браузера (navigator.languages и заголовок Accept-Language) хранятся в профиле и не меняются
# флагом --lang, поэтому выставляем их в Preferences перед запуском Chrome.
LANGS="${ACCEPT_LANGUAGES:-ru-RU,ru,en-US,en}" PREFS="$PROFILE/Default/Preferences" node --input-type=commonjs -e '
const fs = require("fs"), p = process.env.PREFS;
let j = {}; try { j = JSON.parse(fs.readFileSync(p, "utf8")); } catch {}
(j.intl ??= {}).accept_languages = j.intl.selected_languages = process.env.LANGS;
fs.writeFileSync(p, JSON.stringify(j));'

# после падения или перезапуска контейнера файловая система та же: старая блокировка экрана не даёт Xvfb стартовать,
# а без экрана не стартует Chrome, и контейнер уходит в бесконечный перезапуск
rm -f /tmp/.X99-lock /tmp/.X11-unix/X99
# временные файлы Chrome, оставшиеся от упавшего запуска
rm -f "$PROFILE"/.com.google.Chrome.*

Xvfb :99 -screen 0 3840x2160x24 -nolisten tcp &
for i in $(seq 1 50); do [ -S /tmp/.X11-unix/X99 ] && break; sleep 0.1; done

# WebGL: без GPU включаем программный ANGLE/SwiftShader — у настоящего десктопа WebGL есть всегда
google-chrome \
  --user-data-dir="$PROFILE" \
  --no-first-run --no-default-browser-check \
  --no-sandbox --disable-dev-shm-usage \
  --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist \
  --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222 \
  --window-position=0,0 --window-size=1280,800 \
  --lang=ru-RU \
  about:blank >/tmp/chrome.log 2>&1 &

# ждём, пока Chrome откроет порт отладки
for i in $(seq 1 50); do
  curl -fs http://127.0.0.1:9222/json/version >/dev/null 2>&1 && break
  sleep 0.2
done

exec node /app/server.js
