# 4 月 17 日到 5 月 4 日学习与项目里程碑

> 来源：`mytasks/k.json` 中 39 个 ChatGPT 导出会话、`mytasks/log.md`、`mytasks/4.28_5.04_4.30done.md`、`mytasks/4.30_5.06.md` 等阶段记录，以及 2026-04-17 至 2026-05-04 的 Git commit log。  
> 时间范围：2026-04-17 到 2026-05-04。  
> 主线目标：从 Node/Express/MySQL 基础，推进到一个可运行、可部署、具备工程化能力展示的会议室预约后端系统，并逐步对齐 Agent 工程师所需的系统能力。

## 1. 总体目标

这段时间的学习不是单点知识学习，而是在围绕一个真实后端项目建立完整工程链路：

```txt
Express 后端
  -> MySQL 数据建模
  -> 注册/登录/JWT/auth
  -> 会议室预约业务
  -> 并发安全
  -> 统一错误处理
  -> Redis 限流和队列
  -> Docker 本地环境
  -> Dockerfile 镜像
  -> 服务器部署
  -> GitHub Actions CI/CD
  -> Nginx 反向代理
  -> 架构文档沉淀
```

最终抽象目标可以归纳为：

```txt
把一个本地能跑的 Express 项目，推进成一个别人能 clone、能启动、能部署、能排查、能持续迭代的工程化后端项目。
```

同时，你的长期职业目标逐渐明确为：

```txt
Agent 开发工程师 / AI 应用工程师
```

所以这段项目实践的价值不只是后端功能，而是补齐 Agent 工程师也绕不开的基础：

```txt
HTTP / 数据库 / 事务 / 并发 / 权限 / 错误处理 / 日志 / Docker / CI/CD / 服务器 / Workflow / 工具接口设计
```

## 2. 时间线里程碑

### Git commit 校准后的主线

聊天记录反映的是“问题意识和学习过程”，commit log 反映的是“代码真实落点”。结合最近几天提交后，项目演进可以更准确地拆成三条线：

```txt
业务线：
注册/登录/JWT
  -> me/auth
  -> rooms/booking
  -> 我的预约
  -> 事务防并发
  -> 管理员/普通用户权限
  -> 审批状态流转

工程线：
wrapRes/AppError/error middleware
  -> 模块化 route/service/repository
  -> zod validate
  -> 单元测试
  -> logger/PM2
  -> Redis 限流/队列
  -> Swagger

交付线：
Docker 管 MySQL
  -> Dockerfile
  -> compose local/prod
  -> ECS 手动部署
  -> GitHub Actions build/push
  -> ACR
  -> Nginx
  -> infra 目录
  -> CI 同步 infra + 写 env
```

这比单纯按聊天标题看更清晰：你不是“今天学了 Docker，明天学 CI”，而是在把同一个后端项目逐步推进到可协作、可部署、可维护。

### 2026-04-17：Node、Express、MySQL 起步

核心问题：

- Node.js 连接数据库到底是 HTTP 还是 socket。
- 什么是 Node.js 异步编程。
- Express 最小路由怎么写。
- MySQL 如何启动、连接、查看端口和进程。
- `.env` 如何让代码从环境读取配置。

解决方案：

- 明确 MySQL 连接不是 HTTP API，而是通过数据库协议走 TCP/socket。
- 用 `mysql2` 连接 MySQL。
- 写出最小 Express 路由。
- 用 `lsof`、`ps aux` 排查 MySQL 进程和端口。
- 初步接入 `.env`。

产出：

- Express 服务可启动。
- `/user` 等最小查询接口可返回 MySQL 数据。
- 对 “服务监听端口” 和 “客户端连接 host/port” 有了基本区分。

相关提交：

```txt
b4eb62c Initial commit
db5d6eb init
```

这一天是仓库和 Express 脚手架的起点。

### 2026-04-18：环境配置、数据库资源、MySQL 语法

核心问题：

- 如何避免 `.env` 泄漏。
- 不同环境的变量值如何管理。
- 哪些配置应该提交，哪些应该放 Secret。
- MySQL 测试数据和 SQL 文件如何准备。

解决方案：

