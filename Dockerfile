# Web UI (vinext) production image. Built from the repo root:
#   docker compose -f prod.yml build web
# NEXT_PUBLIC_* values are baked into the build, so changing them requires a
# rebuild.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY . .
ARG NEXT_PUBLIC_SITE_NAME=Kuntorastit
ARG NEXT_PUBLIC_CLUB_NAME=
ARG NEXT_PUBLIC_LOGO_URL=
ARG NEXT_PUBLIC_FAVICON_URL=
ARG NEXT_PUBLIC_MAP_CENTER=
ARG NEXT_PUBLIC_DEFAULT_CITY=
ARG NEXT_PUBLIC_DEFAULT_PAYMENT_METHODS=
ARG NEXT_PUBLIC_PAYMENT_HINT=
ARG NEXT_PUBLIC_BASE_PATH=
ARG NEXT_PUBLIC_API_BASE_URL=
ENV NEXT_PUBLIC_SITE_NAME=${NEXT_PUBLIC_SITE_NAME} \
    NEXT_PUBLIC_CLUB_NAME=${NEXT_PUBLIC_CLUB_NAME} \
    NEXT_PUBLIC_LOGO_URL=${NEXT_PUBLIC_LOGO_URL} \
    NEXT_PUBLIC_FAVICON_URL=${NEXT_PUBLIC_FAVICON_URL} \
    NEXT_PUBLIC_MAP_CENTER=${NEXT_PUBLIC_MAP_CENTER} \
    NEXT_PUBLIC_DEFAULT_CITY=${NEXT_PUBLIC_DEFAULT_CITY} \
    NEXT_PUBLIC_DEFAULT_PAYMENT_METHODS=${NEXT_PUBLIC_DEFAULT_PAYMENT_METHODS} \
    NEXT_PUBLIC_PAYMENT_HINT=${NEXT_PUBLIC_PAYMENT_HINT} \
    NEXT_PUBLIC_BASE_PATH=${NEXT_PUBLIC_BASE_PATH} \
    NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL} \
    WRANGLER_WRITE_LOGS=false
RUN npx vinext build && node scripts/emit-standalone.mjs

# Runtime image: only the standalone output (built app + vinext's prod
# server and its runtime packages), not the full node_modules.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000
COPY --from=build /app/dist/standalone ./
USER node
EXPOSE 3000
CMD ["node", "server.js"]
