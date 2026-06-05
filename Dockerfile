FROM node:20-slim AS build

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install client dependencies and build
COPY client/package.json client/package-lock.json* client/
RUN cd client && npm install

# Install server dependencies (includes prisma generate via postinstall)
COPY server/package.json server/package-lock.json* server/
COPY server/prisma server/prisma
COPY server/prisma.config.ts server/
RUN cd server && npm install

# Copy source and build both workspaces
COPY client/ client/
RUN cd client && npm run build

COPY server/ server/
RUN cd server && npm run build

# --- Production image ---
FROM node:20-slim

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy server production deps + prisma config
COPY server/package.json server/package-lock.json* server/
COPY server/prisma server/prisma
COPY server/prisma.config.ts server/
RUN cd server && npm install --omit=dev && npx prisma generate

# Copy built artifacts
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/client/dist client/dist

ENV NODE_ENV=production

# migrate deploy runs at container start, then the server starts
CMD cd server && npx prisma migrate deploy && node dist/index.js
