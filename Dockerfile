# syntax=docker/dockerfile:1
FROM node:20.11

WORKDIR /app

ENV NODE_ENV=production

# Install pnpm and build tools for native addons (e.g. better-sqlite3)
RUN corepack enable && corepack prepare pnpm@10.27.0 --activate
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json pnpm-lock.yaml ./
RUN pnpm config set ignore-scripts false
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

EXPOSE 5050
ENV PORT=5050
ENV DB_PATH=/data

VOLUME ["/data"]

CMD ["node", "./build/index.js"]
