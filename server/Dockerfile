FROM node:24.15.0-bookworm

WORKDIR /app

RUN corepack enable
RUN corepack prepare pnpm@10.33.0 --activate

COPY package.json pnpm-lock.yaml ./

RUN pnpm install

COPY . .

EXPOSE 3000

CMD ["pnpm", "run", "debug"]