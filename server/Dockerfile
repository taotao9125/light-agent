# 少 1个 G
FROM node:22-alpine

WORKDIR /app

RUN corepack enable
RUN corepack prepare pnpm@10.33.0 --activate

COPY package.json pnpm-lock.yaml ./

# prod 少 100M 
RUN pnpm install --prod --frozen-lockfile

COPY . .

EXPOSE 3000


CMD ["node", "bin/www"]