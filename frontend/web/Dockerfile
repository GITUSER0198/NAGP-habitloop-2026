FROM node:22-alpine AS build
WORKDIR /app/frontend/components
COPY frontend/components/package*.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/components/ ./
COPY frontend/theme/ /app/frontend/theme/
COPY config/categories.json /app/config/categories.json
RUN npm run build
WORKDIR /app/frontend/web
COPY frontend/web/package*.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/web/ ./
RUN npm run check && npm run build && npm prune --omit=dev --no-audit --no-fund

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=47809
WORKDIR /app/frontend/web
COPY --from=build --chown=node:node /app/frontend/web/build/ ./build/
COPY --from=build --chown=node:node /app/frontend/web/node_modules/ ./node_modules/
COPY --from=build --chown=node:node /app/frontend/web/package.json ./package.json
COPY --from=build --chown=node:node /app/frontend/components/package.json /app/frontend/components/package.json
COPY --from=build --chown=node:node /app/frontend/components/dist/ /app/frontend/components/dist/
COPY --from=build --chown=node:node /app/frontend/components/loader/ /app/frontend/components/loader/
USER node
EXPOSE 47809
CMD ["node", "build/index.js"]