- 区分 Secret 和非敏感变量：
  - Secret：`DB_PASSWORD`、`JWT_SEC`、API Key。
  - Variable：`DB_HOST`、`DB_PORT`、`DB_BASE` 等。
- 明确真实 `.env` 不提交，提交 `.env.example`。
- 为后续部署埋下 GitHub Secrets 的认知基础。

产出：

- 开始从“本地写死配置”转向“环境驱动配置”。
- 意识到配置同步是工程化问题，不只是代码问题。

相关提交：

```txt
f43c017 feat: setup express mysql env and basic user route
131b972 cjs -> es
```

这两次提交说明项目在这一天完成了两个基础转换：

```txt
Express + MySQL + env 的最小闭环
CommonJS -> ES module
```

### 2026-04-19：注册、登录、JWT、auth 雏形

核心问题：

- 注册接口如何写。
- 登录时如何查用户、校验密码、签发 JWT。
- 旧 token 怎么办。
- `/me` 和 auth middleware 应该如何组织。

解决方案：

- 注册接口写入 users 表。
- 登录接口使用 `bcrypt.compare` 校验密码。
- 使用 `jwt.sign` 生成 token。
- 为后续 `auth` middleware 和 `/api/me` 留出结构。

产出：

- 注册接口完成。
- 登录接口完成。
- JWT 登录链路跑通。
- `/me` 和 auth 的方向确定。

相关提交：

```txt
4ca74b9 feat: 注册接口
bd522b1 完成注册接口
da1cdbb api: login(jwt)
```

### 2026-04-20：Express 错误处理模型

核心问题：

- Express 中间件执行顺序是什么。
- `wrapRes` 为什么能统一返回。
- SQL 故意写错后，为什么会出现 `Cannot set headers after they are sent`。
- async 错误为什么有时没有进入全局错误中间件。

解决方案：

- 理解 Express 中间件模型：

```txt
app.use
  -> router middleware
  -> handler
  -> wrap catch
  -> error middleware
```

- 区分同步 throw 和异步 throw。
- 统一通过 `wrap(fn)` 捕获 async handler 错误，再 `next(err)`。
- 开始抽象 `AppError` 和全局 error middleware。

产出：

- 建立了错误处理主线：

```txt
service throw AppError
  -> wrap catch
  -> next(err)
  -> app.use(error middleware)
  -> logger.error
  -> JSON response
```

### 2026-04-21 到 2026-04-22：预约业务与并发安全

核心问题：

- 会议室预约如何判断时间冲突。
- 两个请求同时抢同一时间段，如何保证只能成功一个。
- 为什么需要事务。
- 为什么需要 `SELECT ... FOR UPDATE`。
- 为什么不能所有请求共用同一个 connection。
- `rollback`、`commit`、`release` 分别是什么意思。

解决方案：

- 设计 `bookings` 表，包含：

```txt
user_id
room_id
start_time
end_time
status
cancel_reason
cancelled_at
created_at
updated_at
```

- 使用时间冲突判断：

```sql
? < end_time AND ? > start_time
```

- 用事务包住查冲突和插入：

```txt
beginTransaction
  -> find conflict FOR UPDATE
  -> insert booking
commit
rollback on error
release connection
```

- 用 `pool.getConnection()` 为每个事务拿独立 connection。
- 用 `sleep` 模拟并发窗口，验证两个请求同时进来时只能成功一个。

产出：

- 创建预约接口具备并发安全。
- 完成了从普通 CRUD 到真实业务一致性的跨越。
- 形成一个重要经验：

```txt
并发安全不是靠 if 判断，而是靠数据库事务、锁、状态条件和幂等设计。
```

相关提交：

```txt
97e4038 添加booking room接口
11d27da 添加我的预定接口
de9357f 预约会议室通过mysql 事务, 防止竞争/重复
```

这里是业务能力第一次明显升级：从“接口能查”进入“接口要在并发下正确”。

### 2026-04-23：权限、取消预约、审批状态流转

核心问题：

- 普通用户和管理员看到的预约列表是否一样。
- 取消预约时如何区分“自己的预约”和“别人的预约”。
- 审批通过/拒绝应该如何进入状态流转。
- booking 表是否需要 `review_at`、`review_remark`、reject/pending 相关字段。

