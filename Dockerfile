# База: Node и системные библиотеки (образ Playwright, самого Playwright в проекте больше нет). Сам браузер — обычный Google Chrome с окном
# на виртуальном экране Xvfb; сервер подключается к нему напрямую по CDP (cdp.js).
FROM mcr.microsoft.com/playwright:v1.65.0-noble
ENV NODE_ENV=production
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl xvfb fonts-noto fonts-noto-color-emoji \
 && curl -fsSLo /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb \
 && apt-get install -y /tmp/chrome.deb \
 && rm -rf /tmp/chrome.deb /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.js cdp.js rewrite.js entrypoint.sh ./
COPY public ./public
EXPOSE 8080
CMD ["sh", "/app/entrypoint.sh"]
