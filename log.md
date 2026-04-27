## day1
### 目标
1. Node.js 后端项目最小怎么启动
```
const express = require('express');
const app = express();

app.get('/', callback);
app.listen(port, callback)

bash
nodemon app.js
```
2. Express 最基本怎么写路由
```
app.get('/', callback);
app.post('/api/user', callback);
```
3. MySQL 怎么启动和连接
```
brew services mysql start
mysql -h 127.0.0.1 -p 3307 -u root -p
```


4. .env 环境变量怎么用
？？？会使用，不同环境使用不同的变量还是有些模糊，
测试环境，线上环境等端口，ip等都是固定，但本地新增的自定义变量呢？比如我本地新增一个 db_name=111, 如何把这个也同步到测试环境，线上环境等


### 停车场
不用 brew 如何装 mysql
安装mysql的过程中，突然想跳出去学mysql语法，忍住了


mysql -u root ERROR 2002 (HY000): Can't connect to local MySQL server through socket '/tmp/mysql.sock' (2)
如何查看mysql运行在哪个process
```
ps aux | grep mysqld
```
如何查看某个服务跑在哪个端口
```
lsof -i -P | grep mysqld
```

如何查看某个端口有哪些进程监听
```
lsof -i :3306
```

```javascript
// 如何验证  createConnection， createPool
// const pool = mysql.createPool({
//   host: process.env.DB_HOST,
//   user: process.env.DB_USER,
//   database: process.env.DB_BASE,
// })

// 每次都连接？
const connection = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  database: process.env.DB_BASE,
})

// 每次都连接？
const connection = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  database: process.env.DB_BASE,
}).then((connection) => {
  connection.query(
    'SELECT * from `users`'
  ).then(r => {console.log(r, 234)})
})


app.get('/user', (req, res) => {
  // 每次都查询？
  connection.query(
    'SELECT * from `users`'
  ).then(r => {
    const [data] = r;
    res.send(data) 
  })
})
```


### 总结

1. 成功安装expressjs, nodemon，写了一个路由
2. mysql 安装成功，brew 安装的，
2.1 启动 mysql 成功，创建了一个表
2.2 数据库 通过 mysql2 成功连接
3.写了一个路由/user ，mysql 查询, 路由返回成功
4.env环境配置成功，代码里都是通过环境去拿里面的值


问题：
1. 自己安装这些感觉很麻烦



## day2
### 目标
1. 创建正式数据库：meeting_room_system -> done
2. 设计并创建 3 张核心表：GUI 工具创建的
   - users -> done
   - meeting_rooms -> done
   - bookings -> done
3. 用 mysql2 或 SQL 工具验证表可用 -> done，命令行
4. 写 1~2 个最小接口验证新表查询成功 > done, users, rooms 两个接口


## 停车场
created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP

 UI 上怎么操作上面

 如何结构化res
  ![alt text](./image2.png)
------
数据迁移
我是手动在GUI工具上创建的数据库，字段
1. 如何从0-1同步都其他环境
2. 如果表结构变更，如何同步

 字段设计错误，"status": "active", 如何修改，现存数据如何同步，
 传统开发宁愿加字段也不改自断
 ![alt text](./image.png)


![alt text](image-1.png)




## day 3

创建正式项目数据库
→ 建 users / meeting_rooms / bookings 三张表
- 写 /users 和 /rooms 接口
→ 插入一点测试数据
→ 写 1~2 个接口验证新表可查


## 停车场
debug 调试如何添加断点后不重启


1. nodejs --inspect，相当于node启动一个debug服务
2. vscode 作为客户端去监听debug服务端口
3. 调试

异步问题，有些异步都有err, 各种异步混杂在一起，这些error如何管理，我目前是遇到一个 if 一个

bcrypt.hash 密码入库后，如果后期换了一个加密库，那登录密码还能对上吗？
答：只要你更换的库是 bcrypt 的标准实现，就不需要任何额外处理。这是因为 bcrypt 算法是公开的行业标准，且所有验证信息都存储在哈希字符串本身中


login, register 接口太多重复验证逻辑了
接口验证字段都是手写





day3
## 主线
用户输入用户名密码
→ 后端查 users 表 ✅
→ bcrypt.compare 校验密码 ✅
→ jwt.sign 生成 token ✅ 
  ? 新生成的 token,那旧token怎么半
→ 返回 token ✅

### 任务
1. 完成 POST /api/auth/login ✅
2. 登录成功返回 token ✅
3. 登录失败能正确报错 ✅
4. 预留 authMiddleware 文件 ✅
5. 最好顺手做一个最小 /me 雏形 ✅


