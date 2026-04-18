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
