import express from 'express';
import executeQuery from '../../db.js';
import wrap from '../../lib/wrapRes.js';
import {to} from 'await-to-js';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
const router = express.Router();


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

  const [, users] = await to(executeQuery(
    'SELECT * from `users` where username = ?',
    [username]
  ))

  if (users.length === 0) {
     res.status(200).send({ error: '未注册' });
     return;
  }

  const [, isOk] = await to(bcrypt.compare(password, users[0].password_hash));

  if (!isOk) {
    res.status(200).send({ error: '密码错误' });
    return;
  }

  const secretKey = process.env.JWT_SEC;
  const token = jwt.sign({username, uid: users[0].id}, secretKey, { expiresIn: '1day' });
 
   return token;
}));

export default router;