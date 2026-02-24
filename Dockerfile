# syntax=docker/dockerfile:1

# --- Builder: produce the app bundle ---
FROM node:20.11 AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.27.0 --activate

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# --- Production: install deps and native addon for this platform ---
FROM node:20.11

WORKDIR /app

ENV NODE_ENV=production

# Build tools required for better-sqlite3 native addon (must compile in this stage for target arch)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.27.0 --activate

COPY package.json pnpm-lock.yaml ./
# Install with --ignore-scripts so "prepare" (husky) does not run (husky is dev-only and not installed in prod)
RUN pnpm install --frozen-lockfile --prod --ignore-scripts \
    && pnpm rebuild better-sqlite3

COPY --from=builder /app/build ./build

EXPOSE 5050
ENV PORT=5050
ENV DB_PATH=/data

VOLUME ["/data"]

CMD ["node", "./build/index.js"]
