# ── Stage 1: Build ─────────────────────────────────────────────────────────────
# Install all dependencies (including dev) and compile TypeScript to JavaScript
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

# ── Stage 2: Production runtime ────────────────────────────────────────────────
# Copy only the compiled output and install production dependencies only.
# This keeps the final image small — no TypeScript compiler, no tsx, no type defs.
FROM node:20-alpine AS runner

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

# Create the data directory — in production this is bind-mounted from the host
# so the SQLite file survives container restarts
RUN mkdir -p /app/data

EXPOSE 3000

VOLUME ["/app/data"]

CMD ["node", "dist/index.js"]
