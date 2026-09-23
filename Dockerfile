# ---- 依赖 ----
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- 构建 + 验证（verify 一次性服务使用此阶段）----
FROM deps AS verify
WORKDIR /app
COPY . .
EXPOSE 4173
CMD ["npm", "run", "verify"]

# ---- 静态站点 ----
FROM deps AS build
WORKDIR /app
COPY . .
RUN npm run build

FROM nginx:1.27-alpine AS web
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=10s --timeout=3s --start-period=3s --retries=5 \
  CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1
