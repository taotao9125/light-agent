import express from 'express';
import executeQuery from '../../db.js';
import {to} from 'await-to-js';
import bcrypt from 'bcrypt';
import wrap from '../../lib/wrapRes.js';
const router = express.Router();


//  POST 请求怎么接收参数, req.body
/**
 * 1. 验证用户名格式是否合法
 * 2. 验证用户名是否重复
 * 3. 密码加密
 * 
 *  */ 


const emailReg = /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;

/* GET users listing. */
router.post('/', wrap(async function(req, res, next) {
  const {
    username,
    password
  } = req.body;

  if (!emailReg.test(username)) {
    res.status(200).send({ error: '邮箱格式不正确' });
    return;
  }

  if (!password) {
     res.status(200).send({ error: '密码不能为空' });
     return;
  }

   const [err, users] = await to(executeQuery(
    'SELECT `username` from `users` WHERE `username` = ?',
    [username]
  ))

  if (!!users.length) {
     res.status(200).send({ error: '该用户已注册' });
     return;
  }

  const [pwdErr, pwdResult] = await to(bcrypt.hash(password, 10));

  const [insertErr, insertResult] = await to(executeQuery(
    'INSERT INTO `users` (username, password_hash) VALUES (?, ?)',
    [username, pwdResult]
  ))
   return null;
}));

export default router;