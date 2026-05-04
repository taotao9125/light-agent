# Server 开发到部署架构图

> 基于当前 `server` 目录代码、`infra/*`、`Dockerfile`、`package.json` 和仓库根目录 `.github/workflows/ci.yml` 整理。

## 1. 整体开发到部署流程

```mermaid
flowchart TD
    DEV[开发者本地开发] --> CODE[server 源码]

    CODE --> LOCAL_DEPS[pnpm install]
    CODE --> LOCAL_INFRA["pnpm run docker:up<br/>docker compose --env-file ./infra/env/.env<br/>-f ./infra/compose/docker-compose.local.yaml up -d"]

    LOCAL_INFRA --> DEV_MYSQL[(MySQL 8<br/>DB_PORT -> 3306<br/>meeting-mysql-data)]
    LOCAL_INFRA --> DEV_REDIS[(Redis<br/>REDIS_PORT -> 6379<br/>meeting-redis-data)]
    DEV_MYSQL --> INIT_SQL["infra/mysql/init/001_schema.sql<br/>infra/mysql/init/002_seed.sql"]

    LOCAL_DEPS --> LOCAL_APP["pnpm run debug / pnpm start<br/>nodemon bin/www"]
    LOCAL_APP --> EXPRESS["Express App<br/>app.js<br/>PORT 默认 3000"]
    EXPRESS --> DEV_MYSQL
    EXPRESS --> DEV_REDIS

    DEV --> PUSH[git push main]
    PUSH --> GHA["GitHub Actions<br/>.github/workflows/ci.yml"]

    GHA --> TEST["pnpm install --frozen-lockfile<br/>pnpm run test:ci"]
    TEST --> BUILD["docker build<br/>Dockerfile"]
    BUILD --> IMAGE["镜像标签<br/>commit short sha<br/>latest"]
    IMAGE --> ACR["阿里云 ACR<br/>secrets.DOCKER_REGISTER/yangblue/test"]

    GHA --> SYNC_INFRA["rsync server/infra/<br/>到 /root/booking/infra/"]
    GHA --> WRITE_ENV["SSH 写入<br/>/root/booking/infra/env/.env"]

    ACR --> SSH[SSH 到生产服务器]
    SYNC_INFRA --> SSH
    WRITE_ENV --> SSH
    SSH --> PROD_DIR["/root/booking"]
    PROD_DIR --> PULL["docker compose --env-file ./infra/env/.env<br/>-f ./infra/compose/docker-compose.prod.yaml pull backend"]
    PULL --> UP["docker compose --env-file ./infra/env/.env<br/>-f ./infra/compose/docker-compose.prod.yaml up -d"]

    UP --> NGINX["nginx<br/>80:80<br/>infra/nginx/default.conf"]
    UP --> PROD_BACKEND["backend<br/>container_name = APP_NAME<br/>PORT:PORT"]
    UP --> PROD_MYSQL[(mysql<br/>MySQL 8)]
    UP --> PROD_REDIS[(redis<br/>Redis appendonly)]

    NGINX -->|proxy_pass backend:3000| PROD_BACKEND
    PROD_BACKEND --> PROD_MYSQL
    PROD_BACKEND --> PROD_REDIS
    NGINX --> HEALTH["Health Check<br/>curl http://localhost/health"]
    HEALTH --> OK[部署成功]
```

## 2. 应用内部请求链路

```mermaid
flowchart LR
    CLIENT[Client / Browser / API 调用方] --> NGINX[nginx 80]
    NGINX --> HTTP[HTTP Request]
    HTTP --> SERVER["bin/www<br/>创建 HTTP Server<br/>监听 PORT 默认 3000"]
    SERVER --> APP["app.js<br/>Express App"]

    APP --> GLOBAL_MW["全局中间件<br/>json/urlencoded/cookie/static<br/>rateLimit"]
    GLOBAL_MW --> ROUTES[模块路由挂载]

    ROUTES --> ME["/api/me"]
    ROUTES --> USERS["/api/users"]
    ROUTES --> REGISTER["/api/register"]
    ROUTES --> LOGIN["/api/login"]
    ROUTES --> BOOKING["/api/booking"]
    ROUTES --> ROOMS["/api/rooms"]
    ROUTES --> HEALTH["/health"]
    ROUTES --> TEST_API["/api/test"]

    ME --> AUTH[auth JWT]
    USERS --> AUTH
    BOOKING --> AUTH
    ROOMS --> AUTH

    BOOKING --> ROLE["requireRole<br/>管理员审核场景"]

    AUTH --> SERVICE["service.js<br/>业务逻辑<br/>从 req 取 body/params/uid/role"]
    ROLE --> SERVICE
    REGISTER --> SERVICE
    LOGIN --> SERVICE

    SERVICE --> VALIDATE["lib/validate.js<br/>zod schema 校验"]
    SERVICE --> REPO["repository.js<br/>只接收具体字段<br/>不接收 req"]
    REPO --> DB["db/db.js<br/>mysql2 pool"]
    DB --> MYSQL[(MySQL<br/>users / meeting_rooms / bookings)]

    APP --> REDIS_CONN[connectRedis]
    GLOBAL_MW --> RATE_REDIS[(Redis<br/>rate-limit key)]
    SERVICE --> QUEUE[(Redis List<br/>notifications)]

    QUEUE --> WORKER["workers/notifactionWorker.js<br/>blPop 消费通知"]

    APP --> SWAGGER{ENABLE_SWAGGER=true?}
    SWAGGER --> DOCS["/api-docs<br/>swagger-ui"]

    APP --> NOT_FOUND[404 AppError]
    SERVICE --> ERROR[AppError / Error]
    AUTH --> ERROR
    ROLE --> ERROR
    NOT_FOUND --> ERR_HANDLER["全局错误处理<br/>logger.error + JSON response"]
    ERROR --> ERR_HANDLER
```

