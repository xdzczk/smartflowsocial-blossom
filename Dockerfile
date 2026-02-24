# syntax=docker/dockerfile:1
# Optional: set when building for a specific platform (e.g. Coolify on arm64)
ARG TARGETPLATFORM

# --- Builder: produce the app bundle ---
FROM node:20.11 AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.27.0 --activate

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# --- Production: install deps and native addon for this platform ---
FROM --platform=${TARGETPLATFORM:-linux/amd64} node:20.11

WORKDIR /app

ENV NODE_ENV=production

# Build tools required for better-sqlite3 native addon (must compile in this stage for target arch)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.27.0 --activate

COPY package.json pnpm-lock.yaml ./
RUN pnpm config set ignore-scripts false \
    && pnpm install --frozen-lockfile --prod \
    && pnpm rebuild better-sqlite3

COPY --from=builder /app/build ./build

EXPOSE 5050
ENV PORT=5050
ENV DB_PATH=/data

VOLUME ["/data"]

CMD ["node", "./build/index.js"]
