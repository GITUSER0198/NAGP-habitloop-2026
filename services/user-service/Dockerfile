FROM node:22-slim AS build
WORKDIR /workspace
COPY package.json package-lock.json tsconfig.base.json ./
COPY services/shared/node ./services/shared/node
COPY services/user-service ./services/user-service
RUN npm ci && npm run build -w @habitloop/shared && npm run build -w services/user-service && npm prune --omit=dev

FROM node:22-slim AS runtime
ENV NODE_ENV=production SERVICE_PORT=47820
WORKDIR /app
COPY --from=build --chown=node:node /workspace/node_modules ./node_modules
COPY --from=build --chown=node:node /workspace/package.json ./package.json
COPY --from=build --chown=node:node /workspace/services/shared/node/package.json ./services/shared/node/package.json
COPY --from=build --chown=node:node /workspace/services/shared/node/dist ./services/shared/node/dist
COPY --from=build --chown=node:node /workspace/services/user-service/package.json ./services/user-service/package.json
COPY --from=build --chown=node:node /workspace/services/user-service/dist ./services/user-service/dist
USER node
EXPOSE 47820
HEALTHCHECK --interval=10s --timeout=3s --start-period=45s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.SERVICE_PORT||47820)+'/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "services/user-service/dist/index.js"]
