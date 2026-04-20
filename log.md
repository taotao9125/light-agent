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
→ 返回 token ✅

### 任务
1. 完成 POST /api/auth/login ✅
2. 登录成功返回 token ✅
3. 登录失败能正确报错 ✅
4. 预留 authMiddleware 文件 ✅
5. 最好顺手做一个最小 /me 雏形 ✅