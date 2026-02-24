# syntax=docker/dockerfile:1
FROM node:20.11

WORKDIR /app

ENV NODE_ENV=production

# Install pnpm and dependencies (include devDependencies for build)
RUN corepack enable && corepack prepare pnpm@10.27.0 --activate
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
