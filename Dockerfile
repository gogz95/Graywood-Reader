# ==============================================================================
# MULTI-STAGE DOCKERFILE FOR MANHUASYNC / OMNIMANGA SUBDOMAIN TRACKER
# Cross-Platform Deployment (Linux / Windows Docker Desktop / Kubernetes / Coolify)
# ==============================================================================

# ── STAGE 1: Build Frontend Assets & Install Dependencies ──────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Install native build tools required by better-sqlite3
RUN apk add --no-cache python3 make g++

# Copy package manifests
COPY package*.json ./

# Skip downloading the Electron binary (not needed for server builds)
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1

# Install all dependencies (including devDependencies for Vite & TypeScript)
RUN npm ci

# Copy source code
COPY . .

# Build production frontend bundle into /app/dist
RUN npm run build


# ── STAGE 2: Production Runner ────────────────────────────────────────────────
FROM node:22-alpine AS runner

WORKDIR /app

# Set NODE_ENV to production
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

# Copy package manifests
COPY package*.json ./

# Install production dependencies only.
# Build tools are installed temporarily in case better-sqlite3 has no
# prebuilt binary for this platform, then removed to keep the image small.
RUN apk add --no-cache python3 make g++ libstdc++ && \
    npm ci --omit=dev && \
    apk del python3 make g++

# Copy built frontend assets and server entry points
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server.ts ./server.ts
COPY --from=builder /app/sqlite-db.ts ./sqlite-db.ts
COPY --from=builder /app/src ./src
COPY --from=builder /app/BUGS.md ./BUGS.md
COPY --from=builder /app/tsconfig.json ./tsconfig.json

# Create persistent storage directories
RUN mkdir -p /app/data/storage

# Expose server port
EXPOSE 3000

# Mountable persistent storage volume for SQLite database & storage files
VOLUME ["/app/data"]

# Healthcheck probe
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

# Start production server using tsx
CMD ["npx", "tsx", "server.ts"]