解决方案：

- auth 中解析出 `uid` 和 `role`。
- 普通用户只查自己的预约。
- 管理员可以看到更多数据并执行审核动作。
- booking status 开始从简单状态进入流转模型。

产出：

- 管理员和普通用户行为开始分化。
- 取消预约和审批预约的业务边界出现。
- booking 不再只是“插入一条记录”，而是带状态生命周期的业务对象。

相关提交：

```txt
05b678c 管理员和普通会议室列表/取消预定
164cd34 添加审批状态流转
74df46d 更新会议室订阅记录状态流转
```

### 2026-04-24 到 2026-04-25：代码分层、动态 SQL、安全查询

核心问题：

- routes、service、repository 应该如何分层。
- service 是不是“服务”。
- repository 层能不能接收 req。
- SQL 动态 where 怎么写才安全。
- 参数可能是 `0` 时如何判断是否有值。

解决方案：

- 初步形成分层：

```txt
routes：HTTP 路由和中间件
service：业务逻辑、权限、状态判断
repository：SQL 和数据访问
db：连接池和执行 SQL
```

- 动态 SQL 中只拼接 SQL 结构，不拼接用户值；用户值仍然走 `?` 参数。
- 判断可选参数时避免简单 `if (value)`，因为 `0` 也是合法值。

产出：

- 项目从“路由里写一切”进入分层结构。
- 为后续单元测试和重构打基础。

相关提交：

```txt
f907396 里程碑v1 + 书写文档 + 大问题记录
33d82f7 feature-first/Domain-driven folder structure/更新架构设计雏形
4f68d42 里程碑: 混乱结构进入模块化结构 route -> service -> repository
5b08798 中间件: 添加接口级别的
b701b5c 错误校验收口到 zod
b04e9d0 添加单元测试
```

这里是代码结构的关键拐点。commit 里“混乱结构进入模块化结构”很准确：项目从 `routes/api/*.js` 的集中写法，拆到了 `modules/*/{routes,service,repository}`。

### 2026-04-26 到 2026-04-28：Docker、PM2、日志、初始化 SQL

核心问题：

- Docker 镜像、容器、volume、端口映射、network 分别是什么。
- 为什么容器删了数据会丢，volume 又如何持久化。
- MySQL 初始化 SQL 如何让别人 clone 后自动建表、插数据。
- PM2 在本机还是 Docker 里用。
- 日志如何落盘，日志平台如何拿到。

解决方案：

- 明确开发模型：

```txt
Dev：
依赖服务容器化，代码本地跑，方便 debug。

CI/Test：
尽量容器化，保证可复制。

Prod：
业务服务容器化，数据库按实际环境管理。
```

- MySQL 使用：

```yaml
volumes:
  - ./sql:/docker-entrypoint-initdb.d/
  - meeting-mysql-data:/var/lib/mysql
```

- 理解 `/docker-entrypoint-initdb.d/` 是 MySQL 镜像初始化时扫描 SQL 的固定目录。
- 通过 `001_schema.sql`、`002_seed.sql` 控制执行顺序。
- PM2、日志、logger、error code 开始形成工程意识。

产出：

- `schema.sql` / `seed.sql` 思路成型。
- Docker volume 持久化概念清楚。
- 形成 “clone 后能跑” 的工程目标。

相关提交：

```txt
37d5a67 把 docker 来管理 mysql
9904e39 完成 next week day 1：日志封装、code/status/message、PM2 CRUD 和日志查看
eb29429 完成 next week day 2：mysql 依赖容器化、volume 映射建表/种子 SQL、声明 volume 保证数据持久化
4dd9e3f BUG FIX: 修复事务 bug
```

这一阶段的实际突破不是“会 docker 命令”，而是把 MySQL 从本机手动依赖改成可复制依赖，并把 SQL 初始化、volume 持久化和错误日志一起纳入工程体系。

### 2026-04-28 到 2026-04-29：AppError、Vitest、Redis 限流与队列

核心问题：

