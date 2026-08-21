# ==============================================================================
# MULTI-STAGE DOCKERFILE FOR GRAYWOOD READER
# ==============================================================================

FROM node:22-bookworm-slim@sha256:a17d50af28002a160548bd4225b3cfcb12c5efcb171f79e68758f2885fb1b066 AS builder

WORKDIR /app

COPY package*.json ./

ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1

RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 make g++ && \
    npm ci && \
    apt-get purge -y --auto-remove python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

COPY . .

RUN npm run build

FROM node:22-bookworm-slim@sha256:a17d50af28002a160548bd4225b3cfcb12c5efcb171f79e68758f2885fb1b066 AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

COPY package*.json ./

RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 make g++ wget ca-certificates && \
    npm ci --omit=dev && \
    apt-get purge -y --auto-remove python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/dist-server ./dist-server
COPY --from=builder /app/public ./public
COPY --from=builder /app/BUGS.md ./BUGS.md
COPY --from=builder /app/package.json ./package.json

RUN mkdir -p /app/data/storage && chown -R node:node /app

USER node

EXPOSE 3000

VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

CMD ["node", "dist-server/server.cjs"]