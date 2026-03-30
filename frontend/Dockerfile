FROM node:22-slim AS build

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
RUN npm run build

# --- Serve with nginx ---
FROM nginx:alpine

# Custom nginx config to proxy /ws to backend
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