- 都有 `AppError` 了，为什么还需要 error middleware。
- 单元测试如何 mock repository 和 utils。
- `vi.mock` 和 import 顺序如何处理。
- Redis 如何做限流。
- Redis List 如何模拟队列。
- 预约成功后异步通知如何处理。

解决方案：

- 错误处理分工：

```txt
AppError：描述错误是什么
throw：把错误抛出去
wrap：把 async 错误交给 Express
error middleware：统一记录日志和返回 JSON
```

- Vitest mock：

```txt
mock repository
mock withTransaction
mock redisClientRpush
beforeEach 清理 mock 状态
```

- Redis 限流：

```txt
key = rate-limit:${req.ip}
INCR
EXPIRE
超过 max 则拒绝
```

- Redis 队列：

```txt
producer: rPush notifications
worker: bPop notifications
```

产出：

- booking service 有单元测试覆盖：
  - 创建成功
  - 时间冲突
  - 无权取消
  - 预订不存在
- Redis 限流生效。
- 预约成功后能 push 通知任务，worker 消费。
- 错误处理、日志、测试、队列形成一套基础工程能力。

相关提交：

```txt
25712b7 error: 修复error返回结构
967135d 接入 redis, 实现接口限流中间件
75f4ad6 redis 模拟消息队列, 开启进程去监听消费
5dc2dee 添加 swagger 文档
ba1a58f TDD: 把 service 无关的剥离出来进行 mock, 如事务, redis
```

这几次提交说明你开始把工程能力拆开处理：

```txt
错误结构
限流
队列
API 文档
可测试性
```

### 2026-04-30：Dockerfile、服务器、Nginx、部署第一次打通

核心问题：

- Dockerfile 用什么 Node 镜像。
- 为什么 `node:24.15.0-bookworm` 找不到。
- 为什么镜像 1.6G。
- DockerHub pull 慢、pull 超时怎么处理。
- 服务器容器启动了，公网为什么访问不到。
- 安全组、端口、Nginx、后端端口如何配合。

解决方案：

- 改用存在且更小的镜像：

```dockerfile
FROM node:22-alpine
```

- 生产安装依赖：

```bash
pnpm install --prod --frozen-lockfile
```

- 阿里云 ECS 上安装 Docker，配置镜像加速器。
- 安全组开放端口。
- 逐步引入 Nginx，目标是：

```txt
公网 80 -> nginx -> backend:3000
```

产出：

- 后端服务作为 Docker 镜像运行。
- 服务器上能跑容器。
- `/health` 可验证服务。
- 完成第一次真实部署链路。

相关提交：

```txt
68b7e89 收尾, 达到同事级协作交付
4305143 环境变量: redis 从环境变量读入口
ad43a6e 开始服务器上试试 docker
1a2dd27 chore: update 日记
```

其中 `4305143` 是一个重要细节：Redis 从环境变量读入口，说明你真正遇到了“本机 localhost 和容器 service name 不同”的部署问题，并把它修回配置层。

### 2026-05-01：GitHub Actions、ACR、自动部署

核心问题：

- GitHub Actions 如何 checkout、setup node、setup pnpm、install、test。
- Docker 镜像如何动态 tag。
- GitHub Actions 如何登录阿里云 ACR。
- CI build/push 成功后，服务器如何 pull image。
- `.env.prod` 和 compose 文件在服务器上如何管理。
- ACR pull 网络不通如何排查。

解决方案：

- GitHub Actions 基本流程：

```txt
push main
  -> checkout
  -> setup node
  -> setup pnpm
  -> pnpm install
  -> pnpm run test:ci
  -> docker login ACR
  -> docker build
  -> docker push commit tag
  -> docker push latest
  -> SSH server
  -> docker compose pull backend
  -> docker compose up -d
  -> health check
```

- 使用 GitHub Secrets 保存：

```txt
DOCKER_REGISTER
DOCKER_REGISTER_USERNAME
DOCKER_REGISTER_PWD
SERVER_IP
SERVER_USER
SERVER_PEM
DB_PASSWORD
JWT_SEC
```

- 镜像 tag 使用：

```bash
IMAGE_TAG=${GITHUB_SHA::7}
```

产出：

