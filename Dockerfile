# ── Dépendances ────────────────────────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

# ── Build ──────────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# DATABASE_URL factice : Prisma en a besoin pour générer le client, pas pour se connecter
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
RUN npx prisma generate && npx next build

# ── CLI Prisma (migrations au démarrage) ───────────────────────────────────
# La CLI et toutes ses dépendances transitives (@prisma/config → effect, c12…),
# installées seules : les copier une à une depuis node_modules casse à chaque
# montée de version de Prisma.
FROM node:22-alpine AS prisma-cli
WORKDIR /cli
COPY package-lock.json ./
RUN npm install --no-save "prisma@$(node -p "require('./package-lock.json').packages['node_modules/prisma'].version")"

# ── Image finale ───────────────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000 TZ=Europe/Paris

# utilisateur applicatif dédié : ne pas tourner en root
RUN addgroup -S -g 1001 nodejs && adduser -S -u 1001 -G nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
# client Prisma généré (au cas où le tracing standalone l'aurait exclu)
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma ./node_modules/@prisma
# CLI Prisma et ses dépendances, fusionnées dans node_modules
COPY --from=prisma-cli --chown=nextjs:nodejs /cli/node_modules ./node_modules
COPY --chown=nextjs:nodejs docker-entrypoint.sh ./

USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/api/health || exit 1
CMD ["sh", "docker-entrypoint.sh"]
