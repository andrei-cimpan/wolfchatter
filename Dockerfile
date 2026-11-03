# Same exact Node as .nvmrc and CI.
FROM node:26.13.0-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Inlined into client code at build time, so they cannot be set when the container starts.
ARG NEXT_PUBLIC_MAP_TILE_URL
ARG NEXT_PUBLIC_MAP_ATTRIBUTION
ENV DOCKER_BUILD=1 NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:26.13.0-slim
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
# Migrations run as their own command, so several instances starting together do not each try.
COPY --from=build --chown=node:node /app/scripts/migrate.mts ./scripts/migrate.mts
COPY --from=build --chown=node:node /app/db/migrations ./db/migrations
USER node
EXPOSE 3000
# No HEALTHCHECK: /health fails during a database outage, and a platform that restarts unhealthy
# containers would then restart every instance for nothing. Compose sets its own, for `--wait`.
CMD ["node", "server.js"]