- CI 可以构建镜像并推送到 ACR。
- 服务器可以使用 compose 拉取最新 backend 镜像。
- 从手动部署进入自动部署阶段。

相关提交：

```txt
ed57eae test: ci/cd test
fdc053f ci: 测试 ci run test
469a547 CI: 配置 build/push image
fd3fb7a CI: update secrets 变量
3ee15c0 CI: 换 docker 仓库
413c502 docker: update compose file
```

这一天的真实主线是：先让 GitHub Actions 跑起来，再逐步加测试、镜像构建、镜像推送、secrets、镜像仓库切换。

### 2026-05-02：镜像优化、env 分层、下一阶段规划

核心问题：

- `.env` 和 `.env.prod` 区别是什么。
- 生产 env 是否应该提交。
- Docker 镜像还能不能更小。
- `pm2`、`nginx` 在 Docker 部署里是否还需要。
- 自动部署跑通后下一步做什么。

解决方案：

- 真实 `.env` 不提交，只提交 `.env.example`。
- 生产环境变量由 CI 写入服务器。
- Dockerfile 使用 alpine + prod install 降低镜像大小。
- 后续重点转向：

```txt
Nginx
CI/CD 稳定性
部署目录规范
infra 目录
架构文档
业务代码重构
Workflow / Agent 工程理解
```

产出：

- 镜像体积明显优化。
- 环境变量治理思路清晰。
- 第一阶段从“能跑”进入“能部署、能维护”。

相关提交：

```txt
e2ac206 CI/CD: auto deploy
5719ee1 / 707a5ea / 8d4a08c ci/cd config 调整
a00a6bf CI/CD: 更新 image build 大小
8ba4b16 update dev-to-deploy-architecture.md
28773ce nginx: add nginx
acaf2f0 固化版本问题: 解决 swagger 安装位置
```

这一天不仅是镜像优化，也开始补齐生产入口和文档：`nginx`、架构图、依赖位置修正都在这里发生。

### 2026-05-04：工程整理与 Workflow / Agent 思维

核心问题：

- nginx 配置应该如何根据项目写。
- `infra` 目录如何同步到远程服务器。
- CI 是否应该写入 `.env`。
- routes/service/repository 分层是否清晰。
- workflow 和 agent 的区别是什么。
- agent-computer interface 如何设计。

解决方案：

- nginx 使用 compose 内部服务名：

```nginx
upstream backend_pool {
  server backend:3000;
}
```

- 生产 compose 编排：

```txt
nginx
backend
mysql
redis
```

- CI 同步 `server/infra/` 到服务器，并写入远程 `infra/env/.env`。
- 业务代码重构：
  - 抽出 `lib/validate.js`
  - 修复拼写：`findConflictBooking`、`BOOKING_NOT_FOUND`
  - routes 统一传 `req` 给 service
  - repository 不接收 Express `req`
  - auth / requireRole 统一错误格式
- 更新 `dev-to-deploy-architecture.md`。
- 用 `demos/min-workflow.js` 建立 workflow 最小 demo，包含：
  - 状态持久化
  - 失败处理
  - 重试
  - 条件分支
  - 并行任务
  - 补偿动作
  - 等待外部事件

产出：

- 项目目录从散乱部署文件进入 `infra` 结构。
- 架构文档与当前代码一致。
- 对 workflow 的理解从概念进入代码模型：

```txt
workflow = durable async compose + state machine + failure policy
```

其中 `demos/min-workflow.js` 是当前工作区新增的学习 demo，用来把 workflow 的状态、上下文、重试、分支、并行、补偿、等待外部事件可视化。

相关提交：

```txt
5450cbc env 通过 CI 写入, 其他 infra 配置文件通过 rsync 同步到服务器
ce329ee CI: 更改 image 仓库地址 && 只 pull backend
d1ada0d bug: 修复业务 bug
523e670 抽离 validate, 统一校验错误
35b07f6 修复拼写错误
ba1fd3e 路由统一传 req 进 service
6645b8c guard 成统一错误
912dc29 架构图更新
```

这一天是一次真正的“工程收口”：

