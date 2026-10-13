# syntax=docker/dockerfile:1.7
# Slotbook has no runtime dependencies, so the image is the Node runtime plus source.
FROM node:22.12-alpine AS runtime

ENV NODE_ENV=production \
    PORT=3000
WORKDIR /app

# Copy only what the server needs; tests, docs and dev files stay out (.dockerignore too).
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node migrations ./migrations
COPY --chown=node:node public ./public
COPY --chown=node:node scripts ./scripts

USER node
EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# server.js handles SIGTERM for a graceful stop; run with `--init` (compose: init: true).
CMD ["node", "src/server.js"]
