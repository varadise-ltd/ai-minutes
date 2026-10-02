FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
COPY apps/web/package.json apps/web/package.json
RUN npm ci --no-audit --no-fund
COPY apps/web apps/web
RUN npm run build

FROM node:22-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends fonts-noto-cjk libreoffice-writer && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production PORT=5000 DATA_DIR=/app/data
WORKDIR /app
COPY package*.json ./
COPY apps/web/package.json apps/web/package.json
RUN npm ci --omit=dev --no-audit --no-fund && mkdir -p /app/data && chown node:node /app/data
COPY --from=build /app/apps/web/dist/client /app/public
COPY services services
COPY packages packages
COPY tests tests
COPY apps/web/src/recording-engine.mjs apps/web/src/recording-engine.mjs
COPY apps/web/src/reviewAttention.mjs apps/web/src/reviewAttention.mjs
USER node
EXPOSE 5000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s CMD node -e "fetch('http://127.0.0.1:5000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "services/api/server.mjs"]
