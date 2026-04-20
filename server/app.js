import createError from 'http-errors';
import express from 'express';
import path from 'path';
import cookieParser from 'cookie-parser';
import logger from 'morgan';
import dotenv from 'dotenv';

import { fileURLToPath } from 'url';
import { dirname } from 'path';


import apiUserRouter from './routes/api/users.js';
import apiRooms from './routes/api/rooms.js';
import apiRegister from './routes/api/register.js';
import apiLogin from './routes/api/login.js';
import apiMe from './routes/api/me.js';



import test from './routes/api/test.js';

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


app.use('/api/users', apiUserRouter);
app.use('/api/rooms', apiRooms);
app.use('/api/register', apiRegister);
app.use('/api/login', apiLogin);
app.use('/api/me', apiMe);




app.use('/api/test', test);



// catch 404 and forward to error handler
app.use(function(req, res, next) {
  next(createError(404));
});

// error handler
app.use(function(err, req, res, next) {
  console.warn(err, 'app.use统一收口')

  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});

export default app;