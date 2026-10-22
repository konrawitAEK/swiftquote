# syntax=docker/dockerfile:1
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Inlined into browser code at build time; the browser calls the API from the host.
ARG NEXT_PUBLIC_API_URL=http://localhost:8080/api/v1
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
# Server Components call the API over the compose network (overridable at runtime).
ENV API_INTERNAL_URL=http://api:8080/api/v1
# JWT_SECRET must be provided at runtime (compose sets it); it is never baked into the image.
RUN addgroup -S nextjs && adduser -S nextjs -G nextjs
# App files stay root-owned (read-only for the app user); only the cache directory is writable.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
RUN mkdir -p .next/cache && chown nextjs:nextjs .next/cache
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