## 3. Docker 与生产运行拓扑

```mermaid
flowchart TD
    subgraph BUILD_STAGE[镜像构建: Dockerfile]
        NODE[node:22-alpine]
        WORKDIR["/app"]
        PNPM["corepack enable<br/>pnpm@10.33.0"]
        INSTALL["pnpm install --prod --frozen-lockfile"]
        COPY[COPY . .]
        CMD["CMD node bin/www"]

        NODE --> WORKDIR --> PNPM --> INSTALL --> COPY --> CMD
    end

    CMD --> BACKEND_IMAGE["backend image<br/>DOCKER_REGISTER/yangblue/test:latest"]

    subgraph PROD_COMPOSE["infra/compose/docker-compose.prod.yaml"]
        NGINX["nginx<br/>nginx:latest<br/>ports 80:80<br/>mount ../nginx/default.conf"]
        BACKEND["backend<br/>image: ACR latest<br/>container_name: APP_NAME<br/>env_file ../env/.env"]
        MYSQL["mysql<br/>mysql:8<br/>ports DB_PORT:3306<br/>volume meeting-mysql-data<br/>init ../mysql/init"]
        REDIS["redis<br/>redis:latest<br/>appendonly yes<br/>ports REDIS_PORT:6379<br/>volume meeting-redis-data"]
    end

    BACKEND_IMAGE --> BACKEND
    NGINX -->|backend:3000| BACKEND
    BACKEND -->|DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_BASE| MYSQL
    BACKEND -->|REDIS_HOST / REDIS_PORT| REDIS
```

## 4. CI/CD 关键步骤

```mermaid
sequenceDiagram
    participant Dev as Developer
    participant GH as GitHub Actions
    participant ACR as Aliyun ACR
    participant ECS as Production Server
    participant Nginx as nginx
    participant App as backend

    Dev->>GH: push main
    GH->>GH: checkout
    GH->>GH: setup node 22
    GH->>GH: setup pnpm 10
    GH->>GH: pnpm install --frozen-lockfile
    GH->>GH: pnpm run test:ci
    GH->>ACR: docker login
    GH->>GH: IMAGE_TAG = GITHUB_SHA 前 7 位
    GH->>GH: docker build -t IMAGE_TAG -t latest .
    GH->>ACR: docker push IMAGE_TAG
    GH->>ACR: docker push latest
    GH->>ECS: SSH setup
    GH->>ECS: mkdir -p /root/booking
    GH->>ECS: rsync ./infra/ -> /root/booking/infra/
    GH->>ECS: 写入 /root/booking/infra/env/.env
    ECS->>ACR: docker login
    ECS->>ACR: docker compose pull backend
    ECS->>ECS: docker compose up -d
    ECS->>Nginx: curl http://localhost/health
    Nginx->>App: proxy_pass http://backend_pool
    App-->>Nginx: {"status":"ok"}
    Nginx-->>ECS: {"status":"ok"}
    ECS-->>GH: Deploy success
```

## 5. 当前架构要点

- 本地开发：`pnpm run docker:up` 使用 `infra/compose/docker-compose.local.yaml` 启动 MySQL 和 Redis，Node 服务在宿主机通过 `pnpm run debug` 或 `pnpm start` 启动。
- 生产部署：`infra/compose/docker-compose.prod.yaml` 编排 `nginx`、`backend`、`mysql`、`redis`；nginx 对外暴露 `80`，反代到 compose 网络内的 `backend:3000`。
- CI/CD：`main` 分支 push 后先跑 Vitest，再构建并推送 Docker 镜像，然后同步 `server/infra/` 到服务器，写入远程 `infra/env/.env`，最后只 `pull backend` 并 `up -d`。
- 环境变量：真实 `infra/env/.env` 不提交 Git；生产由 CI 使用 GitHub Secrets 写入服务器。`DB_PASSWORD`、`JWT_SEC` 等敏感值放 Secrets。
- 初始化 SQL：`infra/mysql/init/*.sql` 可以提交仓库，并通过 compose 挂载到 `/docker-entrypoint-initdb.d/`；这些 SQL 只会在 MySQL 数据目录首次初始化时执行。
- 健康检查：生产环境通过 nginx 访问 `http://localhost/health`，返回 `{"status":"ok"}` 才认为部署成功。
- 分层约定：`routes` 统一把 `req` 传给需要请求上下文的 `service`；`service` 负责取 `body/params/uid/role` 和业务判断；`repository` 只接收具体字段，不接收 Express `req`。
- Redis 用途：应用启动时连接 Redis；全局限流中间件写入 `rate-limit:*`；预约创建后向通知队列 `notifications` 写入消息；Worker 使用 `blPop` 消费。
- Swagger：只有 `ENABLE_SWAGGER=true` 时才挂载 `/api-docs`，生产 `.env` 建议设为 `false`。
