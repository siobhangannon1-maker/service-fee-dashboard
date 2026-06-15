FROM mcr.microsoft.com/playwright:v1.49.1-jammy

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

ENV NODE_ENV=production
ENV PLAYWRIGHT_STORAGE_DIR=/var/data/playwright-storage

RUN mkdir -p /var/data/playwright-storage

CMD ["npm", "run", "cloud:praktika-worker"]