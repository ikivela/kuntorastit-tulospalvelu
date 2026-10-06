FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --legacy-peer-deps
COPY . .
RUN npm run prisma:generate && npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/src/generated ./src/generated
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./prisma.config.ts
# RUN_MIGRATIONS / RUN_SEED (default true) control start-up DB steps.
CMD ["sh", "-c", "export PATH=/app/node_modules/.bin:$PATH && if [ \"${RUN_MIGRATIONS:-true}\" = true ]; then prisma migrate deploy; fi && if [ \"${RUN_SEED:-true}\" = true ]; then prisma db seed; fi && node dist/src/main.js"]
