# Server 开发到部署架构图

> 基于当前 `server` 目录代码、`Dockerfile`、`docker-compose.yml`、`docker-compose.prod.yaml` 和 `.github/workflows/ci.yml` 整理。

## 1. 整体开发到部署流程

```mermaid
flowchart TD
    DEV[开发者本地开发] --> CODE[server 源码]

    CODE --> LOCAL_DEPS[pnpm install]
    CODE --> LOCAL_INFRA[docker compose up -d]

    LOCAL_INFRA --> DEV_MYSQL[(MySQL 8<br/>3306<br/>meeting-mysql-data)]
    LOCAL_INFRA --> DEV_REDIS[(Redis<br/>6379<br/>meeting-redis-data)]
    DEV_MYSQL --> INIT_SQL[sql/001_schema.sql<br/>sql/002_seed.sql]

    LOCAL_DEPS --> LOCAL_APP[pnpm run debug / pnpm start<br/>nodemon bin/www]
    LOCAL_APP --> EXPRESS[Express App<br/>app.js]
    EXPRESS --> DEV_MYSQL
    EXPRESS --> DEV_REDIS

    DEV --> PUSH[git push main]
    PUSH --> GHA[GitHub Actions<br/>CI workflow]

    GHA --> TEST[pnpm install<br/>pnpm run test:ci]
    TEST --> BUILD[docker build<br/>Dockerfile]
    BUILD --> IMAGE[镜像标签<br/>commit short sha<br/>latest]
    IMAGE --> ACR[(阿里云 ACR<br/>secrets.DOCKER_REGISTER/yangblue/test)]

    ACR --> SSH[SSH 到生产服务器]
    SSH --> PROD_DIR["/root/booking"]
    PROD_DIR --> PULL[docker-compose --env-file .env.prod<br/>-f docker-compose.prod.yaml pull backend]
    PULL --> UP[docker-compose --env-file .env.prod<br/>-f docker-compose.prod.yaml up -d]

    UP --> PROD_BACKEND[meeting_backend<br/>backend:3000]
    UP --> PROD_MYSQL[(mysql_meeting_db<br/>MySQL 8)]
    UP --> PROD_REDIS[(redis_meeting_db<br/>Redis appendonly)]

    PROD_BACKEND --> PROD_MYSQL
    PROD_BACKEND --> PROD_REDIS
    PROD_BACKEND --> HEALTH[Health Check<br/>curl http://localhost:3000/health]
    HEALTH --> OK[部署成功]
```

## 2. 应用内部请求链路

```mermaid
flowchart LR
    CLIENT[Client / Browser / API 调用方] --> HTTP[HTTP Request]
    HTTP --> SERVER[bin/www<br/>创建 HTTP Server<br/>监听 PORT 默认 3000]
    SERVER --> APP[app.js<br/>Express App]

    APP --> GLOBAL_MW[全局中间件<br/>json/urlencoded/cookie/static<br/>rateLimit]
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

    BOOKING --> ROLE[requireRole<br/>管理员审核场景]

    AUTH --> SERVICE[service.js<br/>业务逻辑]
    ROLE --> SERVICE
    REGISTER --> SERVICE
    LOGIN --> SERVICE

    SERVICE --> VALIDATE[zod validate<br/>部分模块]
    SERVICE --> REPO[repository.js<br/>SQL 封装]
    REPO --> DB[db/db.js<br/>mysql2 pool]
    DB --> MYSQL[(MySQL<br/>users / meeting_rooms / bookings)]

    APP --> REDIS_CONN[connectRedis]
    GLOBAL_MW --> RATE_REDIS[(Redis<br/>rate-limit key)]
    SERVICE --> QUEUE[(Redis List<br/>notifications)]

    QUEUE --> WORKER[workers/notifactionWorker.js<br/>blPop 消费通知]

    APP --> SWAGGER{ENABLE_SWAGGER=true?}
    SWAGGER --> DOCS["/api-docs<br/>swagger-ui"]

    APP --> NOT_FOUND[404 AppError]
    SERVICE --> ERROR[AppError / Error]
    NOT_FOUND --> ERR_HANDLER[全局错误处理<br/>logger.error + JSON response]
    ERROR --> ERR_HANDLER
```

## 3. Docker 与生产运行拓扑

```mermaid
flowchart TD
    subgraph BUILD_STAGE[镜像构建: Dockerfile]
        NODE[node:22-alpine]
        WORKDIR["/app"]
        PNPM[corepack enable<br/>pnpm@10.33.0]
        INSTALL[pnpm install --prod --frozen-lockfile]
        COPY[COPY . .]
        CMD[CMD node bin/www]

        NODE --> WORKDIR --> PNPM --> INSTALL --> COPY --> CMD
    end

    CMD --> BACKEND_IMAGE[backend image<br/>crpi-la7wsh3alv7tjgix.../yangblue/test:latest]

    subgraph PROD_COMPOSE[docker-compose.prod.yaml]
        BACKEND[backend / meeting_backend<br/>ports 3000:3000<br/>env_file .env.prod]
        MYSQL[mysql / mysql_meeting_db<br/>mysql:8<br/>ports 3306:3306<br/>volume meeting-mysql-data]
        REDIS[redis / redis_meeting_db<br/>redis:latest<br/>appendonly yes<br/>ports 6379:6379<br/>volume meeting-redis-data]
    end

    BACKEND_IMAGE --> BACKEND
    BACKEND -->|DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_BASE| MYSQL
    BACKEND -->|REDIS_HOST / REDIS_PORT| REDIS
    BACKEND -->|HTTP| PORT3000[Server Port 3000]
```

## 4. CI/CD 关键步骤

```mermaid
sequenceDiagram
    participant Dev as Developer
    participant GH as GitHub Actions
    participant ACR as Aliyun ACR
    participant ECS as Production Server
    participant App as meeting_backend

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
    GH->>ECS: SSH
    ECS->>ECS: cd /root/booking
    ECS->>ACR: docker-compose pull backend
    ECS->>ECS: docker-compose up -d
    ECS->>App: curl http://localhost:3000/health
    App-->>ECS: {"status":"ok"}
    ECS-->>GH: Deploy success
```

## 5. 当前架构要点

- 本地开发：`docker-compose.yml` 只启动 MySQL 和 Redis，Node 服务在宿主机通过 `pnpm run debug` 或 `pnpm start` 启动。
- 生产部署：`docker-compose.prod.yaml` 使用远程镜像启动 `backend`，同时编排 MySQL 和 Redis。
- CI/CD：只在 `main` 分支 push 时触发，先跑 Vitest，再构建并推送 Docker 镜像，最后 SSH 到服务器拉镜像并重启容器。
- 健康检查：部署后访问 `http://localhost:3000/health`，返回 `{"status":"ok"}` 才认为成功。
- Redis 用途：应用启动时连接 Redis；全局限流中间件写入 `rate-limit:*`；预约创建后向通知队列 `notifications` 写入消息；Worker 使用 `blPop` 消费。
