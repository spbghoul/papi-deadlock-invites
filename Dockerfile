# The Next.js app is built on the developer machine (deploy/deploy.ps1 runs `next build`) and the
# ready .next folder is copied in. The small server only installs production dependencies, which is
# cached by Docker until package-lock.json changes, so most deploys take seconds and no CPU.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
# Build tools only needed if better-sqlite3 has no prebuilt binary for this platform.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    DATABASE_URL=file:/data/app.db \
    STEAM_TOKEN_FILE=/data/steam-refresh-token.txt
WORKDIR /app
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json next.config.mjs tsconfig.json ./
COPY --chown=node:node .next ./.next
COPY --chown=node:node public ./public
COPY --chown=node:node src ./src
COPY --chown=node:node scripts ./scripts
RUN test -f .next/BUILD_ID || (echo "Missing .next build - deploy with deploy/deploy.ps1" && exit 1)
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
CMD ["node_modules/.bin/next", "start", "-p", "3000"]
