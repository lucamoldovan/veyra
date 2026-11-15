# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS server-build
WORKDIR /app

# better-sqlite3 may need a native build when no matching prebuilt binary is available.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY server/package.json server/package-lock.json ./server/
RUN npm ci --prefix server --no-audit --no-fund
COPY server/ ./server/
RUN npm run build --prefix server \
    && npm prune --prefix server --omit=dev --no-audit --no-fund

FROM node:22-bookworm-slim AS dashboard-build
WORKDIR /app/dashboard
COPY dashboard/package.json dashboard/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY dashboard/ ./
RUN npm run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app/server

COPY --from=server-build --chown=node:node /app/server/package.json ./package.json
COPY --from=server-build --chown=node:node /app/server/node_modules ./node_modules
COPY --from=server-build --chown=node:node /app/server/dist ./dist
COPY --from=dashboard-build --chown=node:node /app/dashboard/dist /app/dashboard/dist

RUN mkdir -p /var/lib/ndiview \
    && chown node:node /var/lib/ndiview

USER node
EXPOSE 8787
CMD ["node", "dist/index.js"]
