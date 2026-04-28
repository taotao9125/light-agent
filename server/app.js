import createError from 'http-errors';
import express from 'express';
import path from 'path';
import cookieParser from 'cookie-parser';
// import logger from 'morgan';
import dotenv from 'dotenv';

import { fileURLToPath } from 'url';
import { dirname } from 'path';

import logger from './lib/logger.js';


import API_ME from './modules/me/routes.js';
import API_USERS from './modules/users/routes.js';
import API_REGISTER from './modules/register/routes.js';
import API_LOGIN from './modules/login/routes.js';
import API_BOOKING from './modules/booking/routes.js';
import API_ROOMS from './modules/rooms/routes.js';



import test from './routes/api/test.js';

dotenv.config();

const app = express();

// 获取 __dirname（ES module 中需要手动构造）
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'jade');

// app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));



app.use('/api/me', API_ME);
app.use('/api/users', API_USERS);
app.use('/api/register', API_REGISTER);
app.use('/api/login', API_LOGIN);
app.use('/api/booking', API_BOOKING);
app.use('/api/rooms', API_ROOMS);


app.use('/api/test', test);


// catch 404 and forward to error handler
app.use(function(req, res, next) {
  next(createError(404));
});

// error handler
// next 参数 是必须的，否则无法捕获错误
app.use(function(err, req, res, next) {
  logger.error(err.message, {status: err.status, ...err.context} );
  res.status(err.status || 500).json({
    error: err.message || '服务器错误',
    code: err.code || 'SERVER_ERROR',
  });
});

export default app;