FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/dist dist
# Embedded PDF fonts (Noto Sans Thai + Noto Sans, SIL OFL; see assets/fonts/OFL.txt).
COPY assets assets
USER node
EXPOSE 8080
CMD ["node", "dist/server.js"]
