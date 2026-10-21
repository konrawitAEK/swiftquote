# Angular 22 needs Node >= 22.22.3; node:22-alpine tracks the latest 22.x.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Baked in at build time; the browser calls the API directly, so this is a host URL.
ARG API_URL=http://localhost:8080/api/v1
RUN printf "export const environment = {\n  apiUrl: '%s',\n};\n" "$API_URL" > src/environments/environment.ts \
 && npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/browser /usr/share/nginx/html
EXPOSE 80
