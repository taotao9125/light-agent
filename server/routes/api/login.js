import express from 'express';
import executeQuery from '../../db.js';
import wrap from '../../lib/wrapRes.js';
import {to} from 'await-to-js';
import bcrypt from 'bcrypt';
import AppError from '../../errors/appError.js';
import jwt from 'jsonwebtoken';
const router = express.Router();


const emailReg = /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;

/* GET users listing. */
router.post('/', wrap(async function(req, res, next) {
  const {
    username,
    password
  } = req.body;


  if (!emailReg.test(username)) new AppError('邮箱格式不正确');

  if (!password) throw new AppError('密码不能为空');

  const rows = await executeQuery(
    'SELECT * from `users` where username = ?',
    [username]
  )

  
  if (rows.length === 0) throw new AppError('未注册'); 

  const isOk = await bcrypt.compare(password, rows[0].password_hash)

  if (!isOk) throw new AppError('密码错误'); 
  
  const secretKey = process.env.JWT_SEC;
  const token = jwt.sign({username, uid: rows[0].id, role: rows[0].role}, secretKey, { expiresIn: '1day' });


   return token;
}));

export default router;
