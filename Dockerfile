FROM mcr.microsoft.com/playwright:v1.60.0-jammy

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

ENV NODE_ENV=production

RUN mkdir -p /var/data/playwright-storage

CMD ["npm", "run", "cloud:praktika-worker"]