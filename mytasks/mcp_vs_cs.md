 Client 对比

  | 对比项 | 传统 C/S Client | MCP Client |
  |---|---|---|
  | 代表 | 浏览器、前端 App、Postman、另一个后端服务 | Claude、Cursor、Codex、我们写的 client.ts |
  | 它要知道什么 | server 的 URL / IP / 端口 | MCP server 的连接入口 |
  | 连接入口例子 | http://localhost:3000 | node --import tsx src/index.ts |
  | 通信方式 | HTTP | stdio / HTTP / WebSocket 等 transport |
  | 发出的请求 | HTTP request | MCP JSON-RPC message |
  | 调用目标 | 某个 API 路由 | 某个 tool / resource / prompt |
  | 调用例子 | GET /api/ping | tools/call + name: "ping" |

  Server 对比

  | 对比项 | 传统 C/S Server | MCP Server |
  |---|---|---|
  | 代表 | Express、Koa、Spring、Django 服务 | 我们的 index.ts、官方 GitHub MCP Server |
  | 暴露什么 | HTTP API | tools / resources / prompts |
  | 注册能力 | app.get("/api/ping", handler) | server.registerTool("ping", ..., handler) |
  | 接收什么 | HTTP request | MCP JSON-RPC message |
  | 参数从哪里来 | query / params / body | tool arguments |
  | 返回什么 | HTTP response | MCP result |
  | 运行方式 | 通常先启动服务监听端口 | stdio 模式下通常由 MCP client 启动进程 |
  | 地址形式 | IP / 域名 / 端口 / URL | stdio 启动命令，或 HTTP MCP URL |


  一句话版本：

  传统 HTTP 是：client 访问一个 URL，用 HTTP 调某个 API。
  MCP stdio 是：client 启动/连接一个 server，用 stdio 发送 MCP 消息，调用某个 tool。

  更底层的共同模型是：

  1. 和谁连？
  传统：URL / IP / 端口
  MCP：server 启动入口或 URL

  2. 怎么交流？
  传统：HTTP
  MCP：stdio / HTTP / WebSocket 等 transport

  3. 交流什么？
  传统：REST API，比如 /api/ping
  MCP：协议能力，比如 tools/call + ping

  所以：

  registerTool("ping")
  ≈
  app.get("/api/ping")

  它们都是在 server 上注册一个 client 可以调用的能力。