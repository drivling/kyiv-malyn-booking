# Backend: Node + Python (для telegram-user/send_message.py — одноразове промо від особистого акаунта)
FROM node:20-bookworm-slim

# Python3 + pip для Telethon
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma

# Python-залежності:
# 1) для telegram-user (Telethon)
# 2) для opendatabot-fop-parser (requests + bs4 + lxml)
COPY telegram-user/requirements.txt ./telegram-user/
COPY opendatabot-fop-parser/requirements.txt ./opendatabot-fop-parser/
RUN npm ci \
    && python3 -m pip install --break-system-packages --no-cache-dir -r telegram-user/requirements.txt \
    && python3 -m pip install --break-system-packages --no-cache-dir -r opendatabot-fop-parser/requirements.txt

# telegram-user (скрипти + файл сесії)
COPY telegram-user ./telegram-user/

# решта backend-коду (включно з opendatabot-fop-parser)
COPY . .
RUN npm run build

EXPOSE 3000
# Старт: migrate + node (package.json "start"). Railway підставляє PORT.
CMD ["npm", "start"]
