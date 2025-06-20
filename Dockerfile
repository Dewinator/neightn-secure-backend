# Optimized Dockerfile für Coolify
FROM node:18-alpine

# Arbeitsverzeichnis
WORKDIR /app

# Nur package files zuerst (für besseres Caching)
COPY package*.json ./

# Dependencies installieren
RUN npm ci --only=production && npm cache clean --force

# App Code kopieren
COPY . .

# Non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001
RUN chown -R nextjs:nodejs /app
USER nextjs

# Port
EXPOSE 3000

# Start
CMD ["node", "server.js"]