```txt
部署文件归入 infra
CI 负责同步 infra 和写 env
业务 bug 修复
校验统一
命名统一
路由入参统一
guard 错误统一
架构文档更新
```

## 3. 核心问题与解决方案汇总

### 问题 1：本地开发能跑，但别人 clone 后不能跑

原因：

- MySQL 需要手动安装、建库、建表、插数据。
- Redis、环境变量、端口配置都依赖本机。

解决方案：

- 用 Docker Compose 管理 MySQL 和 Redis。
- 用 `infra/mysql/init/*.sql` 初始化数据库。
- 提供 `.env.example`。
- 用 `pnpm run docker:up` 启动依赖服务。

结果：

```txt
依赖服务可复制，项目具备协作启动基础。
```

### 问题 2：预约时间冲突和并发抢占

原因：

- 两个请求同时查，都看到“没有冲突”，然后都插入。
- 最初 connection 设计错误，多个请求共用单例 connection。

解决方案：

- 每个事务从 pool 获取独立 connection。
- 使用事务。
- 使用 `SELECT ... FOR UPDATE` 锁定冲突范围。
- 插入和查冲突在同一个事务 connection 中执行。

结果：

```txt
同一时间段并发请求，只能成功一个。
```

### 问题 3：错误处理分散

原因：

- routes/service 中到处 `if/try/catch/res.json`。
- async 错误没有统一进入 Express error middleware。
- 多次响应导致 `Cannot set headers after they are sent`。

解决方案：

- `AppError` 描述业务错误。
- `wrapRes` 捕获 async handler。
- 全局 error middleware 统一返回 JSON。
- `logger.error` 统一记录错误上下文。

结果：

```txt
错误从“散点处理”变成“统一收口”。
```

### 问题 4：业务代码边界混乱

原因：

- routes 直接处理业务。
- service/repository 参数风格不统一。
- validate 重复。
- 拼写错误和错误码不统一。

解决方案：

- routes 统一把 `req` 传给需要上下文的 service。
- service 负责从 `req` 中取 `body/params/uid/role`。
- repository 只接收具体字段，不接收 `req`。
- 抽出 `lib/validate.js`。
- 统一 auth / requireRole 错误格式。

结果：

```txt
分层职责更清晰，后续测试和 agent tool 封装更容易。
```

### 问题 5：环境变量和 Secret 管理

原因：

- `.env` 不能提交。
- 生产、测试、本地变量值不同。
- CI 需要部署，但不能把密码写进仓库。

解决方案：

- 非敏感配置可放 `.env.example`。
- 敏感配置放 GitHub Secrets。
- CI 部署时远程写入 `infra/env/.env`。

结果：

```txt
代码和配置分离，生产密钥不入库。
```

### 问题 6：服务器部署不稳定

原因：

- DockerHub 网络慢。
- 镜像源配置错误。
- 安全组未开放。
- 容器内 localhost 指向自己。
- compose 网络和宿主机网络混淆。

解决方案：

- 配置阿里云镜像加速器。
- 使用服务名 `mysql`、`redis`、`backend` 做容器间通信。
- 安全组开放需要的端口。
- 用 nginx 统一入口。

结果：

```txt
公网访问从 http://IP:3000/health 进化到 http://IP/health。
```

### 问题 7：CI/CD 文件和部署文件如何上服务器

原因：

- 服务器需要 compose、nginx、mysql init、env。
- `.env` 不能提交 Git。
- 手动复制脚本容易混乱。

解决方案：

- `infra` 目录提交 Git。
- CI 使用 `rsync` 同步 `server/infra/` 到服务器。
- CI 使用 GitHub Secrets 写远程 `infra/env/.env`。
- 服务器只 `docker compose pull backend`，避免每次拉基础镜像。

结果：

```txt
部署从手工命令转向可重复的 workflow。
```

## 4. 已完成的关键产出

### 业务能力

- 用户注册。
- 用户登录。
- JWT auth。
- `/api/me` 当前用户。
- `/api/users` 用户列表。
- `/api/rooms` 会议室列表。
- `/api/rooms/:id` 会议室详情。
- `/api/booking` 预约列表。
- `/api/booking/create` 创建预约。
- `/api/booking/:id/cancel` 取消预约。
- `/api/booking/:id/review` 管理员审核。

