FROM node:22-bookworm-slim

# Версия Chrome закреплена, чтобы сборки были воспроизводимыми. Список: versionhistory.googleapis.com
ARG CHROME_VERSION=157.0.8103.38
ENV NODE_ENV=production

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl xvfb \
    fonts-noto fonts-noto-cjk fonts-noto-color-emoji fonts-liberation \
 && curl -fsSLo /tmp/chrome.deb \
    "https://dl.google.com/linux/chrome/deb/pool/main/g/google-chrome-stable/google-chrome-stable_${CHROME_VERSION}-1_amd64.deb" \
 && apt-get install -y --no-install-recommends /tmp/chrome.deb \
 && rm -rf /tmp/chrome.deb /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY entrypoint.sh ./
COPY shared ./shared
COPY src ./src
COPY public ./public

EXPOSE 8080
CMD ["sh", "/app/entrypoint.sh"]
