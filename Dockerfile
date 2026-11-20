# ==========================================
# HeirFlow — Google Cloud Run Multi-Stage Dockerfile
# Builds Frontend + Verification Gate + Backend in one container
# ==========================================

# --- Stage 1: Build Frontend (Vite) ---
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# --- Stage 2: Build Verification Gate (TypeScript) ---
FROM node:20-alpine AS gate-builder
WORKDIR /app/backend/verification-gate

COPY backend/verification-gate/package*.json ./
RUN npm ci

COPY backend/verification-gate/ ./
RUN npm run build

# --- Stage 3: Production Server ---
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

# Install Backend production dependencies
COPY backend/package*.json ./backend/
WORKDIR /app/backend
RUN npm ci --omit=dev

# Install Verification Gate production dependencies (zod, uuid, etc.)
COPY backend/verification-gate/package*.json ./verification-gate/
RUN cd verification-gate && npm ci --omit=dev

# Copy backend source
COPY backend/ ./

# Copy compiled Verification Gate dist & Frontend dist
COPY --from=gate-builder /app/backend/verification-gate/dist /app/backend/verification-gate/dist
COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist

# Expose Google Cloud Run default port
EXPOSE 8080

# Start HeirFlow server
CMD ["node", "server.js"]
