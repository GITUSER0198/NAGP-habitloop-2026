FROM node:22-slim AS build
WORKDIR /workspace
COPY package.json package-lock.json tsconfig.base.json ./
COPY services/shared/node ./services/shared/node
COPY lambdas/event-normalizer ./lambdas/event-normalizer
COPY lambdas/analytics-updater ./lambdas/analytics-updater
COPY tools/event-worker ./tools/event-worker
RUN npm ci && npm run build -w @habitloop/shared && npm run build -w @habitloop/event-normalizer -w @habitloop/analytics-updater && npm run build -w @habitloop/event-worker && npm prune --omit=dev

FROM node:22-slim AS runtime
ENV NODE_ENV=production SERVICE_PORT=47820
WORKDIR /app
COPY --from=build --chown=node:node /workspace/node_modules ./node_modules
COPY --from=build --chown=node:node /workspace/package.json ./package.json
COPY --from=build --chown=node:node /workspace/services/shared/node/package.json ./services/shared/node/package.json
COPY --from=build --chown=node:node /workspace/services/shared/node/dist ./services/shared/node/dist
COPY --from=build --chown=node:node /workspace/lambdas/event-normalizer/package.json ./lambdas/event-normalizer/package.json
COPY --from=build --chown=node:node /workspace/lambdas/event-normalizer/dist ./lambdas/event-normalizer/dist
COPY --from=build --chown=node:node /workspace/lambdas/analytics-updater/package.json ./lambdas/analytics-updater/package.json
COPY --from=build --chown=node:node /workspace/lambdas/analytics-updater/dist ./lambdas/analytics-updater/dist
COPY --from=build --chown=node:node /workspace/tools/event-worker/package.json ./tools/event-worker/package.json
COPY --from=build --chown=node:node /workspace/tools/event-worker/dist ./tools/event-worker/dist
USER node
EXPOSE 47820
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=5 CMD node -e "fetch('http://127.0.0.1:'+(process.env.SERVICE_PORT||47820)+'/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "tools/event-worker/dist/main.js"]
