# syntax=docker/dockerfile:1
# For arm64 hosts (e.g. Coolify on Raspberry Pi / ARM): build with
#   docker build --build-arg TARGETPLATFORM=linux/arm64 ...
# or set TARGETPLATFORM=linux/arm64 in Coolify build args.

# --- Builder: produce the app bundle ---
FROM node:20.11 AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.27.0 --activate

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# --- Production: install deps and native addon for this platform ---
ARG TARGETPLATFORM=linux/amd64
FROM --platform=$TARGETPLATFORM node:20.11

WORKDIR /app

ENV NODE_ENV=production

# Build tools required for better-sqlite3 native addon (must compile in this stage for target arch)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.27.0 --activate

COPY package.json pnpm-lock.yaml ./
# --ignore-scripts skips root "prepare" (husky not installed in prod); onlyBuiltDependencies allows rebuild of better-sqlite3
RUN pnpm install --frozen-lockfile --prod --ignore-scripts \
    && pnpm rebuild better-sqlite3

COPY --from=builder /app/build ./build

EXPOSE 5050
ENV PORT=5050
ENV DB_PATH=/data

VOLUME ["/data"]

CMD ["node", "./build/index.js"]
