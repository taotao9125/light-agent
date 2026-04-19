import createError from 'http-errors';
import express from 'express';
import path from 'path';
import cookieParser from 'cookie-parser';
import logger from 'morgan';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import {to} from 'await-to-js';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

import indexRouter from './routes/index.js';
import usersRouter from './routes/users.js';

dotenv.config();

const app = express();

// 获取 __dirname（ES module 中需要手动构造）
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'jade');

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// app.use('/', indexRouter);
// app.use('/users', usersRouter);

// 如何验证 createConnection， createPool
// const pool = mysql.createPool({
//   host: process.env.DB_HOST,
//   user: process.env.DB_USER,
//   database: process.env.DB_BASE,
// })

// 每次都连接？注意：createConnection 返回 Promise，需要 await 或 .then
// 建议改成 createPool 或者用 await 连接
let connection;
const initConnection = async () => {
  if (!connection) {
    connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      database: process.env.DB_BASE,
    });
  }
  return connection;
};

app.get('/rooms', async (req, res) => {

  const [, conn] = await to(initConnection());
  const [error, d] = await to(conn.query('SELECT * FROM `meeting_rooms`'));
  if (error) {
     console.error(error);
     res.status(500).send({ error: 'Database query failed' });
     return;
  }
  const [data] = d;
   res.send(data);
});


app.get('/users', async (req, res) => {

  const [, conn] = await to(initConnection());
  const [error, d] = await to(conn.query('SELECT * FROM `users`'));
  if (error) {
     console.error(error);
     res.status(500).send({ error: 'Database query failed' });
     return;
  }
  const [data] = d;
   res.send(data);
});


// catch 404 and forward to error handler
app.use(function(req, res, next) {
  next(createError(404));
});

// error handler
app.use(function(err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});

export default app;