好，这一段你必须沉淀下来，这是你第一套“真实工程踩坑清单”。

---

### 1️⃣

**问题：** `docker-compose up -d` 报错 unknown shorthand flag

**原因：** 机器没有安装 `docker compose` 插件，被当成 `docker` 命令解析

**解决方案：**
使用旧命令：

```bash
docker-compose up -d
```

或安装 compose 插件

---

### 2️⃣

**问题：** Docker pull 超时（i/o timeout）

**原因：** 云服务器访问 Docker Hub 网络慢/被限制

**解决方案：**
配置阿里云专属镜像加速器：

```bash
/etc/docker/daemon.json
```

然后重启 docker

---

### 3️⃣

**问题：** pull access denied for mysql / hello-world

**原因：** 错把普通 registry 当 mirror，镜像源配置错误

**解决方案：**
使用阿里云提供的专属 mirror 地址，不要用公共 registry

---

### 4️⃣

**问题：** docker daemon 启动失败

**原因：** `/etc/docker/daemon.json` JSON 格式错误

**解决方案：**
修正为合法 JSON（无注释、无多余逗号），再重启 docker

---

### 5️⃣

**问题：** node:xx 镜像 not found

**原因：** 镜像加速器不同步该镜像或缓存异常

**解决方案：**
清理缓存 + 重新 pull：

```bash
docker rmi node:xx
docker builder prune -a
docker pull node:xx
```

---

### 6️⃣

**问题：** Docker build 一直失败/异常

**原因：** build cache 缓存了错误层

**解决方案：**

```bash
docker builder prune -a
docker-compose build --no-cache
```

---

### 7️⃣

**问题：** container 启动成功但公网访问不到

**原因：** 阿里云安全组未开放端口

**解决方案：**
在安全组放行：

```txt
TCP 3000
0.0.0.0/0
```

---

### 8️⃣

**问题：** 本机能访问，公网不行

**原因：** 服务器防火墙（ufw）未放行

**解决方案：**

```bash
ufw allow 3000/tcp
```

---

### 9️⃣

**问题：** 服务只在容器内可访问

**原因：** 应用监听 `127.0.0.1`

**解决方案：**

```js
app.listen(PORT, '0.0.0.0')
```

---

### 🔟

**问题：** CI/CD 不知道从哪里开始

**原因：** 没有先手动跑通部署链路

**解决方案：**

```txt
先手动 docker-compose 跑通
再上 GitHub Actions
```

---

### 总结一句话（非常关键）

```txt
你遇到的所有问题，本质都是：
环境 / 网络 / 配置，而不是代码
```

---

如果你继续往下走（Nginx + CI/CD），下一批坑我也可以提前帮你列出来。


好，给你一份**工程复盘版（精简但关键点全覆盖）**👇

---

### 问题：

SSH 登录要求输入密码
原因：实例未绑定密钥对
解决方案：重置密码登录 → 手动配置 `authorized_keys`

---

### 问题：

`invalid format`（pem 无效）
原因：私钥内容不完整/格式错误
解决方案：重新下载完整私钥文件，原样保存为 `.pem`

---

### 问题：

SSH 使用 pem 仍然要密码
原因：私钥与服务器公钥不匹配
解决方案：确认实例绑定的密钥或手动写入公钥

---

### 问题：

Docker 安装失败（docker-ce 不存在）
原因：Docker 官方 apt 源未正确添加
解决方案：改用 `apt install docker.io`（快速方案）或修复源

---

### 问题：

`docker-compose-plugin` 找不到
原因：Ubuntu 源版本较旧
解决方案：使用 `docker-compose`（旧命令）

---

### 问题：

Redis 报错 `NaN port`
原因：环境变量未加载（REDIS_PORT undefined）
解决方案：正确注入 env（dotenv / docker env_file）

---

### 问题：

Redis `ECONNREFUSED 127.0.0.1`
原因：容器内访问 localhost 指向自身
解决方案：改为 `redis`（service name）或正确 host

---

### 问题：