其他
洋葱模型
// 输出：
// 📥 m1 入栈
// m1 before next
//   📥 m2 入栈
//   m2 before next
//     📥 handler 入栈
//     handler 执行
//     📤 handler 出栈
//   m2 after next
//   📤 m2 出栈
// m1 after next
// 📤 m1 出栈

错误统一处理
高阶函数统一处理res
get('/', wrap(res))


route -> 全局中间件(洋葱模型) -> wrap -> res
错误处理
  



day 4 休息

day 5
1. 完成 rooms 列表接口
  ? 是否已被预定
  ？当前是否在使用
2. 完成 rooms 详情接口 ✅
3. 完成创建 booking 接口
   ？预定哪个会议室
   ？什么时间
4. 完成我的 booking 列表接口
5. 有余力的话，完成取消 booking 接口


关联的字段数据类型必须一样
mysql> alter table users
    -> MODIFY COLUMN `id` BIGINT NOT NULL AUTO_INCREMENT;

```javscript
CREATE TABLE bookings (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  room_id BIGINT NOT NULL,
  start_time DATETIME NOT NULL,
  end_time DATETIME NOT NULL,
  status TINYINT NOT NULL DEFAULT 1,
  cancel_reason VARCHAR(255) DEFAULT NULL,
  cancelled_at DATETIME DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  CONSTRAINT fk_bookings_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_bookings_room FOREIGN KEY (room_id) REFERENCES meeting_rooms(id)
);
```




// 会议室/预定记录/user三张表，如何将信心聚合到一起
```javscript
router.get('/me', auth,wrap(async function(req, res) {
   const uid = req.uid;
   // 这里我选择了我定了哪些会议室，但会议室表中只有user_id, 我如何也将把个人信心也拿到，是不是再
   // 查user表，传userid
   const [, rows] = await to(executeQuery(
    `
      SELECT *
      FROM bookings
      WHERE user_id=?
    `,
   [uid]
  ))
  return rows;
}))
```

   SELECT
        b.*,
        u.username,
        u.role,
        mr.name,
        mr.location
      FROM bookings b
      JOIN users u
        ON b.user_id = u.id
      JOIN meeting_rooms mr
        on b.room_id = mr.id
      WHERE user_id=?



多个请求抢夺统一资源, 通过mysql事务
创建连接
  开启事务  begintransaction
    等待执行 sql 告诉 sql 当前查询操作锁住 for update
      结束事务 commit (也会释放锁)

  有错误
    释放锁 rollback
  
  不管怎样都要释放连接 release




4-24 任务
1. 修掉我上面说的 3 个问题
2. 全流程测试：
   create → pending
   admin review → approved
   user cancel → cancelled
3. 手动造 5 条数据测试边界：
   - 已审批再审批
   - 已取消再取消
   - 非本人取消


1.用户注册
  - 已存在 -> 报错
  - 不存在 -> 写入 user 表
2.用户登录
  - 不存在/密码错误 -> 报错
  - 已经存在 AND 密码正确 -> 下发 token
3.会议室列表
  - 普通用户 -> query 自己的预定
  - admin -> query 所有的预定
4.会议室预定 status = pending
  - 时间冲突 -> 失败
  - 并发创建 -> 只能创建一个（事务）
5.会议室取消
  - admin  -> 可取消所有的 (pending/approved -> canceled)
  - user 
    - 取消别人的 -> 报错
    - 取消自己的 -> pending -> canceled
6.会议室审批
  - admin
    审批通过 -> pending -> approved
    审批不通过 -> pending -> rejected

系统通过“状态机 + 条件更新（UPDATE ... WHERE status）”
来保证业务一致性，避免并发和非法状态流转。

状态流转
  pending(0)
    -> approved(1)
    -> rejected(2)
    -> canceled(3)
  approved(2)
    -> canceled(3)
  reject (2)终态
  canceled (3) 终态
  




yangt2@qq.com
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VybmFtZSI6Inlhbmd0MkBxcS5jb20iLCJ1aWQiOjYsInJvbGUiOm51bGwsImlhdCI6MTc3Njk5OTcyMywiZXhwIjoxNzc3MDg2MTIzfQ._akAw-0zvxPC-jbcUt7ecAdgrmBld9J8Cp14FqJSm4k


yangtao3@google.com admin
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VybmFtZSI6Inlhbmd0YW8zQGdvb2dsZS5jb20iLCJ1aWQiOjMsInJvbGUiOiJhZG1pbiIsImlhdCI6MTc3NzAwMDEzMSwiZXhwIjoxNzc3MDg2NTMxfQ.o4W6Gk4E3onMyZuXWNhtcI8FX2SJjEaC4ULNJc1U480

