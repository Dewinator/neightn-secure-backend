FROM node:18-alpine

WORKDIR /app

# Package files kopieren
COPY package*.json ./

# Dependencies installieren  
RUN npm ci --only=production

# App files kopieren
COPY server.js healthcheck.js ./

# Port freigeben
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node healthcheck.js || exit 1

# Starten
CMD ["node", "server.js"]
