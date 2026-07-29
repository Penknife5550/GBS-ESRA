# =============================================================================
# GBS Campus — Multi-Stage Build auf Basis von Next.js 15 Standalone
# =============================================================================

# --- Stage 1: Abhaengigkeiten ------------------------------------------------
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts
COPY prisma ./prisma
RUN npx prisma generate

# --- Stage 2: Build ----------------------------------------------------------
FROM node:24-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# Seed nach JavaScript bundeln. Ohne diesen Schritt liefe im Container
# "node prisma/seed.js" ins Leere und ein frisch aufgesetzter Server haette
# weder Statusmaschine noch Rollen und Rechte.
# --tsconfig ist noetig, damit esbuild den Pfad-Alias "@/..." aus tsconfig.json
# aufloest — der Seed zieht die Einstellungs-Definitionen aus src/lib.
RUN npx --yes esbuild@0.24 prisma/seed.ts \
      --bundle --platform=node --target=node24 --format=cjs \
      --tsconfig=tsconfig.json \
      --external:@prisma/client \
      --outfile=prisma/compiled/seed.js \
 && test -f prisma/compiled/seed.js

# Worker (Erinnerungslauf + Aufraeumlauf) genauso nach JavaScript bundeln — der
# eigene docker-compose-Dienst `worker` startet ihn mit "node worker.js".
RUN npx --yes esbuild@0.24 scripts/worker.ts \
      --bundle --platform=node --target=node24 --format=cjs \
      --tsconfig=tsconfig.json \
      --external:@prisma/client \
      --outfile=prisma/compiled/worker.js \
 && test -f prisma/compiled/worker.js

# --- Stage 3: Laufzeit -------------------------------------------------------
FROM node:24-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV TZ=Europe/Berlin

RUN apk add --no-cache curl tzdata
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Prisma: Schema und Migrationen fuer db:deploy, generierter Client fuer die Laufzeit
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/prisma/compiled/seed.js ./prisma/seed.js
COPY --from=builder --chown=nextjs:nodejs /app/prisma/compiled/worker.js ./worker.js
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/@prisma ./node_modules/@prisma

# Prisma-CLI fuer "migrate deploy" im Entrypoint. Global installiert, weil beim
# Kopieren aus der deps-Stage die Symlinks in node_modules/.bin fehlen.
# Die Version muss exakt der aus package-lock.json entsprechen — sonst weicht
# die Migrations-Engine vom generierten Client ab.
RUN npm install -g prisma@6.19.3

COPY --chown=nextjs:nodejs docker/entrypoint.sh ./
RUN sed -i 's/\r$//' entrypoint.sh && chmod +x entrypoint.sh

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

ENTRYPOINT ["./entrypoint.sh"]
