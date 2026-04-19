import express from 'express';
import executeQuery from '../../db.js';
import {to} from 'await-to-js';
import bcrypt from 'bcrypt';
// import { patterns } from 'rgex';
const router = express.Router();


//  POST 请求怎么接收参数, req.body
/**
 * 1. 验证用户名格式是否合法
 * 2. 验证用户名是否重复
 * 3. 密码加密
 * 
 *  */ 


/* GET users listing. */
router.post('/', async function(req, res, next) {
  const {
    username,
    password
  } = req.body;

  if (!username) {
    res.status(200).send({ error: '邮箱格式不正确' });
    return;
  }

  if (!password) {
     res.status(200).send({ error: '密码不能为空' });
     return;
  }


  // const h1 = await bcrypt.hash('111', 10);
  // const h2 = await bcrypt.hash('111', 10);

  // console.log(await bcrypt.compare(h1, h2), 2324)

  
  // const [err, result] = await to(executeQuery('SELECT * FROM `meeting_rooms`'))
  // if (err) {
  //   res.status(500).send({ error: 'Database query failed' });
  // }
  res.send({
    a: 1
  });
});

export default router;