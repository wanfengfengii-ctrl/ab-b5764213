# syntax=docker/dockerfile:1

# ---- 依赖 ----
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- 构建静态站点 ----
FROM deps AS builder
COPY . .
RUN npm run build

# ---- 运行时：纯静态 nginx ----
FROM nginx:1.27-alpine AS runner
COPY --from=builder /app/dist /usr/share/nginx/html
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=5 \
  CMD wget -q -O- http://127.0.0.1/healthz || exit 1
EXPOSE 80

# ---- 一次性复核：单元测试 + 构建检查 + 静态 HTTP 冒烟，退出码即结论 ----
FROM deps AS verify
COPY . .
CMD ["sh", "-c", "npm test && npm run build && node scripts/smoke.mjs"]