MySQL 能连但 Redis 不行
原因：本机通过端口映射连 MySQL，Redis 配置不一致
解决方案：统一本机用 `127.0.0.1`，容器用 service name

---

### 问题：

docker-compose 改了但 backend 不生效
原因：backend 不是通过 compose 启动
解决方案：统一用 compose 管理所有服务

---

### 问题：

`pull access denied for meeting_server`
原因：服务器没有该镜像且未 push 到仓库
解决方案：先 build 或推送到 Docker Hub / GHCR

---

### 问题：

容器之间无法通信
原因：不在同一个 Docker network
解决方案：使用 compose 或指定 `--network`

---

### 问题：

为什么需要 chmod 400
原因：SSH 要求私钥权限严格
解决方案：`chmod 400 xxx.pem`

---

### 问题：

是否需要备案
原因：使用 IP 访问无需备案
解决方案：当前阶段直接用 IP

---

# 🎯 总结一句话

```txt
你踩的所有坑，本质都是：
环境变量 + 网络 + 运行位置（本机 / 容器 / 服务器）不一致
```

---

这份你可以直接当**面试素材**用了：

```txt
“我做过从本地开发到 Docker 部署，再到服务器上线的完整链路，
过程中处理了环境变量隔离、容器网络通信、镜像分发和 SSH 登录等问题。”
```


好，这一段你必须沉淀下来，这是你第一套“真实工程踩坑清单”。

---

### 1️⃣

**问题：** `docker-compose up -d` 报错 unknown shorthand flag

**原因：** 机器没有安装 `docker compose` 插件，被当成 `docker` 命令解析

**解决方案：**
使用旧命令：

```bash
docker-compose up -d
```

或安装 compose 插件

---

### 2️⃣

**问题：** Docker pull 超时（i/o timeout）

**原因：** 云服务器访问 Docker Hub 网络慢/被限制

**解决方案：**
配置阿里云专属镜像加速器：

```bash
/etc/docker/daemon.json
```

然后重启 docker

---

### 3️⃣

**问题：** pull access denied for mysql / hello-world

**原因：** 错把普通 registry 当 mirror，镜像源配置错误

**解决方案：**
使用阿里云提供的专属 mirror 地址，不要用公共 registry

---

### 4️⃣

**问题：** docker daemon 启动失败

**原因：** `/etc/docker/daemon.json` JSON 格式错误

**解决方案：**
修正为合法 JSON（无注释、无多余逗号），再重启 docker

---

### 5️⃣

**问题：** node:xx 镜像 not found

**原因：** 镜像加速器不同步该镜像或缓存异常

**解决方案：**
清理缓存 + 重新 pull：

```bash
docker rmi node:xx
docker builder prune -a
docker pull node:xx
```

---

### 6️⃣

**问题：** Docker build 一直失败/异常

**原因：** build cache 缓存了错误层

**解决方案：**

```bash
docker builder prune -a
docker-compose build --no-cache
```

---

### 7️⃣

**问题：** container 启动成功但公网访问不到

**原因：** 阿里云安全组未开放端口

**解决方案：**
在安全组放行：

```txt
TCP 3000
0.0.0.0/0
```

---

### 8️⃣

**问题：** 本机能访问，公网不行

**原因：** 服务器防火墙（ufw）未放行

**解决方案：**

```bash
ufw allow 3000/tcp
```

---

### 9️⃣

**问题：** 服务只在容器内可访问

**原因：** 应用监听 `127.0.0.1`

**解决方案：**

```js
app.listen(PORT, '0.0.0.0')
```

---

### 🔟

**问题：** CI/CD 不知道从哪里开始

**原因：** 没有先手动跑通部署链路

**解决方案：**

```txt
先手动 docker-compose 跑通
再上 GitHub Actions
```

---

### 总结一句话（非常关键）

```txt
你遇到的所有问题，本质都是：
环境 / 网络 / 配置，而不是代码
```

---

如果你继续往下走（Nginx + CI/CD），下一批坑我也可以提前帮你列出来。
