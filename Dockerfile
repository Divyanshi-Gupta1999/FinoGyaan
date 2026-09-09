# ===================================================
# FinWise AI — Multi-Stage Production Dockerfile
# ===================================================

# Stage 1: Build frontend bundle & install dependencies
FROM node:20-slim AS builder

WORKDIR /app

# Copy workspace package definitions
COPY package*.json ./
COPY frontend/package*.json ./frontend/
COPY backend/package*.json ./backend/

# Install full dependencies (including devDependencies for Vite)
RUN npm ci

# Copy full application source code
COPY . .

# Build frontend production assets (Vite -> frontend/dist)
RUN npm run build --prefix frontend

# Prune devDependencies to keep image lean
RUN npm prune --omit=dev

# Stage 2: Minimal Production Runtime
FROM node:20-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080
ENV API_BACKEND_HOST=0.0.0.0
ENV GOOGLE_CLOUD_PROJECT=finwise-506509
ENV GOOGLE_CLOUD_LOCATION=global
ENV PROXY_HEADER=olsvpAa7bsvcult5KJbg8D_homx6JY-g

# Copy package manifests & pruned node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/backend ./backend
COPY --from=builder /app/frontend/dist ./frontend/dist

EXPOSE 8080

# Run Express server
CMD ["node", "backend/server.js"]
