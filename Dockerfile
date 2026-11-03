# syntax=docker/dockerfile:1
# For arm64 hosts (e.g. Coolify on Raspberry Pi / ARM): build with
#   docker build --build-arg TARGETPLATFORM=linux/arm64 ...
# or set TARGETPLATFORM=linux/arm64 in Coolify build args.

# Node 26 image. better-sqlite3 stays on 12.x because CI still runs Node 20;
# version 13 requires Node 22+. Node 26 images do not ship Corepack.
# --- Builder: produce the app bundle ---
FROM node:26.1-bookworm-slim AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

RUN npm install --global corepack@0.36.0 \
    && corepack enable \
    && corepack prepare pnpm@10.27.0 --activate

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# --- Production: install deps and native addon for this platform ---
ARG TARGETPLATFORM=linux/amd64
FROM --platform=$TARGETPLATFORM node:26.1-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production

# Build tools required for better-sqlite3 native addon (must compile in this stage for target arch)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

RUN npm install --global corepack@0.36.0 \
    && corepack enable \
    && corepack prepare pnpm@10.27.0 --activate

COPY package.json pnpm-lock.yaml ./
# --ignore-scripts skips root "prepare" (husky not installed in prod); onlyBuiltDependencies allows rebuild of better-sqlite3
RUN pnpm install --frozen-lockfile --prod --ignore-scripts \
    && pnpm rebuild better-sqlite3 \
    && apt-get purge -y --auto-remove python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/build ./build

EXPOSE 5050
ENV PORT=5050
ENV DB_PATH=/data
ENV HOME=/home/node

VOLUME ["/data"]

USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || '5050') + '/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "./build/index.js"]
