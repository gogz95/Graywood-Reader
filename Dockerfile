# ==============================================================================
# MULTI-STAGE DOCKERFILE FOR GRAYWOOD READER
# ==============================================================================

FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./

ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1

RUN apk update && apk upgrade --no-cache && \
    apk add --no-cache python3 make g++ && \
    npm ci && \
    apk del python3 make g++

COPY . .

RUN npm run build

FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

COPY package*.json ./

RUN apk update && apk upgrade --no-cache && \
    apk add --no-cache python3 make g++ libstdc++ wget && \
    npm ci --omit=dev && \
    apk del python3 make g++

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/dist-server ./dist-server
COPY --from=builder /app/public ./public
COPY --from=builder /app/BUGS.md ./BUGS.md
COPY --from=builder /app/package.json ./package.json

RUN mkdir -p /app/data/storage

# Run as the unprivileged node user (created by the official node images).
# NOTE: with a bind-mounted ./data volume the host directory ownership wins —
# ensure the host folder is writable by the container's uid (e.g. chown to
# uid 1000) or the server will fail to persist.
RUN chown -R node:node /app
USER node

EXPOSE 3000

VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

CMD ["node", "dist-server/server.cjs"]