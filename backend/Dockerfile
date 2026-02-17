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
COPY telegram-user/requirements.txt ./telegram-user/
RUN npm ci --omit=dev \
    && python3 -m pip install --break-system-packages --no-cache-dir -r telegram-user/requirements.txt

# telegram-user (скрипти + файл сесії)
COPY telegram-user ./telegram-user/

COPY . .
RUN npm run build

EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
