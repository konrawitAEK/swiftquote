# Angular 22 needs Node >= 22.22.3, so pin a minor that satisfies it rather than a possibly stale 22.x.
FROM node:22.23-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Baked in at build time; the browser calls the API directly, so this is a host URL.
ARG API_URL=http://localhost:8080/api/v1
# JSON.stringify quotes the value safely whatever characters it contains.
RUN node -e "require('fs').writeFileSync('src/environments/environment.ts', 'export const environment = {\n  apiUrl: ' + JSON.stringify(process.env.API_URL) + ',\n};\n')" \
 && npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /app/dist/browser /usr/share/nginx/html
EXPOSE 80
