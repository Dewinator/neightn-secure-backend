# Dockerfile für neightn Backend (Coolify optimiert)

# Node.js LTS Version verwenden
FROM node:18-alpine

# Arbeitsverzeichnis erstellen
WORKDIR /app

# System-Updates und Sicherheits-Patches
RUN apk update && apk upgrade && apk add --no-cache dumb-init

# Package files kopieren
COPY package*.json ./

# Dependencies installieren (nur Production)
RUN npm ci --only=production && npm cache clean --force

# App-Code kopieren
COPY . .

# Non-root User erstellen für Sicherheit
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nextjs -u 1001

# Berechtigungen setzen
RUN chown -R nextjs:nodejs /app
USER nextjs

# Port freigeben
EXPOSE 3000

# Health Check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node healthcheck.js || exit 1

# App mit dumb-init starten (für Signal-Handling)
CMD ["dumb-init", "node", "server.js"]