### 工程能力

- Express 分层结构。
- `AppError`。
- 全局 error middleware。
- `wrapRes`。
- `logger`。
- zod validate。
- Vitest 单元测试。
- MySQL connection pool。
- transaction helper。
- Redis rate limit。
- Redis queue worker。
- Swagger 开关。
- Dockerfile。
- Docker Compose local/prod。
- MySQL init SQL。
- Nginx reverse proxy。
- GitHub Actions CI/CD。
- ACR 镜像推送。
- ECS 远程部署。
- 架构文档。

### 思维模型

- HTTP 服务和数据库连接不是同一类通信。
- 容器内 `localhost` 指向容器自己。
- 端口映射是宿主机端口到容器端口。
- named volume 是 Docker 管理的持久化数据。
- env 决定“连谁”，network 决定“能不能连上”，运行位置决定 host 写法。
- 事务解决一组数据库操作的一致性。
- workflow 的核心是状态、上下文、失败处理和恢复。
- agent tool 设计应该由测试用例和安全边界驱动。

## 5. 重要里程碑清单

```txt
M1  2026-04-17：Express + MySQL 最小接口跑通
M2  2026-04-18：理解 env 和不同环境配置
M3  2026-04-19：注册、登录、JWT 链路提交
M4  2026-04-20：wrapRes + AppError + error middleware 建立错误处理模型
M5  2026-04-21：booking room 和我的预定接口成型
M6  2026-04-22：事务 + FOR UPDATE 解决并发冲突
M7  2026-04-23：管理员/普通用户权限、取消预约、审批状态流转
M8  2026-04-25：混乱 routes 结构进入 modules route/service/repository
M9  2026-04-25：zod 校验和 Vitest 单元测试引入
M10 2026-04-27：Docker 开始管理 MySQL 依赖
M11 2026-04-28：PM2/logger/error code 和 MySQL init SQL/volume 完成
M12 2026-04-29：Redis 限流、Redis 队列、Swagger、TDD mock
M13 2026-04-30：Dockerfile 镜像化 backend，ECS 手动部署通过 /health 验证
M14 2026-05-01：GitHub Actions 构建并推送 ACR，secrets 和镜像仓库切换
M15 2026-05-02：CI/CD 自动部署、镜像优化、Nginx、架构文档初版
M16 2026-05-04：infra 目录收口，CI 同步 infra + 写 env，只 pull backend
M17 2026-05-04：业务代码重构，validate/命名/routes/guard 错误统一
M18 2026-05-04：架构图更新，workflow demo 在工作区完成，建立 agent/workflow 抽象
```

从 commit 节奏看，有三个明显跃迁：

```txt
第一次跃迁：4/19 - 4/23
从“能查数据库”变成“有注册、登录、预约、权限、状态流转的业务系统”。

第二次跃迁：4/25 - 4/29
从“能写业务”变成“有分层、校验、错误收口、测试、Redis、文档的工程项目”。

第三次跃迁：4/30 - 5/04
从“本地项目”变成“Docker 镜像 + ECS + CI/CD + ACR + Nginx + infra 目录的可部署系统”。
```

## 6. 当前项目状态

当前项目已经不是最初的 demo，而是一个具备真实工程要素的后端项目。

当前结构重点：

```txt
app.js
bin/www
modules/
  booking/
  login/
  register/
  rooms/
  users/
  me/
middlewares/
lib/
db/
config/
infra/
  compose/
  nginx/
  mysql/init/
  env/
Dockerfile
dev-to-deploy-architecture.md
demos/min-workflow.js
```

当前部署链路：

```txt
push main
  -> GitHub Actions test
  -> docker build
  -> docker push ACR
  -> SSH ECS
  -> rsync infra
  -> write infra/env/.env
  -> docker compose pull backend
  -> docker compose up -d
  -> curl http://localhost/health
```

当前业务链路：

```txt
client
  -> nginx
  -> Express
  -> auth / requireRole
  -> routes
  -> service
  -> validate
  -> repository
  -> MySQL / Redis
```

## 7. 仍然存在的问题