yangtao4@google.com
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VybmFtZSI6Inlhbmd0YW80QGdvb2dsZS5jb20iLCJ1aWQiOjQsInJvbGUiOm51bGwsImlhdCI6MTc3NzAwMDE2NCwiZXhwIjoxNzc3MDg2NTY0fQ.3xdwQ5w7ieoE5rD21yrHyYMdS5AOKNmhLTJSFRbSIe0


未解决的大问题
双token机制
  redis
分层
数据库orm
验证散乱

✅
modules
  -bookings
  -me
    me.service.js
     createYYY() {
       业务逻辑xxx
       各种判断yyy
       repository.create(a, b);
     }

    me.repository.js
    me.route.js
      route.get('/xxx', service.getXXX)
      router.post('/yyy', service.creatYYY)

    index.js




## todo
对，你这个判断是对的。现在功能已经够了，剩下是**后端工程闭环**。






```

`多线程` 放后面，别把它排太前。这个项目里更核心的是：

```txt
事务并发控制 > 多线程
```


mysqldump -u root -p book_rooms_system --no-create-info > seed.sql

导出 sql
  从什么哪里导
  导到哪里
  用谁来导



{
  "builder": {
    "gc": {
      "defaultKeepStorage": "20GB",
      "enabled": true
    }
  },
  "experimental": false
}


4.26


------ docker 学习
1️⃣ **Image → Container**

* Image = 打包好的环境 + 代码（静态）
* Container = Image 运行起来（进程）

---

2️⃣ **运行环境**

* 容器里运行的是 Linux + 依赖 + 代码
* 和本机 macOS / Windows 隔离

---

3️⃣ **端口（网络）**

* 程序在容器里 `listen`
* `-p 本机端口:容器端口`
* 本机端口由 Docker 监听 → 转发到容器

---

4️⃣ **数据（文件）**

* 不挂载：数据在容器里，删容器就没了
* 挂载：`-v 本机目录:容器目录`
* 文件读写同步到本机

---

5️⃣ **分发**

* Image 可以 push/pull（共享）
* Volume 只在本机（不共享）

---

6️⃣ **启动规则**

* Image 里有 CMD / ENTRYPOINT
* Docker run 时执行

---

7️⃣ **配置限制**

* `-p` / `-v` / `-e` 创建容器时确定
* 不能直接修改 → 需要删掉重建

---

👉 **一句话：**

👉 **Docker = 用 Image 在隔离的 Linux 环境中跑 Container，通过 -p 提供访问，通过 -v 管理数据**

-----

1. 写 docker-compose.yml（MySQL + 后端）
2. 改数据库连接，支持通过 .env 读取（DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_NAME）
3. 准备 .env.example（所有必填变量列清楚）
4. 验证：删除本地数据库 → docker-compose 启动 → 用 schema.sql + seed.sql 初始化 → 项目跑通

5. 接入 PM2（本地模拟生产）
   - pm2 start
   - pm2 logs
   - pm2 restart

6. 安装 pm2-logrotate 并验证日志轮转

7. 导出 Postman Collection（覆盖所有接口）
8. README 补充：
   - docker 启动步骤
   - 数据库初始化步骤
   - 如何用 Postman 测接口



  
本机旧 MySQL
  ↓ 导出 schema.sql
```
// 导入哪个服务器,哪个库，导出到什么
mysqldump -u root -p book_rooms_system \
  --no-data \
  --set-gtid-purged=OFF \
  > schema.sql


mysqldump -u root -p book_rooms_system \
  --no-create-info \
  --single-transaction \
  --set-gtid-purged=OFF \
  > seed.sql

```
// 导进哪个服务器，哪个库，导入什么
// 服务器 x, 库 y, 导入目标 z
Docker MySQL
  ↓ 导入 schema.sql
```
// 注意这里-p后不能带空格
docker exec -i meeting_mysql \
mysql -u root -p123456 book_rooms_system < schema.sql
```
验证查看
```
docker exec -it meeting_mysql mysql -u root -p123456
```


我尝试把业务代码也放进 docker 里， debug 麻烦，端口映射又得改，--inspect 地址又得 改 127.0.0.1 -> 0.0.0.0 
docker 占用了 127.0.0.1, 有可能 vscode debug 配置还得改。ROI 太低了。

开发阶段，放弃把业务代码放进docker里

Docker 全量跑 Node + MySQL，留给：

1. 部署前验收
2. CI 打 image
3. 测试/线上环境


sql 切到 docker 容器里，
Error: Table 'book_rooms_system.USERS' doesn't exist

docker 环境基于 lunix 的，对大小写敏感，我库里是 users