### 技术债 1：service 仍然依赖 Express req

当前约定是：

```txt
routes -> service：可以传 req
service -> repository：不能传 req
```

这已经比 repository 接 req 好很多，但 service 仍然和 Express 耦合。

后续可以改成：

```js
service.createBooking({
  body: req.body,
  userId: req.uid,
  role: req.role,
  params: req.params
})
```

价值：

- service 更容易单元测试。
- 将来封装 agent tools 时更容易复用。

### 技术债 2：booking 状态和字段还可继续规范

当前已有：

```txt
PENDING
APPROVED
REJECTED
CANCELLED
```

后续可以继续梳理：

```txt
review_at
review_remark
cancel_reason
cancelled_at
status transition
```

价值：

- 审批、取消、状态流转更像真实业务状态机。

### 技术债 3：CI 写 env 的方式需要再加固

当前 CI 远程 heredoc 写 `.env`，容易受缩进和 shell 引号影响。

更稳的方式：

```txt
runner 生成临时 env 文件
scp 到服务器
chmod 600
```

价值：

- 避免 `.env` 行首空格、特殊字符、引号问题。

### 技术债 4：SQL 初始化和迁移还不是一回事

当前 `infra/mysql/init/*.sql` 只适合首次初始化。

后续表结构变化需要：

```txt
migration
版本号
上线变更脚本
回滚方案
```

价值：

- 从 demo 初始化进入真实生产数据库演进。

### 技术债 5：测试覆盖还偏少

当前主要覆盖 booking service 的核心分支。

后续应补：

- auth token 缺失 / 无效。
- requireRole 非管理员。
- register 用户已存在。
- login 密码错误。
- rooms 不存在。
- review booking 不存在 / 状态已流转。
- Redis 失败时的业务行为。

## 8. 下一阶段建议

### 阶段 A：把当前后端项目稳定住

优先级：

```txt
1. 修 CI 写 env 的方式
2. 给 infra/env/.env.example 补齐生产需要的 key
3. 给 compose prod 增加 healthcheck
4. 补 auth/register/login/rooms/review 的测试
5. 写 README：本地启动、部署、CI/CD、常见问题
```

目标：

```txt
让这个项目可以作为简历/面试展示项目。
```

### 阶段 B：把业务流程抽象成 workflow

可以从 booking 开始：

```txt
CreateBookingWorkflow
  -> validate
  -> check conflict
  -> create booking
  -> enqueue notification
  -> completed
```

再进阶：

```txt
BookingApprovalWorkflow
  -> create pending booking
  -> wait admin review
  -> approve/reject
  -> notify user
  -> completed
```

目标：

```txt
把 workflow 思维落到自己的业务系统里。
```

### 阶段 C：设计 Booking Agent 的工具接口

不要直接把 HTTP API 暴露给 agent，而是设计业务工具：

```js
searchRooms({ minCapacity, equipment, location })
findAvailableRooms({ startTime, endTime, minCapacity })
createBookingForCurrentUser({ roomId, startTime, endTime, idempotencyKey })
cancelOwnBooking({ bookingId, reason })
```

配套测试：

```txt
用户要订会议室 -> agent 必须先查可用会议室
时间冲突 -> agent 不能硬创建，应给备选方案
普通用户 -> 不能替别人取消预约
重复调用 -> 不能创建重复预约
```

目标：

```txt
从后端工程项目自然过渡到 Agent 应用工程项目。
```

## 9. 最大收获

这段时间最大的变化不是学会某个命令，而是开始把问题放回工程系统里看。

你反复踩到的问题，最后都回到几个基本实体：

```txt
谁在运行？
运行在哪里？
连谁？
用什么身份连？
数据存在哪里？
失败了谁负责？
重试会不会重复副作用？
状态如何恢复？
配置从哪里来？
日志在哪里看？
```

这正是后端工程、Workflow 工程、Agent 工程共同的底层问题。

一句话总结：

```txt
你已经从“写接口”进入“设计系统运行链路”的阶段。
```

下一步不是盲目加功能，而是把当前系统稳定、文档化、测试化，然后在它上面做 workflow 和 agent tools。
